#!/usr/bin/env bash
# Redirect throughput and latency against a local build, plus a check that
# every counted request shows up in the click totals.
#
#   make load                       # defaults
#   CONNS=256 DURATION=20s scripts/load.sh
#
# Needs bombardier: go install github.com/codesenberg/bombardier@latest
set -euo pipefail

BIN=${BIN:-./bin/sani}
PORT=${PORT:-18900}
CONNS=${CONNS:-128}
DURATION=${DURATION:-15s}
PASSWORD=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
BASE=http://127.0.0.1:$PORT
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15'

command -v bombardier >/dev/null || { echo "bombardier not found (go install github.com/codesenberg/bombardier@latest)" >&2; exit 1; }
[ -x "$BIN" ] || { echo "$BIN not found; run make binary" >&2; exit 1; }

# A healthy response may belong to an older fixture, even while our child starts.
if curl -q --noproxy '*' --connect-timeout 1 --max-time 2 -s "$BASE/healthz" >/dev/null; then
	echo "$BASE already answers HTTP; choose a free PORT" >&2
	exit 1
fi

DATA=$(mktemp -d)
JAR=$(mktemp)
OUT=$(mktemp)
PID=
cleanup() {
	if [ -n "$PID" ]; then
		kill "$PID" 2>/dev/null || true
		wait "$PID" 2>/dev/null || true
	fi
	rm -rf "$DATA" "$JAR" "$OUT"
}
trap cleanup EXIT

SANI_LISTEN=127.0.0.1:$PORT SANI_DATA_DIR=$DATA SANI_PASSWORD=$PASSWORD SANI_FETCH_META=false \
	SANI_LOG_LEVEL=info SANI_LOG_FORMAT=json "$BIN" >"$DATA/server.log" 2>&1 &
PID=$!
READY=false
for _ in $(seq 50); do
	kill -0 "$PID" 2>/dev/null || break
	# This child's ready event is emitted only after its own net.Listen succeeds.
	if grep -qs '"msg":"sani is ready"' "$DATA/server.log" &&
		curl -q --noproxy '*' --connect-timeout 1 --max-time 2 -fs "$BASE/healthz" >/dev/null &&
		kill -0 "$PID" 2>/dev/null; then
		READY=true
		break
	fi
	sleep 0.1
done
if [ "$READY" != true ]; then
	cat "$DATA/server.log" >&2
	echo "disposable Sani child did not become ready" >&2
	exit 1
fi

curl -q --noproxy '*' --connect-timeout 1 --max-time 5 -fs -c "$JAR" -H 'Content-Type: application/json' -d "{\"password\":\"$PASSWORD\"}" "$BASE/api/admin/v1/session" >/dev/null
api() { curl -q --noproxy '*' --connect-timeout 1 --max-time 5 -fs -b "$JAR" -H 'Content-Type: application/json' "$@"; }
api -d '{"url":"https://example.com/landing?utm_source=load","slug":"hot"}' "$BASE/api/admin/v1/links" >/dev/null
api -d '{"url":"https://example.com/other","slug":"limited","maxClicks":1000000000}' "$BASE/api/admin/v1/links" >/dev/null

run() {
	local name=$1 path=$2
	echo
	echo "== $name: GET $path, $CONNS connections, $DURATION"
	bombardier -c "$CONNS" -d "$DURATION" -l -H "User-Agent: $UA" -H "Referer: https://t.co/x" -p r "$BASE$path" >"$OUT"
	grep -E 'Reqs/sec|Latency|50%|75%|90%|95%|99%|HTTP codes|[0-9]xx' "$OUT" || cat "$OUT"
}

run "cached redirect, click counted" /hot
SERVED=$(grep -oE '3xx - [0-9]+' "$OUT" | grep -oE '[0-9]+$')
run "redirect with a click limit" /limited
run "unknown slug (negative cache)" /nope

# Clicks are flushed every 2s; give the last batch time to land.
sleep 3
COUNTED=$(api "$BASE/api/admin/v1/links/1" | grep -oE '"clicks":[0-9]+' | grep -oE '[0-9]+$')
echo
echo "== /hot: $SERVED redirects served, $COUNTED clicks recorded"
if [ "$SERVED" != "$COUNTED" ]; then
	echo "click count mismatch" >&2
	exit 1
fi
