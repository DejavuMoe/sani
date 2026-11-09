package server

import (
	"math"
	"testing"
)

func TestLinkState(t *testing.T) {
	const now = int64(1_700_000_000_000)
	tests := []struct {
		name      string
		enabled   bool
		expiresAt int64
		maxClicks int64
		clicks    int64
		nowMs     int64
		want      linkStatus
	}{
		{name: "active", enabled: true, nowMs: now, want: statusActive},
		{name: "disabled", enabled: false, nowMs: now, want: statusDisabled},
		{name: "disabled beats expired", enabled: false, expiresAt: now - 1, nowMs: now, want: statusDisabled},
		{name: "disabled beats exhausted", enabled: false, maxClicks: 2, clicks: 2, nowMs: now, want: statusDisabled},
		{
			name: "disabled beats both", enabled: false, expiresAt: now, maxClicks: 2, clicks: 9, nowMs: now,
			want: statusDisabled,
		},
		{name: "expired at the boundary", enabled: true, expiresAt: now, nowMs: now, want: statusExpired},
		{name: "expired past the boundary", enabled: true, expiresAt: now - 1, nowMs: now, want: statusExpired},
		{name: "not yet expired", enabled: true, expiresAt: now + 1, nowMs: now, want: statusActive},
		{
			name: "expired beats exhausted", enabled: true, expiresAt: now, maxClicks: 2, clicks: 2, nowMs: now,
			want: statusExpired,
		},
		{name: "exhausted at the limit", enabled: true, maxClicks: 2, clicks: 2, nowMs: now, want: statusExhausted},
		{name: "exhausted past the limit", enabled: true, maxClicks: 2, clicks: 3, nowMs: now, want: statusExhausted},
		{name: "clicks left", enabled: true, maxClicks: 2, clicks: 1, nowMs: now, want: statusActive},
		{name: "zero max clicks means unlimited", enabled: true, maxClicks: 0, clicks: math.MaxInt64, nowMs: now, want: statusActive},
		{name: "zero expiry means never", enabled: true, expiresAt: 0, nowMs: math.MaxInt64, want: statusActive},
		{name: "zero value", enabled: true, want: statusActive},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := linkState(tt.enabled, tt.expiresAt, tt.maxClicks, tt.clicks, tt.nowMs)
			if got != tt.want {
				t.Errorf("linkState(%v, %d, %d, %d, %d) = %q, want %q",
					tt.enabled, tt.expiresAt, tt.maxClicks, tt.clicks, tt.nowMs, got, tt.want)
			}
		})
	}
}

func TestClosed(t *testing.T) {
	const now = int64(1_700_000_000_000)
	tests := []struct {
		name      string
		enabled   bool
		expiresAt int64
		nowMs     int64
		want      bool
	}{
		{name: "open", enabled: true, nowMs: now, want: false},
		{name: "disabled", enabled: false, nowMs: now, want: true},
		{name: "expired at the boundary", enabled: true, expiresAt: now, nowMs: now, want: true},
		{name: "not yet expired", enabled: true, expiresAt: now + 1, nowMs: now, want: false},
		{name: "zero expiry never closes", enabled: true, expiresAt: 0, nowMs: math.MaxInt64, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := closed(tt.enabled, tt.expiresAt, tt.nowMs); got != tt.want {
				t.Errorf("closed(%v, %d, %d) = %v, want %v", tt.enabled, tt.expiresAt, tt.nowMs, got, tt.want)
			}
		})
	}
}
