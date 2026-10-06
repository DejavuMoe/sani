#!/bin/sh
set -eu

# Only disposable local directories are used, even in the publish container.
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT
source_dir="$test_root/dist"
for lang in '' en/; do
  for page in "docs/${lang}index.md" docs/"${lang}"guide/*.md docs/"${lang}"reference/*.md docs/"${lang}"internals/*.md docs/"${lang}"project/*.md; do
    relative="${page#docs/}"
    out="$source_dir/${relative%.md}.html"
    mkdir -p "$(dirname "$out")"
    printf 'fixture\n' > "$out"
  done
done
mkdir "$source_dir/assets"
for file in 404.html favicon.svg hashmap.json assets/test.js assets/test.css; do
  printf 'fixture\n' > "$source_dir/$file"
done
printf '<urlset><url><loc>https://sani.zsh.moe/</loc></url></urlset>\n' > "$source_dir/sitemap.xml"
export DOCS_DEPLOY_ROOT="$test_root/site"
mkdir "$DOCS_DEPLOY_ROOT"
sha=0000000000000000000000000000000000000000
publish() { sh scripts/publish-docs.sh "$source_dir" "$sha-$1"; }
reject() { if publish "$1"; then echo "unexpected success: $1" >&2; exit 1; fi; }

publish 1-0
[ "$(readlink "$DOCS_DEPLOY_ROOT/html")" = "releases/$sha-1-0" ]
[ "$(stat -c %a "$DOCS_DEPLOY_ROOT/html/en/index.html")" = 644 ]
[ "$(stat -c %a "$DOCS_DEPLOY_ROOT/releases/$sha-1-0")" = 755 ]
publish 2-0
publish 1-1
[ ! -e "$DOCS_DEPLOY_ROOT/releases/$sha-1-1" ]
publish 2-0 # Repeated activation of the same release is harmless.
mkdir "$DOCS_DEPLOY_ROOT/releases/notes"
ln -s "$test_root" "$DOCS_DEPLOY_ROOT/releases/1111111111111111111111111111111111111111-0-0"
publish 2-1
[ -d "$DOCS_DEPLOY_ROOT/releases/notes" ]
[ -L "$DOCS_DEPLOY_ROOT/releases/1111111111111111111111111111111111111111-0-0" ]
[ -s "$DOCS_DEPLOY_ROOT/releases/$sha-2-0/index.html" ]
[ ! -e "$DOCS_DEPLOY_ROOT/releases/$sha-1-0" ]

# Incomplete or unsafe output never changes the live site.
: > "$source_dir/en/reference/api.html"
reject 3-0
printf 'fixture\n' > "$source_dir/en/reference/api.html"
ln -s /etc/passwd "$source_dir/leak"
reject 3-0
rm "$source_dir/leak"
printf secret > "$source_dir/.env"
reject 3-0
rm "$source_dir/.env"
[ "$(readlink "$DOCS_DEPLOY_ROOT/html")" = "releases/$sha-2-1" ]
reject '../../escape'

# Inject a failure after rename and verify automatic rollback.
mkdir "$test_root/shim"
DOCS_TEST_REAL_MV="$(command -v mv)"
DOCS_TEST_FAIL_ACTIVATE="$test_root/fail-once"
export DOCS_TEST_REAL_MV DOCS_TEST_FAIL_ACTIVATE
touch "$DOCS_TEST_FAIL_ACTIVATE"
cat > "$test_root/shim/mv" <<'SH'
#!/bin/sh
set -eu
"$DOCS_TEST_REAL_MV" "$@"
for destination do :; done
if [ "$destination" = "$DOCS_DEPLOY_ROOT/html" ] && [ -f "$DOCS_TEST_FAIL_ACTIVATE" ]; then
  rm "$DOCS_TEST_FAIL_ACTIVATE" "$DOCS_DEPLOY_ROOT/html/index.html"
fi
SH
chmod 755 "$test_root/shim/mv"
if PATH="$test_root/shim:$PATH" sh scripts/publish-docs.sh "$source_dir" "$sha-3-0"; then exit 1; fi
[ "$(readlink "$DOCS_DEPLOY_ROOT/html")" = "releases/$sha-2-1" ]
[ -s "$DOCS_DEPLOY_ROOT/html/index.html" ]

# Concurrent arrivals serialize, and an older build cannot roll back a newer one.
publish 5-0 &
first=$!
publish 4-0 &
second=$!
wait "$first"
wait "$second"
[ "$(readlink "$DOCS_DEPLOY_ROOT/html")" = "releases/$sha-5-0" ]

export DOCS_DEPLOY_ROOT="$test_root/existing"
mkdir -p "$DOCS_DEPLOY_ROOT/html"
reject 6-0
[ -d "$DOCS_DEPLOY_ROOT/html" ] && [ ! -L "$DOCS_DEPLOY_ROOT/html" ]
export DOCS_DEPLOY_ROOT="$test_root/legacy"
ln -s site "$DOCS_DEPLOY_ROOT"
reject 6-0
[ "$(readlink "$DOCS_DEPLOY_ROOT")" = site ]
export DOCS_DEPLOY_ROOT="$test_root/locked"
mkdir "$DOCS_DEPLOY_ROOT"
printf untouched > "$test_root/lock-target"
ln -s "$test_root/lock-target" "$DOCS_DEPLOY_ROOT/.deploy.lock"
reject 6-0
[ "$(cat "$test_root/lock-target")" = untouched ]
echo 'Documentation publish checks passed'
