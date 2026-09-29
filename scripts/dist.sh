#!/usr/bin/env bash
# Builds the release archives into dist/: sani for every platform below, with
# LICENSE and README.md, and SHA256SUMS over all of them. The admin app has to
# be built first (make web). `make dist` and the release workflow run this.
#
# Archive names carry no version, so
# https://github.com/DejavuMoe/sani/releases/latest/download/<name>
# always points at the newest release.
set -euo pipefail

version=${VERSION:?set VERSION, e.g. VERSION=v0.1.0}
out=$PWD/dist

# GOOS/GOARCH, and GOARM for 32-bit ARM.
targets=(
  linux/amd64
  linux/arm64
  linux/arm/7
  darwin/amd64
  darwin/arm64
  windows/amd64
  windows/arm64
  freebsd/amd64
)

if [ ! -f internal/webui/dist/index.html ]; then
  echo "dist: build the admin app first (make web)" >&2
  exit 1
fi

# Every file gets the commit's time, so building a tag twice gives the same
# archives.
export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct 2>/dev/null || date +%s)}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
rm -rf "$out"
mkdir -p "$out"

for target in "${targets[@]}"; do
  IFS=/ read -r os arch arm <<<"$target"
  name=sani-$os-$arch${arm:+v$arm}
  exe=sani
  [ "$os" = windows ] && exe=sani.exe
  dir=$work/$name
  mkdir -p "$dir"

  CGO_ENABLED=0 GOOS=$os GOARCH=$arch GOARM=$arm \
    go build -trimpath -ldflags "-s -w -buildid= -X main.version=$version" -o "$dir/$exe" ./cmd/sani
  cp LICENSE README.md "$dir/"
  touch -d "@$SOURCE_DATE_EPOCH" "$dir"/*

  if [ "$os" = windows ]; then
    (cd "$dir" && zip -qX "$out/$name.zip" "$exe" LICENSE README.md)
  else
    tar --sort=name --mtime="@$SOURCE_DATE_EPOCH" --owner=0 --group=0 --numeric-owner \
      -C "$dir" -cf - "$exe" LICENSE README.md | gzip -9n >"$out/$name.tar.gz"
  fi
  echo "$name"
done

(cd "$out" && sha256sum -- *.tar.gz *.zip >SHA256SUMS)
