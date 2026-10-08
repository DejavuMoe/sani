#!/usr/bin/env bash
# Prints the release notes for a tag: its section of the English changelog,
# then how to get that version. Fails when the changelog has no section for
# the tag, so a release cannot go out undocumented.
set -euo pipefail

tag=${1:?usage: scripts/release-notes.sh vX.Y.Z}
if ! grep -Fxq "    image: ghcr.io/dejavumoe/sani:$tag" compose.yaml; then
  echo "release-notes: compose.yaml must pin the release tag $tag" >&2
  exit 1
fi
changelog=docs/en/project/changelog.md
docs=https://github.com/DejavuMoe/sani/blob/master/docs
# The section without its heading, and without the date the release page
# shows anyway. The changelog's links are relative to the docs site; on the
# release page they point at the pages in the repository instead, without
# anchors, which GitHub names differently.
notes=$(awk -v heading="## $tag" '$0 == heading { on = 1; next } on && /^## / { exit } on' "$changelog" |
  sed -E '1,/[^[:space:]]/ s/^[0-9]{4}-[0-9]{2}-[0-9]{2} · //' |
  sed -E "s#\]\(\.\./([a-z-]+/[a-z-]+)(\#[a-z-]+)?\)#]($docs/en/\1.md)#g; s#\]\(\./([a-z-]+)(\#[a-z-]+)?\)#]($docs/en/project/\1.md)#g")
if [ -z "$(tr -d '[:space:]' <<<"$notes")" ]; then
  echo "release-notes: $changelog has no section \"## $tag\"" >&2
  exit 1
fi

cat <<NOTES
$notes

## Install

With Docker, for linux/amd64, linux/arm64 and linux/arm/v7:

\`\`\`sh
docker pull ghcr.io/dejavumoe/sani:${tag}
\`\`\`

Or download the archive for your platform below. To check a download against
the checksums and the build provenance GitHub recorded for it:

\`\`\`sh
sha256sum --ignore-missing -c SHA256SUMS
gh attestation verify sani-linux-amd64.tar.gz --repo DejavuMoe/sani
\`\`\`

Back up before upgrading. If an upgrade changes the database schema, older
versions may no longer open it. See [deployment]($docs/en/guide/deploy.md) and
[operations]($docs/en/guide/operations.md) · [中文更新日志]($docs/project/changelog.md)
NOTES
