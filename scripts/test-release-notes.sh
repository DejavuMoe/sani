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
  printf '\n[Version](./versioning#v095-exception) and [Upgrade](../guide/operations#step-2).\n' >> docs/en/project/changelog.md
  bash "$script" "$tag" > notes.md
  grep -Fxq "docker pull ghcr.io/dejavumoe/sani:$tag" notes.md
  grep -Fq '[Version](https://github.com/DejavuMoe/sani/blob/master/docs/en/project/versioning.md)' notes.md
  grep -Fq '[Upgrade](https://github.com/DejavuMoe/sani/blob/master/docs/en/guide/operations.md)' notes.md
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
