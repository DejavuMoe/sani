#!/bin/sh
set -eu

site_dir="${1:-}"
fail() { echo "documentation output: $*" >&2; exit 65; }
[ -n "$site_dir" ] || { echo "usage: $0 SITE_DIR" >&2; exit 64; }
[ -d "$site_dir" ] && [ ! -L "$site_dir" ] || fail "not a directory: $site_dir"

# The publish container has no Node. Derive the required HTML from the same
# bilingual source directories instead of maintaining a second page list.
for lang in '' en/; do
  for page in "docs/${lang}index.md" docs/"${lang}"guide/*.md docs/"${lang}"reference/*.md docs/"${lang}"internals/*.md docs/"${lang}"project/*.md; do
    [ -f "$page" ] || fail "source page missing: $page (run from the repository root)"
    relative="${page#docs/}"
    [ -s "$site_dir/${relative%.md}.html" ] || fail "missing ${relative%.md}.html"
  done
done
for file in 404.html favicon.svg hashmap.json sitemap.xml; do
  [ -s "$site_dir/$file" ] || fail "missing $file"
done
[ -d "$site_dir/assets" ] || fail 'missing assets directory'
for ext in js css; do
  [ -n "$(find "$site_dir/assets" -type f -name "*.$ext" -size +0c -print -quit)" ] || fail "missing $ext assets"
done
grep -Fq '<loc>https://sani.zsh.moe/' "$site_dir/sitemap.xml" || fail 'incorrect sitemap hostname'

# Never publish links to workspace files, devices, secrets or Git metadata.
[ -z "$(find "$site_dir" -mindepth 1 ! -type d ! -type f -print -quit)" ] || fail 'symlink or special file found'
[ -z "$(find "$site_dir" -mindepth 1 -name '.*' -print -quit)" ] || fail 'hidden file or directory found'
echo "documentation output verified: $site_dir"
