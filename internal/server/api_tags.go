package server

import (
	"errors"
	"net/http"
	"time"

	"github.com/DejavuMoe/sani/internal/store"
)

func (s *Server) deleteTag(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	err := s.store.DeleteTag(r.Context(), id, time.Now().UnixMilli())
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "no such tag")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func tagError(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, store.ErrTagsInvalid):
		writeError(w, http.StatusBadRequest, "tags_invalid", "invalid tag name, color or tag IDs")
	case errors.Is(err, store.ErrTagLimit):
		writeError(w, http.StatusConflict, "tag_limit", "at most 1,000 tags are allowed")
	case errors.Is(err, store.ErrTagTaken):
		writeError(w, http.StatusConflict, "tag_taken", "this tag name is already in use")
	default:
		return false
	}
	return true
}

func (s *Server) updateTag(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if !decodeJSONMax(w, r, &in, 4096) {
		return
	}
	tag, err := s.store.UpdateTag(r.Context(), id, in.Name, in.Color)
	if tagError(w, err) {
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "no such tag")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, tag)
}

func (s *Server) listTags(w http.ResponseWriter, r *http.Request) {
	catalog, err := s.store.Tags(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, catalog)
}

func (s *Server) createTag(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if !decodeJSONMax(w, r, &in, 4096) {
		return
	}
	tag, err := s.store.CreateTag(r.Context(), in.Name, in.Color)
	if tagError(w, err) {
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, tag)
}
