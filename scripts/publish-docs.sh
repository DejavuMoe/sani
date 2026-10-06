#!/bin/sh
set -eu

source_dir="${1:-}"
release_id="${2:-}"
deploy_root="${DOCS_DEPLOY_ROOT:-/deploy}"
fail() { echo "documentation publish: $*" >&2; exit 1; }
valid_id() { printf '%s\n' "$1" | grep -Eq '^[0-9a-f]{40}-[0-9]+-[0-9]+$'; }
[ -n "$source_dir" ] || fail 'missing site directory'
valid_id "$release_id" || fail 'expected COMMIT_SHA-PIPELINE_NUMBER-RERUNS'
case "$deploy_root" in /*) ;; *) fail 'deployment root must be absolute' ;; esac
[ -d "$deploy_root" ] && [ ! -L "$deploy_root" ] || fail 'deployment root must be an existing directory, not a symlink'
deploy_root="$(realpath -e "$deploy_root")"
[ "$deploy_root" != / ] || fail 'refusing the filesystem root'
sh scripts/verify-docs-output.sh "$source_dir"
source_real="$(realpath -e "$source_dir")"
case "$deploy_root/" in "$source_real/"*) fail 'deployment root overlaps the source' ;; esac
case "$source_real/" in "$deploy_root/"*) fail 'source overlaps the deployment root' ;; esac

release_root="$deploy_root/releases"
live_path="$deploy_root/html"
lock_file="$deploy_root/.deploy.lock"
build_dir="$release_root/.build-$release_id"
candidate_dir="$release_root/$release_id"
next_link="$deploy_root/.next-$release_id"
rollback_link="$deploy_root/.rollback-$release_id"

[ ! -L "$release_root" ] || fail 'release root must not be a symlink'
mkdir -p "$release_root"
[ ! -L "$lock_file" ] || fail 'deployment lock must not be a symlink'
[ ! -e "$lock_file" ] || [ -f "$lock_file" ] || fail 'deployment lock must be a regular file'
exec 9>>"$lock_file"
flock -x -w 900 9 || fail 'timed out waiting for the deployment lock'

old_link_value=''
old_link_target=''
if [ -L "$live_path" ]; then
  [ -s "$live_path/index.html" ] && [ -s "$live_path/en/index.html" ] || fail 'current site is unreadable'
  old_link_value="$(readlink "$live_path")"
  old_link_target="$(realpath -e "$live_path")"
  current_id="$(basename "$old_link_target")"
  valid_id "$current_id" || fail 'current site has an unmanaged release ID'
  [ "$old_link_target" = "$release_root/$current_id" ] || fail 'current site is outside the release root'
  [ ! -L "$release_root/$current_id" ] || fail 'current release must not be a symlink'
  incoming="${release_id#*-}"
  current="${current_id#*-}"
  if [ "${incoming%-*}" -lt "${current%-*}" ] || {
    [ "${incoming%-*}" -eq "${current%-*}" ] && [ "${incoming##*-}" -le "${current##*-}" ];
  }; then
    echo "stale documentation release skipped: $release_id (current: $current_id)"
    exit 0
  fi
elif [ -e "$live_path" ]; then
  fail 'refusing to replace an existing html directory or file'
fi

for reserved in "$build_dir" "$candidate_dir" "$next_link" "$rollback_link"; do
  [ ! -e "$reserved" ] && [ ! -L "$reserved" ] || fail "release path already exists: $reserved"
done
cleanup() {
  [ ! -L "$next_link" ] || rm -f -- "$next_link"
  [ ! -L "$rollback_link" ] || rm -f -- "$rollback_link"
  [ ! -d "$build_dir" ] || rm -rf -- "$build_dir"
}
mkdir "$build_dir"
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
cp -a "$source_dir"/. "$build_dir"/
find "$build_dir" -type d -exec chmod 0755 {} +
find "$build_dir" -type f -exec chmod 0644 {} +
sh scripts/verify-docs-output.sh "$build_dir"
mv -T -- "$build_dir" "$candidate_dir"

# Both names are on the deployment volume: rename replaces the symlink in one
# operation, so readers see either complete release, never a partial copy.
ln -s "releases/$release_id" "$next_link"
[ -s "$next_link/index.html" ] || fail 'new symlink does not resolve'
mv -T -f -- "$next_link" "$live_path"
if [ ! -L "$live_path" ] || [ "$(realpath -e "$live_path")" != "$candidate_dir" ] ||
   [ ! -s "$live_path/index.html" ] || [ ! -s "$live_path/en/index.html" ]; then
  if [ -n "$old_link_value" ]; then
    ln -s "$old_link_value" "$rollback_link"
    mv -T -f -- "$rollback_link" "$live_path" || fail 'activation failed; restoring the old symlink also failed'
  else
    rm -f -- "$live_path"
  fi
  fail 'activation failed; previous state restored'
fi

# Keep the current and previous release. Never prune unrelated directories or
# symlinks, and only prune after successful activation.
for obsolete in "$release_root"/*; do
  [ -d "$obsolete" ] && [ ! -L "$obsolete" ] || continue
  valid_id "$(basename "$obsolete")" || continue
  [ "$obsolete" != "$candidate_dir" ] && [ "$obsolete" != "$old_link_target" ] || continue
  rm -r -- "$obsolete" || echo "warning: could not remove old release: $obsolete" >&2
done
echo "documentation activated atomically: html -> releases/$release_id"
