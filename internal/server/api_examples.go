package server

import (
	"embed"
	"net/http"
)

//go:embed examples/sani.csv examples/sani.json
var importExamples embed.FS

func (s *Server) importExample(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("filename")
	body, err := importExamples.ReadFile("examples/" + name)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "no such import example")
		return
	}
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	if name == "sani.csv" {
		h.Set("Content-Type", "text/csv; charset=utf-8")
	}
	h.Set("Content-Disposition", `attachment; filename="`+name+`"`)
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Length", itoa(len(body)))
	if r.Method != http.MethodHead {
		w.Write(body)
	}
}
