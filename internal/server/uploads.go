package server

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/DejavuMoe/sani/internal/auth"
	"github.com/DejavuMoe/sani/internal/links"
	"github.com/DejavuMoe/sani/internal/store"
)

const uploadChunkSize int64 = 25_000_000
const uploadTTL = time.Hour
const maxUploadSpace int64 = 8 << 30

type uploadSession struct {
	mu                   sync.Mutex
	id, owner, name      string
	size, offset         int64
	expires              time.Time
	input                linkInput
	linkID               int64
	lastOffset, lastSize int64
	lastSum              [sha256.Size]byte
}

func uploadOwner(r *http.Request) string {
	p := r.Context().Value(authKey{}).(*principal)
	if p.token != nil {
		return "t:" + hex.EncodeToString(auth.HashSecret(apiToken(r)))
	}
	return "s:" + hex.EncodeToString(p.session)
}

func (s *Server) uploadPath(id string) string { return filepath.Join(s.opt.FilesDir, ".chunk-"+id) }

func (s *Server) cleanRestartUploads() error {
	if s.opt.FilesDir == "" {
		return nil
	}
	entries, err := os.ReadDir(s.opt.FilesDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".chunk-") && storedName(strings.TrimPrefix(e.Name(), ".chunk-")) && e.Type().IsRegular() {
			if err := os.Remove(filepath.Join(s.opt.FilesDir, e.Name())); err != nil {
				return fmt.Errorf("remove abandoned upload: %w", err)
			}
		}
	}
	return nil
}

// Registry and per-session locks are always acquired without waiting on an
// active transfer, so one slow upload cannot stall unrelated requests.
func (s *Server) expireUploads(now time.Time) {
	s.uploadsMu.Lock()
	defer s.uploadsMu.Unlock()
	for id, up := range s.uploads {
		if !up.mu.TryLock() {
			continue
		}
		if !now.Before(up.expires) {
			if err := os.Remove(s.uploadPath(id)); err == nil || errors.Is(err, os.ErrNotExist) {
				delete(s.uploads, id)
			}
		}
		up.mu.Unlock()
	}
}

func (s *Server) beginUpload(w http.ResponseWriter, r *http.Request) {
	if s.opt.FilesURL == "" {
		writeError(w, http.StatusConflict, "files_disabled", "sharing files needs SANI_FILES_URL")
		return
	}
	var in struct {
		Name string `json:"name"`
		Size int64  `json:"size"`
		linkInput
	}
	if !decodeJSONMax(w, r, &in, 16<<10) {
		return
	}
	if in.Size <= 0 {
		writeError(w, http.StatusBadRequest, "file_required", "attach a file that is not empty")
		return
	}
	if in.Size > s.settings.Load().maxFileSize {
		writeError(w, http.StatusRequestEntityTooLarge, "file_too_large", "file exceeds the configured limit")
		return
	}
	if _, ierr := s.resolveInput(r, &in.linkInput, time.Now().UnixMilli()); ierr != nil {
		writeError(w, ierr.status, ierr.code, ierr.msg)
		return
	}
	s.expireUploads(time.Now())
	s.uploadsMu.Lock()
	defer s.uploadsMu.Unlock()
	// Retain at most 32 recent completion receipts without limiting successful
	// throughput. Active uploads keep their separate count and byte budgets.
	if len(s.uploads) >= 32 {
		var oldest *uploadSession
		for _, up := range s.uploads {
			if !up.mu.TryLock() {
				continue
			}
			if up.linkID != 0 && (oldest == nil || up.expires.Before(oldest.expires)) {
				if oldest != nil {
					oldest.mu.Unlock()
				}
				oldest = up
			} else {
				up.mu.Unlock()
			}
		}
		if oldest != nil {
			delete(s.uploads, oldest.id)
			oldest.mu.Unlock()
		}
	}
	owner, active, owned, reserved := uploadOwner(r), 0, 0, int64(0)
	for _, up := range s.uploads {
		// Size and owner are immutable; active reservations end only while
		// holding this registry lock.
		if up.size == 0 {
			continue
		}
		active++
		reserved += up.size
		if up.owner == owner {
			owned++
		}
	}
	if len(s.uploads) >= 32 || active >= 8 || owned >= 2 || reserved+in.Size > maxUploadSpace {
		writeError(w, http.StatusTooManyRequests, "upload_limit", "too many pending uploads; cancel one or wait for cleanup")
		return
	}
	var token [16]byte
	rand.Read(token[:])
	id := hex.EncodeToString(token[:])
	if err := os.MkdirAll(s.opt.FilesDir, 0o750); err != nil {
		s.internalError(w, r, err)
		return
	}
	f, err := os.OpenFile(s.uploadPath(id), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o640)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if err := f.Close(); err != nil {
		os.Remove(s.uploadPath(id))
		s.internalError(w, r, err)
		return
	}
	up := &uploadSession{id: id, owner: owner, name: links.FileName(in.Name), size: in.Size, input: in.linkInput, expires: time.Now().Add(uploadTTL)}
	s.uploads[id] = up
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "offset": 0, "chunkSize": uploadChunkSize, "expiresAt": up.expires})
}

func (s *Server) lockUpload(w http.ResponseWriter, r *http.Request) *uploadSession {
	s.uploadsMu.Lock()
	defer s.uploadsMu.Unlock()
	up := s.uploads[r.PathValue("id")]
	if up == nil || up.owner != uploadOwner(r) {
		writeError(w, http.StatusNotFound, "upload_not_found", "upload session not found")
		return nil
	}
	if !up.mu.TryLock() {
		writeError(w, http.StatusConflict, "upload_busy", "upload is busy")
		return nil
	}
	if !time.Now().Before(up.expires) {
		up.mu.Unlock()
		writeError(w, http.StatusNotFound, "upload_not_found", "upload session expired")
		return nil
	}
	return up
}

func (s *Server) uploadChunk(w http.ResponseWriter, r *http.Request) {
	up := s.lockUpload(w, r)
	if up == nil {
		return
	}
	defer up.mu.Unlock()
	offset, err := strconv.ParseInt(r.Header.Get("Upload-Offset"), 10, 64)
	n := r.ContentLength
	if err != nil || offset < 0 || n <= 0 || n > uploadChunkSize || up.linkID != 0 || offset > up.size || n > up.size-offset {
		writeError(w, http.StatusBadRequest, "upload_invalid", "provide a valid Upload-Offset and chunk Content-Length")
		return
	}
	duplicate := offset == up.lastOffset && n == up.lastSize && offset < up.offset
	if offset != up.offset && !duplicate {
		writeError(w, http.StatusConflict, "upload_offset", "chunk does not start at the current offset")
		return
	}
	rc := http.NewResponseController(w)
	rc.SetReadDeadline(time.Now().Add(transferTime(n)))
	rc.SetWriteDeadline(time.Now().Add(transferTime(n)))
	r.Body = http.MaxBytesReader(w, r.Body, n)
	h := sha256.New()
	var f *os.File
	var dest io.Writer = h
	if !duplicate {
		f, err = os.OpenFile(s.uploadPath(up.id), os.O_WRONLY, 0)
		if err == nil {
			_, err = f.Seek(offset, io.SeekStart)
		}
		if err != nil {
			if f != nil {
				f.Close()
			}
			s.internalError(w, r, err)
			return
		}
		defer f.Close()
		dest = io.MultiWriter(f, h)
	}
	written, err := io.Copy(dest, r.Body)
	if err != nil || written != n {
		if f != nil {
			f.Truncate(offset)
		}
		writeError(w, http.StatusBadRequest, "upload_invalid", "chunk transfer failed; retry this chunk")
		return
	}
	var sum [sha256.Size]byte
	copy(sum[:], h.Sum(nil))
	if duplicate {
		if sum != up.lastSum {
			writeError(w, http.StatusConflict, "upload_offset", "duplicate chunk contents differ")
			return
		}
	} else {
		if err := f.Sync(); err != nil {
			f.Truncate(offset)
			s.internalError(w, r, err)
			return
		}
		up.lastOffset, up.lastSize, up.lastSum = offset, n, sum
		up.offset += n
	}
	up.expires = time.Now().Add(uploadTTL)
	writeJSON(w, http.StatusOK, map[string]int64{"offset": up.offset})
}

func (s *Server) cancelUpload(w http.ResponseWriter, r *http.Request) {
	up := s.lockUpload(w, r)
	if up == nil {
		return
	}
	defer up.mu.Unlock()
	if err := os.Remove(s.uploadPath(up.id)); err != nil && !errors.Is(err, os.ErrNotExist) {
		s.internalError(w, r, err)
		return
	}
	s.uploadsMu.Lock()
	delete(s.uploads, up.id)
	s.uploadsMu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) completeUpload(w http.ResponseWriter, r *http.Request) {
	up := s.lockUpload(w, r)
	if up == nil {
		return
	}
	defer up.mu.Unlock()
	if up.linkID != 0 {
		l, err := s.store.GetLink(r.Context(), up.linkID)
		if err != nil {
			s.internalError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, s.toDTO(s.baseURL(r), l, time.Now().UnixMilli()))
		return
	}
	if up.offset != up.size {
		writeError(w, http.StatusConflict, "upload_incomplete", "upload all chunks before completing")
		return
	}
	if up.size > s.settings.Load().maxFileSize {
		writeError(w, http.StatusRequestEntityTooLarge, "file_too_large", "file exceeds the configured limit")
		return
	}
	now := time.Now().UnixMilli()
	p, ierr := s.resolveInput(r, &up.input, now)
	if ierr != nil {
		writeError(w, ierr.status, ierr.code, ierr.msg)
		return
	}
	s.filesMu.RLock()
	defer s.filesMu.RUnlock()
	f, err := os.Open(s.uploadPath(up.id))
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	h, head := sha256.New(), &prefix{max: 512}
	n, err := io.Copy(io.MultiWriter(h, head), io.LimitReader(f, up.size+1))
	f.Close()
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if n != up.size {
		writeError(w, http.StatusConflict, "upload_incomplete", "stored file size differs")
		return
	}
	ctype := mime.TypeByExtension(strings.ToLower(filepath.Ext(up.name)))
	if ctype == "" {
		ctype = http.DetectContentType(head.buf)
	}
	final := filepath.Join(s.opt.FilesDir, up.id)
	if err := os.Rename(s.uploadPath(up.id), final); err != nil {
		s.internalError(w, r, err)
		return
	}
	l := &store.Link{Kind: store.KindFile, Meta: store.MetaManual, Redirect: http.StatusFound, Enabled: true, CreatedAt: now, UpdatedAt: now,
		Content: &store.Content{Name: up.name, Type: ctype, Size: n, SHA256: h.Sum(nil), File: up.id}}
	applyOptions(l, p)
	if !s.save(w, r, l, p.Slug) {
		if err := os.Rename(final, s.uploadPath(up.id)); err != nil {
			s.log.Error("restore pending upload", "err", err)
		}
		return
	}
	s.uploadsMu.Lock()
	up.linkID = l.ID
	up.size = 0
	s.uploadsMu.Unlock()
	writeJSON(w, http.StatusCreated, s.toDTO(s.baseURL(r), l, now))
}
