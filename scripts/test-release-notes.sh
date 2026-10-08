#!/usr/bin/env bash
set -euo pipefail
script=$PWD/scripts/release-notes.sh
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
cd "$work"
mkdir -p docs/en/project
for tag in v0.7.0 v0.7.0-rc.1; do
  printf '    image: ghcr.io/dejavumoe/sani:%s\n' "$tag" > compose.yaml
  printf '## %s\n\n2026-10-08 · Release fixture.\n' "$tag" > docs/en/project/changelog.md
  bash "$script" "$tag" > notes.md
  grep -Fxq "docker pull ghcr.io/dejavumoe/sani:$tag" notes.md
done
for image in latest 0.7.0 v0.6.0; do
  printf '    image: ghcr.io/dejavumoe/sani:%s\n' "$image" > compose.yaml
  if bash "$script" v0.7.0 > notes.md 2> error.log; then
    echo "release accepted mismatched image $image" >&2
    exit 1
  fi
  grep -q 'must pin the release tag' error.log
done
printf '    image: ghcr.io/dejavumoe/sani:v0.7.0\n' > compose.yaml
if bash "$script" v0.7.0 > notes.md 2> error.log; then
  echo 'release accepted a missing changelog entry' >&2
  exit 1
fi
grep -q 'has no section' error.log
echo 'release notes: exact stable/prerelease tags, mismatches and missing changelog passed'
