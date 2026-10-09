package meta

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

func targetCertificate(t *testing.T) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	cert := &x509.Certificate{SerialNumber: big.NewInt(1), NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IPAddresses: []net.IP{net.ParseIP("1.1.1.1")}, DNSNames: []string{"target.test"}, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, cert, cert, pub, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, _ := x509.MarshalPKCS8PrivateKey(key)
	pair, err := tls.X509KeyPair(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}))
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := x509.ParseCertificate(der)
	roots := x509.NewCertPool()
	roots.AddCert(parsed)
	return pair, roots
}

func pipeFixture(a, b net.Conn) {
	defer a.Close()
	defer b.Close()
	done := make(chan struct{})
	go func() { io.Copy(a, b); a.Close(); close(done) }()
	io.Copy(b, a)
	b.Close()
	<-done
}

func TestDedicatedProxyTransports(t *testing.T) {
	fixtureResolver(t)
	t.Setenv("NO_PROXY", "*")
	for _, scheme := range []string{"http", "https", "socks5"} {
		for _, auth := range []bool{false, true} {
			for _, secure := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/auth=%v/targetTLS=%v", scheme, auth, secure), func(t *testing.T) {
					var requests atomic.Int32
					target := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						requests.Add(1)
						if r.TLS != nil && r.TLS.ServerName != "target.test" {
							t.Error("target TLS SNI changed", r.TLS.ServerName)
						}
						if !strings.HasPrefix(r.Host, "target.test:") || r.Header.Get("Proxy-Authorization") != "" {
							t.Error("target host or proxy credential boundary", r.Host)
						}
						if r.URL.Path == "/redirect" {
							http.Redirect(w, r, "http://127.0.0.1/private", 302)
							return
						}
						w.Header().Set("Content-Type", "text/html")
						io.WriteString(w, "<title>Fixture title</title>")
					}))
					cert, roots := targetCertificate(t)
					if secure {
						target.TLS = &tls.Config{Certificates: []tls.Certificate{cert}}
						target.StartTLS()
					} else {
						target.Start()
					}
					defer target.Close()
					_, port, _ := net.SplitHostPort(target.Listener.Addr().String())
					var proxyURL string
					var proxyRoots *x509.CertPool
					if scheme == "socks5" {
						ln, err := net.Listen("tcp", "127.0.0.1:0")
						if err != nil {
							t.Fatal(err)
						}
						defer ln.Close()
						proxyURL = "socks5://" + ln.Addr().String()
						go func() {
							for {
								c, err := ln.Accept()
								if err != nil {
									return
								}
								go func() {
									defer c.Close()
									c.SetDeadline(time.Now().Add(5 * time.Second))
									var header [2]byte
									if _, err := io.ReadFull(c, header[:]); err != nil {
										return
									}
									methods := make([]byte, int(header[1]))
									if _, err := io.ReadFull(c, methods); err != nil {
										return
									}
									method := byte(0)
									if auth {
										method = 2
									}
									c.Write([]byte{5, method})
									if auth {
										if _, err := io.ReadFull(c, header[:]); err != nil {
											return
										}
										user := make([]byte, int(header[1]))
										io.ReadFull(c, user)
										n := []byte{0}
										io.ReadFull(c, n)
										pass := make([]byte, int(n[0]))
										io.ReadFull(c, pass)
										if string(user) != "user" || string(pass) != "pass" {
											t.Error("SOCKS authentication")
											return
										}
										c.Write([]byte{1, 0})
									}
									var req [10]byte
									if _, err := io.ReadFull(c, req[:]); err != nil {
										return
									}
									if req[0] != 5 || req[1] != 1 || req[3] != 1 || net.IP(req[4:8]).String() != "1.1.1.1" || fmt.Sprint(binary.BigEndian.Uint16(req[8:])) != port {
										t.Error("SOCKS target was not pinned")
										return
									}
									up, err := net.Dial("tcp", target.Listener.Addr().String())
									if err != nil {
										return
									}
									c.Write([]byte{5, 0, 0, 1, 127, 0, 0, 1, 0, 0})
									c.SetDeadline(time.Time{})
									pipeFixture(c, up)
								}()
							}
						}()
					} else {
						p := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							if r.Method != "CONNECT" || r.Host != net.JoinHostPort("1.1.1.1", port) {
								t.Error("CONNECT target was not pinned", r.Method, r.Host)
								w.WriteHeader(400)
								return
							}
							want := ""
							if auth {
								want = "Basic " + base64.StdEncoding.EncodeToString([]byte("user:pass"))
							}
							if r.Header.Get("Proxy-Authorization") != want {
								t.Error("HTTP proxy authentication")
								w.WriteHeader(407)
								return
							}
							up, err := net.Dial("tcp", target.Listener.Addr().String())
							if err != nil {
								w.WriteHeader(502)
								return
							}
							conn, _, err := w.(http.Hijacker).Hijack()
							if err != nil {
								up.Close()
								return
							}
							io.WriteString(conn, "HTTP/1.1 200 Connection established\r\n\r\n")
							pipeFixture(conn, up)
						}))
						if scheme == "https" {
							p.StartTLS()
							proxyRoots = x509.NewCertPool()
							proxyRoots.AddCert(p.Certificate())
						} else {
							p.Start()
						}
						defer p.Close()
						proxyURL = p.URL
					}
					if auth {
						u, _ := url.Parse(proxyURL)
						u.User = url.UserPassword("user", "pass")
						proxyURL = u.String()
					}
					f, err := NewProxy(proxyURL)
					if err != nil {
						t.Fatal(err)
					}
					tr := f.client.Transport.(*http.Transport)
					defer tr.CloseIdleConnections()
					tr.TLSClientConfig = &tls.Config{RootCAs: roots}
					if scheme == "https" {
						u, _ := url.Parse(proxyURL)
						d := &proxyTunnel{url: u, address: u.Host, tlsConfig: &tls.Config{RootCAs: proxyRoots}}
						tr.DialContext = d.dialContext
					}
					proto := "http"
					if secure {
						proto = "https"
					}
					raw := proto + "://" + net.JoinHostPort("target.test", port)
					page, err := f.Page(context.Background(), raw, "")
					if err != nil || page.Title != "Fixture title" {
						t.Fatalf("proxy fetch: %+v %v", page, err)
					}
					if _, err := f.Page(context.Background(), raw+"/redirect", ""); err == nil {
						t.Error("private redirect accepted")
					}
					before := requests.Load()
					if _, err := f.Page(context.Background(), "http://127.0.0.1/", ""); err == nil {
						t.Error("private target accepted")
					}
					if requests.Load() != before {
						t.Error("private request reached proxy")
					}
				})
			}
		}
	}
}

func TestProxyErrorsDoNotExposeCredentials(t *testing.T) {
	for _, raw := range []string{"ftp://user:secret@localhost", "http://user:secret@%invalid", "http://user:secret@localhost/path"} {
		_, err := NewProxy(raw)
		if err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatalf("invalid proxy error: %v", err)
		}
	}
	p := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(407) }))
	defer p.Close()
	f, err := NewProxy(strings.Replace(p.URL, "://", "://user:secret@", 1))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Page(context.Background(), "http://1.1.1.1/", ""); err == nil || strings.Contains(err.Error(), "secret") {
		t.Fatalf("proxy failure: %v", err)
	}
	if _, err := f.Page(context.Background(), "http://198.18.0.1/", ""); err == nil {
		t.Fatal("strict proxy accepted fake-IP")
	}
}

// A real local DNS fixture exercises both preflight and dial-time resolution.
func fixtureResolver(t *testing.T) {
	t.Helper()
	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	old := net.DefaultResolver
	net.DefaultResolver = &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "udp", conn.LocalAddr().String())
	}}
	done := make(chan struct{})
	t.Cleanup(func() { conn.Close(); <-done; net.DefaultResolver = old })
	go func() {
		defer close(done)
		buf := make([]byte, 2048)
		var rebinding int
		for {
			n, addr, err := conn.ReadFrom(buf)
			if err != nil {
				return
			}
			var m dnsmessage.Message
			if m.Unpack(buf[:n]) != nil || len(m.Questions) != 1 {
				continue
			}
			q := m.Questions[0]
			m.Header.Response = true
			m.Header.RecursionAvailable = true
			if strings.HasPrefix(q.Name.String(), "no-dns-") {
				m.Header.RCode = dnsmessage.RCodeNameError
			} else if q.Type == dnsmessage.TypeA {
				ips := [][4]byte{{1, 1, 1, 1}}
				if q.Name.String() == "mixed.test." {
					ips = append(ips, [4]byte{127, 0, 0, 1})
				}
				if q.Name.String() == "rebind.test." {
					rebinding++
					if rebinding > 1 {
						ips = [][4]byte{{127, 0, 0, 1}}
					}
				}
				for _, ip := range ips {
					m.Answers = append(m.Answers, dnsmessage.Resource{Header: dnsmessage.ResourceHeader{Name: q.Name, Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET}, Body: &dnsmessage.AResource{A: ip}})
				}
			}
			response, err := m.Pack()
			if err == nil {
				conn.WriteTo(response, addr)
			}
		}
	}()
}

func TestProxyRejectsMixedAndRebindingDNS(t *testing.T) {
	fixtureResolver(t)
	var attempts atomic.Int32
	p := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { attempts.Add(1); w.WriteHeader(502) }))
	defer p.Close()
	f, err := NewProxy(p.URL)
	if err != nil {
		t.Fatal(err)
	}
	for _, host := range []string{"mixed.test", "rebind.test"} {
		if _, err := f.Page(context.Background(), "https://"+host+"/", ""); err == nil {
			t.Fatal("accepted", host)
		}
	}
	if attempts.Load() != 0 {
		t.Fatal("unsafe DNS reached proxy")
	}
}

func TestEnvironmentProxyDoesNotExemptDirectTargets(t *testing.T) {
	// ProxyFromEnvironment caches process-wide settings; isolate this fixture.
	if os.Getenv("SANI_TEST_ENV_PROXY") != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestEnvironmentProxyDoesNotExemptDirectTargets$")
		cmd.Env = append(os.Environ(), "SANI_TEST_ENV_PROXY=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("environment proxy fixture: %v\n%s", err, output)
		}
		return
	}
	fixtureResolver(t)
	var requests atomic.Int32
	p := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		io.WriteString(w, "<title>Local proxy</title>")
	}))
	defer p.Close()
	for _, key := range []string{"HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"} {
		t.Setenv(key, p.URL)
	}
	for _, key := range []string{"NO_PROXY", "no_proxy"} {
		t.Setenv(key, "rebind.test,no-dns-direct.test")
	}
	t.Setenv("REQUEST_METHOD", "")
	f := New()
	defer f.CloseIdleConnections()
	_, port, _ := net.SplitHostPort(p.Listener.Addr().String())
	// Preflight resolves publicly, then the direct dial resolves to the proxy's IP:port.
	if _, err := f.Page(context.Background(), "http://rebind.test:"+port+"/private", ""); !errors.Is(err, ErrBlocked) {
		t.Errorf("direct request escaped the SSRF guard: %v", err)
	}
	if requests.Load() != 0 {
		t.Fatal("direct request reached the private proxy listener")
	}
	for _, host := range []string{"target.test", "no-dns-proxy.test"} {
		if page, err := f.Page(context.Background(), "http://"+host+"/", ""); err != nil || page.Title != "Local proxy" {
			t.Fatalf("configured proxy stopped working for %s: page=%+v err=%v", host, page, err)
		}
	}
	if _, err := f.Page(context.Background(), "http://no-dns-direct.test/", ""); err == nil {
		t.Fatal("direct request ignored failed local DNS")
	}
	if requests.Load() != 2 {
		t.Fatalf("unexpected proxy requests: %d", requests.Load())
	}
}
