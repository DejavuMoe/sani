package meta

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"time"

	"golang.org/x/net/proxy"
)

var errProxy = errors.New("metadata proxy connection failed")

// NewProxy tunnels to a locally verified IP; the HTTP transport retains the
// original Host and TLS server name. NO_PROXY never applies to this transport.
func NewProxy(raw string) (*Fetcher, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.Path != "" && u.Path != "/" || u.RawQuery != "" || u.Fragment != "" ||
		(u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "socks5") {
		return nil, errors.New("SANI_META_PROXY: expected an http, https or socks5 proxy URL")
	}
	if u.User != nil {
		pass, _ := u.User.Password()
		if len(u.User.Username()) > 255 || len(pass) > 255 {
			return nil, errors.New("SANI_META_PROXY: credentials are too long")
		}
	}
	port := u.Port()
	if port == "" {
		port = map[string]string{"http": "80", "https": "443", "socks5": "1080"}[u.Scheme]
	}
	d := &proxyTunnel{url: u, address: net.JoinHostPort(u.Hostname(), port)}
	f := NewDirect()
	f.client.Transport.(*http.Transport).DialContext = d.dialContext
	return f, nil
}

type proxyTunnel struct {
	url       *url.URL
	address   string
	tlsConfig *tls.Config // local fixture roots; nil uses the system trust store
}

func (d *proxyTunnel) dialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, ErrBlocked
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return nil, ErrBlocked
	}
	for _, ip := range ips {
		// Fake-IP resolvers need the hostname at the proxy; strict pinning cannot
		// safely support them. The legacy environment transport stays unchanged.
		if !Public(ip) || netip.MustParsePrefix("198.18.0.0/15").Contains(ip.Unmap()) {
			return nil, ErrBlocked
		}
	}
	target := net.JoinHostPort(ips[0].Unmap().String(), port)
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	if d.url.Scheme == "socks5" {
		var auth *proxy.Auth
		if d.url.User != nil {
			pass, _ := d.url.User.Password()
			auth = &proxy.Auth{User: d.url.User.Username(), Password: pass}
		}
		p, err := proxy.SOCKS5("tcp", d.address, auth, dialer)
		if err != nil {
			return nil, errProxy
		}
		conn, err := p.(proxy.ContextDialer).DialContext(ctx, network, target)
		if err != nil {
			return nil, errProxy
		}
		return conn, nil
	}
	conn, err := dialer.DialContext(ctx, "tcp", d.address)
	if err != nil {
		return nil, errProxy
	}
	ok := false
	defer func() {
		if !ok {
			conn.Close()
		}
	}()
	deadline, _ := ctx.Deadline()
	conn.SetDeadline(deadline)
	rawConn := conn
	stop := context.AfterFunc(ctx, func() { rawConn.Close() })
	defer stop()
	if d.url.Scheme == "https" {
		cfg := &tls.Config{MinVersion: tls.VersionTLS12, ServerName: d.url.Hostname()}
		if d.tlsConfig != nil {
			cfg = d.tlsConfig.Clone()
			cfg.ServerName = d.url.Hostname()
		}
		tlsConn := tls.Client(conn, cfg)
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			return nil, errProxy
		}
		conn = tlsConn
	}
	req := &http.Request{Method: http.MethodConnect, URL: &url.URL{Opaque: target}, Host: target, Header: make(http.Header)}
	if d.url.User != nil {
		pass, _ := d.url.User.Password()
		req.Header.Set("Proxy-Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(d.url.User.Username()+":"+pass)))
	}
	if req.Write(conn) != nil {
		return nil, errProxy
	}
	reader := bufio.NewReader(io.LimitReader(conn, 8192))
	resp, err := http.ReadResponse(reader, req)
	if err != nil || resp.StatusCode != http.StatusOK {
		return nil, errProxy
	}
	buffered, _ := reader.Peek(reader.Buffered())
	if !stop() && ctx.Err() != nil {
		return nil, errProxy
	}
	conn.SetDeadline(time.Time{})
	ok = true
	if len(buffered) != 0 {
		return &bufferedTunnel{Conn: conn, reader: io.MultiReader(bytes.NewReader(bytes.Clone(buffered)), conn)}, nil
	}
	return conn, nil
}

type bufferedTunnel struct {
	net.Conn
	reader io.Reader
}

func (c *bufferedTunnel) Read(b []byte) (int, error) { return c.reader.Read(b) }
