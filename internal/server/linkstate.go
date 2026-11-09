package server

// linkStatus is the availability state the API reports for a link.
type linkStatus string

const (
	statusActive    linkStatus = "active"
	statusDisabled  linkStatus = "disabled"
	statusExpired   linkStatus = "expired"
	statusExhausted linkStatus = "exhausted"
)

// linkState derives a link's state from its switch, limits and click count.
// The first matching state wins, in this order:
//
//	disabled  — the owner switched it off, even if it also expired or ran out
//	expired   — expiresAt is set and nowMs reaches it, even if also exhausted
//	exhausted — maxClicks is set and clicks reaches it
//	active    — none of the above
//
// expiresAt == 0 means never and maxClicks == 0 means unlimited, so neither
// can expire or exhaust a link.
func linkState(enabled bool, expiresAt, maxClicks, clicks, nowMs int64) linkStatus {
	if closed(enabled, expiresAt, nowMs) {
		if !enabled {
			return statusDisabled
		}
		return statusExpired
	}
	if maxClicks > 0 && clicks >= maxClicks {
		return statusExhausted
	}
	return statusActive
}

// closed reports whether a link refuses every visit before counting: it is
// disabled or past its expiry.
func closed(enabled bool, expiresAt, nowMs int64) bool {
	return !enabled || (expiresAt != 0 && nowMs >= expiresAt)
}
