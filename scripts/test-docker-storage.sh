#!/usr/bin/env bash
# Exercise the documented storage choices against a locally built image.
set -euo pipefail
image=${1:?usage: bash scripts/test-docker-storage.sh IMAGE}
work=$(mktemp -d)
name=sani-storage-$(basename "$work")
cleanup() {
  docker rm -f "$name-named" "$name-denied" "$name-bind" >/dev/null 2>&1 || true
  docker volume rm "$name" >/dev/null 2>&1 || true
  sudo rm -rf -- "$work"
}
trap cleanup EXIT

healthy() {
  for ((i=0; i<30; i++)); do
    if [ "$(docker inspect -f '{{.State.Health.Status}}' "$1")" = healthy ]; then return; fi
    sleep 1
  done
  docker logs "$1"
  return 1
}

test "$(docker image inspect -f '{{.Config.User}}' "$image")" = 65532:65532
docker run -d --name "$name-named" --health-interval=1s --health-start-period=0s -v "$name:/data" "$image" >/dev/null
healthy "$name-named"
docker logs "$name-named" 2>&1 | grep -q setup_code
docker exec "$name-named" /sani version
docker restart "$name-named" >/dev/null
healthy "$name-named"
docker cp "$name-named:/data/sani.db" "$work/named.db"
test -s "$work/named.db"

# Reproduce Docker's root-owned, mode-755 host directory before applying the docs repair.
sudo install -d -m 755 -o 0 -g 0 "$work/bind"
if docker run --name "$name-denied" --mount "type=bind,src=$work/bind,dst=/data" "$image" >"$work/denied.log" 2>&1; then
  echo 'root-owned bind mount unexpectedly accepted writes' >&2
  exit 1
fi
grep -q 'unable to open database file (14)' "$work/denied.log"
sudo chown -R 65532:65532 "$work/bind"
sudo chmod -R u+rwX "$work/bind"
sudo chmod 750 "$work/bind"
docker run -d --name "$name-bind" --health-interval=1s --health-start-period=0s --mount "type=bind,src=$work/bind,dst=/data" "$image" >/dev/null
healthy "$name-bind"
test "$(sudo stat -c '%u:%g' "$work/bind/sani.db")" = 65532:65532
docker logs "$name-bind" 2>&1 | grep -q setup_code
docker restart "$name-bind" >/dev/null
healthy "$name-bind"
echo 'storage: named volume, denied bind mount, permission repair and restart passed'
