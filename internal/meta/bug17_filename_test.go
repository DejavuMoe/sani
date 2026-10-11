package meta

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestBUG17NonHTMLFilenameDecodedOnce(t *testing.T) {
	for _, tt := range []struct{ path, want string }{
		{"/report%2520draft.pdf", "report%20draft.pdf"},
		{"/report%20draft.pdf", "report draft.pdf"},
		{"/report%252Fdraft.pdf", "report%2Fdraft.pdf"},
		{"/report%2Fdraft.pdf", "report/draft.pdf"},
		{"/caf%C3%A9.pdf", "café.pdf"},
		{"/100%25.pdf", "100%.pdf"},
		{"/", ""},
	} {
		t.Run(tt.path, func(t *testing.T) {
			final, err := url.Parse("https://file-fixture.test" + tt.path)
			if err != nil {
				t.Fatal(err)
			}
			f := &Fetcher{client: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": {"application/pdf"}},
					Body:       io.NopCloser(strings.NewReader("fixture")),
					Request:    &http.Request{URL: final},
				}, nil
			})}}
			// The public literal passes host validation; the transport never opens a socket.
			page, err := f.Page(context.Background(), "https://1.1.1.1/file", "")
			if err != nil {
				t.Fatal(err)
			}
			if page.Title != tt.want {
				t.Errorf("Page title = %q, want %q", page.Title, tt.want)
			}
		})
	}
}
