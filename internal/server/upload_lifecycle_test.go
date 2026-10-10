package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// pauseBody lets the handler reach a specific multipart phase without sleeps.
type pauseBody struct {
	first, rest    *bytes.Reader
	paused, resume chan struct{}
	stop           error
	announced      bool
}

func (b *pauseBody) Read(p []byte) (int, error) {
	if b.first.Len() != 0 {
		return b.first.Read(p)
	}
	if !b.announced {
		close(b.paused)
		b.announced = true
	}
	<-b.resume
	if b.stop != nil {
		return 0, b.stop
	}
	return b.rest.Read(p)
}

func TestSweepPreservesActiveUploadUntilCommitOrCleanup(t *testing.T) {
	for _, phase := range []string{"body", "tail"} {
		for _, cancelUpload := range []bool{false, true} {
			name := phase
			if cancelUpload {
				name += "-cancel"
			}
			t.Run(name, func(t *testing.T) {
				e := newShareEnv(t, Options{})
				payload := bytes.Repeat([]byte("verified-upload"), 1024)
				var buf bytes.Buffer
				mw := multipart.NewWriter(&buf)
				part, err := mw.CreateFormFile("file", "active.bin")
				if err != nil {
					t.Fatal(err)
				}
				bodyStart := buf.Len()
				part.Write(payload)
				mw.WriteField("title", "in flight")
				split := buf.Len()
				mw.Close()
				if phase == "body" {
					split = bodyStart + 32
				}
				body := &pauseBody{first: bytes.NewReader(buf.Bytes()[:split]), rest: bytes.NewReader(buf.Bytes()[split:]), paused: make(chan struct{}), resume: make(chan struct{})}
				if cancelUpload {
					body.stop = context.Canceled
				}
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				r := httptest.NewRequest("POST", "/api/admin/v1/files", body).WithContext(ctx)
				r.Header.Set("Content-Type", mw.FormDataContentType())
				w := httptest.NewRecorder()
				done := make(chan struct{})
				go func() { defer close(done); e.srv.createFile(w, r) }()
				t.Cleanup(func() {
					select {
					case <-body.resume:
					default:
						close(body.resume)
					}
					select {
					case <-done:
					case <-time.After(5 * time.Second):
						t.Error("upload cleanup did not finish")
					}
				})
				select {
				case <-body.paused:
				case <-time.After(5 * time.Second):
					t.Fatal("upload did not reach pause")
				}
				entries, err := os.ReadDir(e.srv.opt.FilesDir)
				if err != nil || len(entries) != 1 {
					t.Fatalf("in-flight files: %v %v", entries, err)
				}
				if strings.HasPrefix(entries[0].Name(), ".upload-") != (phase == "body") {
					t.Fatalf("paused in wrong phase: %s", entries[0].Name())
				}
				// Both the one-hour temp grace and ten-minute stored grace have elapsed.
				e.srv.sweepFiles(ctx, time.Now().Add(2*time.Hour))
				if _, err := os.Stat(filepath.Join(e.srv.opt.FilesDir, entries[0].Name())); err != nil {
					t.Fatalf("active upload swept: %v", err)
				}
				if cancelUpload {
					cancel()
				}
				close(body.resume)
				select {
				case <-done:
				case <-time.After(5 * time.Second):
					t.Fatal("upload did not finish")
				}
				if cancelUpload {
					entries, err := os.ReadDir(e.srv.opt.FilesDir)
					if err != nil || len(entries) != 0 || w.Code == 201 {
						t.Fatalf("canceled upload retained data: %v %v %d", entries, err, w.Code)
					}
					return
				}
				var link linkDTO
				if err := json.Unmarshal(w.Body.Bytes(), &link); err != nil || w.Code != 201 {
					t.Fatalf("completed upload: %d %s %v", w.Code, w.Body.String(), err)
				}
				e.srv.sweepFiles(context.Background(), time.Now().Add(2*time.Hour))
				download := e.files("GET", "/"+link.Slug+"/active.bin")
				sum := sha256.Sum256(download.body)
				if download.status != 200 || !bytes.Equal(download.body, payload) || hex.EncodeToString(sum[:]) != link.Content.SHA256 {
					t.Fatalf("201 upload is not downloadable: %d", download.status)
				}

				// Unreferenced leftovers are still collected when no upload owns them.
				for _, orphan := range []string{strings.Repeat("a", 32), ".upload-" + strings.Repeat("b", 32)} {
					path := filepath.Join(e.srv.opt.FilesDir, orphan)
					if err := os.WriteFile(path, []byte("orphan"), 0o600); err != nil {
						t.Fatal(err)
					}
				}
				e.srv.sweepFiles(context.Background(), time.Now().Add(2*time.Hour))
				if entries, err := os.ReadDir(e.srv.opt.FilesDir); err != nil || len(entries) != 1 {
					t.Fatalf("orphan cleanup: %v %v", entries, err)
				}
			})
		}
	}
}
