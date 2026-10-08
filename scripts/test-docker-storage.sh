#!/usr/bin/env bash
# Exercise the default Compose deployment and permission repair against an image.
set -euo pipefail
image=${1:?usage: bash scripts/test-docker-storage.sh IMAGE}
work=$(mktemp -d)
name=sani-storage-${work##*.}
name=${name,,}
cleanup() {
  docker compose -p "$name" -f "$work/compose.yaml" down >/dev/null 2>&1 || true
  docker rm -f "$name-denied" "$name-bind" >/dev/null 2>&1 || true
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
# Keep the real template's mount; isolate only image, container name and host port.
sed -e "s|image: .*|image: $image|" -e "s|container_name: sani|container_name: $name-compose|" \
  -e 's|127.0.0.1:8080:8080|127.0.0.1::8080|' compose.yaml >"$work/compose.yaml"
compose=(docker compose -p "$name" -f "$work/compose.yaml")
if [ "$(docker info -f '{{.OperatingSystem}}')" = 'Docker Desktop' ]; then
  # Desktop's WSL file sharing creates missing paths before the daemon checks them.
  echo 'SKIP missing-directory rejection on Docker Desktop; native Linux CI covers it'
else
  if "${compose[@]}" up -d --pull never >"$work/missing.log" 2>&1; then
    echo 'missing bind directory unexpectedly accepted' >&2
    exit 1
  fi
  if ! grep -q 'bind source path does not exist' "$work/missing.log"; then
    cat "$work/missing.log" >&2
    exit 1
  fi
fi
test ! -e "$work/sani-data"
(
  cd "$work"
  sudo install -d -m 750 -o 65532 -g 65532 ./sani-data
)
"${compose[@]}" up -d --pull never
healthy "$name-compose"
docker logs "$name-compose" 2>&1 | grep -q setup_code
docker exec "$name-compose" /sani version
test "$(docker inspect -f '{{(index .Mounts 0).Type}}' "$name-compose")" = bind
test "$(sudo stat -c '%u:%g' "$work/sani-data/sani.db")" = 65532:65532
inode=$(sudo stat -c %i "$work/sani-data/sani.db")
"${compose[@]}" up -d --pull never --force-recreate
healthy "$name-compose"
test "$(sudo stat -c %i "$work/sani-data/sani.db")" = "$inode"
sudo test -s "$work/sani-data/sani.db"

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
echo 'storage: default Compose, initialized bind, recreation, permission repair and restart passed'
