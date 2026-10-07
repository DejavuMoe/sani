// Package auth provides password hashing, random secrets and a small
// failure limiter for the single-owner admin.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

// Argon2id parameters from the OWASP password storage recommendations.
const (
	argonTime    = 2
	argonMemory  = 19 * 1024 // KiB
	argonThreads = 1
	argonKeyLen  = 32
	saltLen      = 16
)

const (
	MinPasswordLength = 8
	MaxPasswordBytes  = 1024
)

var (
	ErrPasswordShort = fmt.Errorf("use at least %d characters", MinPasswordLength)
	ErrPasswordLong  = fmt.Errorf("use at most %d bytes", MaxPasswordBytes)
)

// ValidatePassword is shared by HTTP, CLI and environment configuration.
func ValidatePassword(password string) error {
	if utf8.RuneCountInString(password) < MinPasswordLength {
		return ErrPasswordShort
	}
	if len(password) > MaxPasswordBytes {
		return ErrPasswordLong
	}
	return nil
}

var b64 = base64.RawStdEncoding

// verifySlots bounds concurrent hashing; each one holds 19 MiB.
var verifySlots = make(chan struct{}, 2)

// HashPassword returns a PHC-formatted argon2id hash.
func HashPassword(password string) string {
	salt := make([]byte, saltLen)
	rand.Read(salt)
	verifySlots <- struct{}{}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	<-verifySlots
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads, b64.EncodeToString(salt), b64.EncodeToString(key))
}

// VerifyPassword checks password against a hash from HashPassword.
func VerifyPassword(password, encoded string) bool {
	if len(password) > MaxPasswordBytes {
		return false
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var version int
	var mem uint32
	var t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false
	}
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &mem, &t, &p); err != nil || mem > 256*1024 || t > 16 || p == 0 {
		return false
	}
	salt, err := b64.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := b64.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false
	}
	verifySlots <- struct{}{}
	got := argon2.IDKey([]byte(password), salt, t, mem, p, uint32(len(want)))
	<-verifySlots
	return subtle.ConstantTimeCompare(got, want) == 1
}

const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// NewSecret returns a random secret with the given prefix and its hash.
// 43 base62 characters carry about 256 bits.
func NewSecret(prefix string) (secret string, hash []byte) {
	var b strings.Builder
	b.WriteString(prefix)
	n := big.NewInt(int64(len(base62)))
	for range 43 {
		i, _ := rand.Int(rand.Reader, n)
		b.WriteByte(base62[i.Int64()])
	}
	secret = b.String()
	return secret, HashSecret(secret)
}

// HashSecret derives the lookup hash stored for a session or token.
func HashSecret(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}

// Limiter blocks a key after too many failures within a window.
type Limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string]*failures
}

type failures struct {
	n     int
	start time.Time
}

func NewLimiter(max int, window time.Duration) *Limiter {
	return &Limiter{max: max, window: window, hits: map[string]*failures{}}
}

// Blocked reports whether key is locked out and for how long.
func (l *Limiter) Blocked(key string, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	f := l.hits[key]
	if f == nil || now.Sub(f.start) >= l.window {
		return false, 0
	}
	if f.n >= l.max {
		return true, f.start.Add(l.window).Sub(now)
	}
	return false, 0
}

// Fail records a failure for key.
func (l *Limiter) Fail(key string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	f := l.hits[key]
	if f == nil || now.Sub(f.start) >= l.window {
		if len(l.hits) >= maxTracked {
			l.prune(now)
		}
		l.hits[key] = &failures{n: 1, start: now}
		return
	}
	f.n++
}

// Reset forgets failures for key after a success.
func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	delete(l.hits, key)
	l.mu.Unlock()
}

// maxTracked bounds the keys a limiter remembers.
const maxTracked = 10000

// prune drops expired entries, then arbitrary ones if the map is still full.
func (l *Limiter) prune(now time.Time) {
	for k, f := range l.hits {
		if now.Sub(f.start) >= l.window {
			delete(l.hits, k)
		}
	}
	for k := range l.hits {
		if len(l.hits) < maxTracked*9/10 {
			break
		}
		delete(l.hits, k)
	}
}
