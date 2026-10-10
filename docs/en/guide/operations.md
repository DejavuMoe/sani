# Operations

<p class="lead">All of Sani’s data is in one SQLite file, plus a directory of shared files, so there isn’t much to do day to day: back up regularly, upgrade now and then, and reset the password if you forget it.</p>

## Share expiry, deletion and file cleanup {#share-cleanup}

Expiry, an exhausted visit limit and disabling only block further access; **they do not automatically delete records, text or files**. An administrator can adjust the limits or delete the share. A limit of 1 means one counted visit, not destruction after reading: a file counts when a valid `200`/`206` content response starts, not when the visitor finishes downloading.

Deleting a URL, text or file share stops new origin requests immediately, then background cleanup works in two stages:

1. Soft deletion retains the record for restoration. Maintenance checks every minute and purges records deleted more than an hour ago, together with their statistics, text and file references.
2. A file scan runs about every ten minutes, removing files with no database reference and a modification time older than ten minutes. Leftover `.upload-*` temporary files must be older than an hour.

With the service running continuously and no permission errors or active uploads delaying cleanup, ordinary files are usually reclaimed about **60–70 minutes** after deletion. This is a maintenance interval, not a deadline. Scanning excludes uploads and skips a round while an upload is writing. A stopped service does no cleanup; the first maintenance run is about a minute after restart and uses the original deletion time. Check logs for `purge deleted links`, `list files`, `list stored files` or `remove file` errors, and `removed unused files` success messages.

A record can be restored until it is purged or its slug is reclaimed. Reusing the slug removes the old record early, making its file eligible for cleanup. Restoration does not reset expiry or consumed visits. Cleanup does not alter existing backups or promise secure erasure from storage.

The 32-character hexadecimal names in `files/` are random storage names. Seeing one shortly after deleting a share is expected; an expired but undeleted share keeps its file. `sani.db` stores the whole instance's links, settings, account and statistics. `sani.db-wal` and `sani.db-shm` are SQLite runtime files, so their continued presence is normal too. Deleting a share does not delete the database or necessarily shrink its file. Do not manually remove active database files, WAL/SHM or files whose references are unknown; back up as described below first.

## Backups {#backup}

`sani backup` writes a consistent copy of the database while Sani keeps running. It uses SQLite’s `VACUUM INTO`, so the copy is compacted as well.

::: code-group

```sh [Docker]
(umask 077; set -C; docker exec sani /sani backup - > sani-$(date +%F).db)
```

```sh [systemd]
sudo SANI_DATA_DIR=/var/lib/sani sani backup /root/sani-$(date +%F).db
```

```sh [Binary]
sani backup ~/backups/sani-$(date +%F).db
```

:::

- With `-` as the file name, the copy goes to standard output, which suits containers. Don’t add `-t` to `docker exec`: a terminal would mangle the output.
- Named backups are created with `0600` permissions, refuse existing files or symlinks, and remove incomplete output on failure. Use directory ACLs on Windows; only trusted users should be able to write to the backup directory.
- The host shell creates stdout redirection files. The examples use `umask 077` to restrict permissions and `set -C` to prevent overwrites. Failed redirection may leave an incomplete file; do not restore it.
- Backups contain password, session and token hashes, saved proxy passwords and statistics. Upgrading does not change permissions on old backups: review them separately, using `0600` for files, `0700` for directories, or equivalent Windows ACLs.

A daily backup with cron that keeps the last 14:

```sh
# crontab -e
15 4 * * * (umask 077; set -C; docker exec sani /sani backup - > /srv/backup/sani-$(date +\%F).db) && find /srv/backup -name 'sani-*.db' -mtime +14 -delete
```

For a list of links you can import elsewhere, use Settings → Data → Export (see [Import and export](./import-export)). An export leaves out daily statistics, referrers, tokens, texts and files, so it doesn’t replace a backup.

### Back up the database and files together {#backup-files}

Texts live in SQLite; uploaded bytes live in `files/`. **For a complete backup, stop every Sani instance and any other database writers before copying the whole data directory.** A standalone `sani backup` contains committed database data only, excluding in-memory clicks and file bytes.

Although uploaded files are immutable, online garbage collection can remove files no longer referenced by a link. Taking an online database snapshot and copying `files/` later does not ensure all referenced bytes survive. Reclaiming a slug can make its old file eligible for cleanup earlier too.

These commands check for a successful shutdown before copying the database, any remaining WAL, and files. Leave the service stopped if copying fails, fix the error, then start it. A failed or forced shutdown does not prove the final click batch was saved.

::: code-group

```sh [Docker]
set -eu
backup="$PWD/sani-full-$(date +%Y%m%d-%H%M%S)"
test ! -e "$backup"
docker stop --time 30 sani
test "$(docker inspect -f '{{.State.ExitCode}}' sani)" = 0
docker cp sani:/data "$backup"
docker start sani
```

```sh [systemd]
set -eu
backup="/root/sani-full-$(date +%Y%m%d-%H%M%S)"
sudo test ! -e "$backup"
sudo systemctl stop sani
test "$(systemctl show sani -p ExecMainStatus --value)" = 0
sudo cp -a /var/lib/sani "$backup"
sudo systemctl start sani
```

:::
Keep this directory as one backup set, with the Sani version, time and configuration. Restrict access to the database and configuration; verify sizes and SHA-256 hashes after copying to another machine. If a full online backup is necessary, use storage that snapshots the database and files together and test its restore procedure. Copy order alone is not a consistency guarantee.

## Restoring

Preserve the current data first, stop all writers, then choose the matching procedure:

1. **Full directory backup:** restore into a new empty directory or volume, keeping `sani.db`, any `sani.db-wal`/`sani.db-shm`, and `files/` from the same snapshot. Do not mix in files from the old running instance. Point `SANI_DATA_DIR` or the Compose volume at the restored location and restore ownership (`65532:65532` in the image).
2. **Database made by `sani backup`:** restore it as `sani.db` in an empty directory, without the old instance’s WAL/SHM. This is complete for URL and text links. File shares also need `files/` copied during the same stopped-service interval. An online database snapshot alone cannot guarantee old downloads remain available.

In an isolated local instance, check `/healthz`, login, URL redirects, text bodies, file downloads and SHA-256 before switching the live instance or DNS. Downgrades after a schema migration need the complete pre-upgrade backup; do not force an older binary to open the migrated database. `go test ./cmd/sani -run TestStoppedBackup` checks storage-level flushing, snapshots and file copies. `make smoke` additionally runs the real binary through SIGTERM shutdown, CLI backup to standard output, and HTTP access to restored URLs, texts, files and tags. Neither replaces a restore rehearsal for your deployment.

## Upgrading {#upgrade}

This release removes old management API routes and introduces `/api/admin/v1` plus the bounded `/api/v1` compatibility profile. Before upgrading, **export JSON in the old admin app**, then stop the instance cleanly and make a complete snapshot of the database (including any WAL/SHM), `files/`, Compose/environment/secrets, proxy/domain configuration and the pinned old image/binary. Keep it outside the live data directory. JSON contains URL links and tags only; it cannot restore shared texts/files, credentials or complete statistics. CSV is an optional additional copy. **Normal upgrades migrate in place; do not export/reimport as the upgrade path.**

Before first startup, run the new binary's [`preflight`](../reference/cli#sani-preflight) against stopped data or its full copy, under the deployment UID (Docker `65532:65532`) and original configuration. With Compose, after selecting the verified target image and stopping the old service, run `docker compose run --rm --no-deps sani preflight`. Review the report and resolve missing/corrupt files or permission errors. Leave space for a database safety copy, SQLite transaction/WAL and uploaded files. Startup creates a database-only safety copy before migrating schema 1–5 to 6, preserves IDs/slugs/password/token/session hashes/settings/statistics/file names, and adds random file deletion keys. Existing public URLs and milliseconds remain unchanged. Configure the existing canonical main domain before using `/api/v1`; do not guess an old domain from a Host header.

Validate old login/session/token, redirects (including old long targets), raw text, file download SHA-256, tags and statistics. Repeat startup and run direct HTTP contract checks. If startup fails, retain stderr and the untouched full snapshot; diagnose the named preflight/migration step and retry after fixing the cause. For rollback, stop the new instance, preserve its failed data separately, restore the **complete pre-upgrade snapshot into an empty directory**, then start the pinned old binary/image with its old configuration. Never point an old binary at schema 6 or mix files/config from different snapshots. Writes made after upgrading are not in the old snapshot.

Repository drill (disposable fixtures, never production): `OLD_BIN=/absolute/path/to/old-sani make upgrade-drill`. The script creates an old schema-5 instance, exports JSON, saves stopped data/files/config, upgrades, tests HTTP contracts and old public URLs, verifies repeat startup and missing-file rejection, then restores the full snapshot and boots the old binary. CI uses baseline commit `8e374df55bdbd4a45353c1f6eeec2bfc3a671635`. This complements `make smoke` and does not replace rehearsing your deployment's snapshot restore.


Read the target release’s [changelog](../project/changelog), pin its version tag or image digest, and [verify downloaded artifacts](./deploy#verify). Take a [complete stopped-service backup](#backup-files) and retain the old binary or image and configuration. For this upgrade backup, omit the restart at the end of the backup example until the version has been replaced:

::: code-group

```sh [Docker]
docker compose pull
docker compose up -d
```

```sh [systemd]
# sani is the target binary, downloaded and verified beforehand
sudo systemctl stop sani
sudo install -m 755 sani /usr/local/bin/sani
sudo systemctl start sani
SANI_LISTEN=127.0.0.1:8080 sani healthcheck
```

:::

After startup, check logs and `/healthz`, then sign in, follow a redirect, read a text and download a file. Match the health-check address to your `SANI_LISTEN`; `/healthz` proves process liveness, not database writability or backup recoverability. Startup applies schema migrations. To roll back, stop the new version, restore the pre-upgrade backup into an empty directory, and start the old version with its original configuration. Replacing only the image or binary does not roll back migrated data.

## Resetting the password

If you forget the password, `sani passwd` sets a new one and signs out every device:

::: code-group

```sh [Docker]
docker exec -it sani /sani passwd
```

```sh [systemd]
sudo SANI_DATA_DIR=/var/lib/sani sani passwd
```

:::

You can also pipe it in: `echo 'a-new-password' | docker exec -i sani /sani passwd`.

If `SANI_PASSWORD` is set, the password in the environment takes over again at the next start; change the environment instead.

API tokens are not affected by password changes. If you think a token leaked, revoke it in Settings → API tokens.

## Logs {#logs}

Logs go to standard error: `docker logs sani` with Docker, `journalctl -u sani` with systemd. [`SANI_LOG_FORMAT`](../reference/configuration#sani-log-format) and [`SANI_LOG_LEVEL`](../reference/configuration#sani-log-level) control the format and detail.

| Level | Records |
|---|---|
| `info` | Startup (address, data directory, time zone, version), shutdown, setting or changing the password, imports |
| `warn` | The setup code for the first visit, failed sign-ins and wrong setup codes (with the client address) |
| `error` | Failed requests, and failures in background work such as writing clicks or cleaning up |
| `debug` | Why fetching a title or icon failed |

There’s no access log: redirects don’t show up in Sani’s logs. If you need one, use your reverse proxy’s.

## Health checks

- `GET /healthz` answers `200` with `ok` and needs no sign-in, so external monitors can use it.
- `sani healthcheck` requests `/healthz` locally and exits with 0 on success. The Docker image’s `HEALTHCHECK` runs it.

## Stopping and restarting

On `SIGTERM` or `SIGINT`, Sani stops accepting requests and gives active requests 10 seconds before closing their connections. It then cancels background work and waits up to 10 seconds for jobs and remaining handlers, followed by a final click flush with its own 5-second deadline. Failures produce a nonzero exit code. The Compose and systemd examples allow 30 seconds; use `docker stop --time 30` when stopping manually.

Clicks normally attempt to flush every 2 seconds. Disk exhaustion, lock waits or persistent write failures extend the backlog; a forced exit can lose all unflushed clicks. SQLite uses WAL with `synchronous=NORMAL`: the database stays consistent, but a power loss may also lose recently committed transactions. Two seconds is not a durability guarantee.

SQLite waits at most 1 second per external write-lock attempt; cancellation of a Go context cannot immediately interrupt the driver’s busy handler. Investigate `flush clicks` and `final click flush` errors for disk space, permissions and other writers. `/healthz` is a liveness check, not proof that storage is writable.

## Troubleshooting

**Short links show the wrong domain.** Set [`SANI_BASE_URL`](../reference/configuration#sani-base-url), or enter the short domain in Settings.

**A few failed sign-ins lock everyone out.** Sani is behind a reverse proxy but `SANI_TRUST_PROXY=true` isn’t set, so every request seems to come from the proxy. Set it and restart.

**Titles and icons never show up.** The server may not reach the internet, the site may refuse the fetch, or the destination may resolve to a private address, which Sani never fetches. If the server reaches the internet through a proxy, set `HTTPS_PROXY`. `SANI_LOG_LEVEL=debug` logs the reason for each failure.

**Fewer clicks than expected.** Crawlers, link previews and your own clicks from the admin app don’t count. Unlimited permanent (301/308) redirects allow one day of browser caching, so repeat visits skip Sani. See [Statistics](./statistics) and [CDN caching](./deploy#cdn-cache).

**The File tab says sharing files needs a domain of its own.** Set up a [files domain](./deploy#files-domain) and `SANI_FILES_URL`.

**Uploads fail with “too large”, though the file is under the limit.** The reverse proxy refuses the body before Sani sees it: raise nginx’s `client_max_body_size`, or the equivalent in your proxy.

**The admin app only says “The admin app is not part of this build”.** The binary was built with plain `go build`, without the frontend. Rebuild with `make build`.

Compatibility API deletion is permanent in SQLite; files are reclaimed asynchronously by the same ten-minute sweeper and age threshold. Management deletions retain the one-hour restore window.
