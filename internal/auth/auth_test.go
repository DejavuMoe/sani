package auth

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestPasswordHash(t *testing.T) {
	h := HashPassword("correct horse battery staple")
	if !strings.HasPrefix(h, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatalf("unexpected hash format %q", h)
	}
	if !VerifyPassword("correct horse battery staple", h) {
		t.Fatal("the right password was rejected")
	}
	if VerifyPassword("correct horse battery stapl", h) {
		t.Fatal("a wrong password was accepted")
	}
	if HashPassword("same") == HashPassword("same") {
		t.Fatal("hashes must be salted")
	}
	for _, bad := range []string{"", "plain", "$argon2i$v=19$m=1,t=1,p=1$AA$AA", "$argon2id$v=19$m=999999999,t=1,p=1$AA$AA"} {
		if VerifyPassword("x", bad) {
			t.Errorf("malformed hash %q verified", bad)
		}
	}
}

func TestSecrets(t *testing.T) {
	a, ha := NewSecret("sani_")
	b, _ := NewSecret("sani_")
	if a == b || !strings.HasPrefix(a, "sani_") || len(a) != 48 {
		t.Fatalf("secrets %q %q", a, b)
	}
	if string(HashSecret(a)) != string(ha) {
		t.Fatal("HashSecret does not match the hash from NewSecret")
	}
}

func TestLimiter(t *testing.T) {
	l := NewLimiter(3, time.Minute)
	now := time.Now()
	for range 3 {
		if blocked, _ := l.Blocked("ip", now); blocked {
			t.Fatal("blocked too early")
		}
		l.Fail("ip", now)
	}
	blocked, wait := l.Blocked("ip", now.Add(10*time.Second))
	if !blocked || wait <= 0 || wait > 50*time.Second {
		t.Fatalf("after 3 failures: blocked=%v wait=%v", blocked, wait)
	}
	if blocked, _ := l.Blocked("other", now); blocked {
		t.Fatal("limits must be per key")
	}
	if blocked, _ := l.Blocked("ip", now.Add(time.Minute)); blocked {
		t.Fatal("the window must expire")
	}
	l.Fail("ip2", now)
	l.Reset("ip2")
	if blocked, _ := l.Blocked("ip2", now); blocked {
		t.Fatal("Reset must clear failures")
	}
}

func TestLimiterIsBounded(t *testing.T) {
	l := NewLimiter(3, time.Hour)
	now := time.Now()
	for i := range 3 * maxTracked {
		l.Fail(fmt.Sprint(i), now)
	}
	if n := len(l.hits); n > maxTracked {
		t.Fatalf("limiter holds %d keys", n)
	}
}
