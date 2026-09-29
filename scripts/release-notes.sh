#!/usr/bin/env bash
# Prints the release notes for a tag: its section of the English changelog,
# then how to get that version. Fails when the changelog has no section for
# the tag, so a release cannot go out undocumented.
set -euo pipefail

tag=${1:?usage: scripts/release-notes.sh vX.Y.Z}
changelog=docs/en/project/changelog.md
# The section without its heading, and without the date the release page
# shows anyway.
notes=$(awk -v heading="## $tag" '$0 == heading { on = 1; next } on && /^## / { exit } on' "$changelog" |
  sed -E '1,/[^[:space:]]/ s/^[0-9]{4}-[0-9]{2}-[0-9]{2} · //')
if [ -z "$(tr -d '[:space:]' <<<"$notes")" ]; then
  echo "release-notes: $changelog has no section \"## $tag\"" >&2
  exit 1
fi

docs=https://dejavumoe.github.io/sani
cat <<NOTES
$notes

## Install

With Docker, for linux/amd64, linux/arm64 and linux/arm/v7:

\`\`\`sh
docker pull ghcr.io/dejavumoe/sani:${tag#v}
\`\`\`

Or download the archive for your platform below. To check a download against
the checksums and the build provenance GitHub recorded for it:

\`\`\`sh
sha256sum --ignore-missing -c SHA256SUMS
gh attestation verify sani-linux-amd64.tar.gz --repo DejavuMoe/sani
\`\`\`

Back up before upgrading: the database schema is upgraded on start, and older
versions cannot open it afterwards. See [deployment]($docs/en/guide/deploy) and
[operations]($docs/en/guide/operations) · [中文更新日志]($docs/project/changelog)
NOTES
