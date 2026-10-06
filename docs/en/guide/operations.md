# Operations

<p class="lead">All of Sani’s data is in one SQLite file, plus a directory of shared files, so there isn’t much to do day to day: back up regularly, upgrade now and then, and reset the password if you forget it.</p>

## Backups {#backup}

`sani backup` writes a consistent copy of the database while Sani keeps running. It uses SQLite’s `VACUUM INTO`, so the copy is compacted as well.

::: code-group

```sh [Docker]
docker exec sani /sani backup - > sani-$(date +%F).db
```

```sh [systemd]
sudo SANI_DATA_DIR=/var/lib/sani sani backup /root/sani-$(date +%F).db
```

```sh [Binary]
sani backup ~/backups/sani-$(date +%F).db
```

:::

- With `-` as the file name, the copy goes to standard output, which suits containers. Don’t add `-t` to `docker exec`: a terminal would mangle the output.
- An existing file is never overwritten.
- The backup holds the password hash and every link’s statistics; keep it as safe as the database itself.

A daily backup with cron that keeps the last 14:

```sh
# crontab -e
15 4 * * * docker exec sani /sani backup - > /srv/backup/sani-$(date +\%F).db && find /srv/backup -name 'sani-*.db' -mtime +14 -delete
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

In an isolated local instance, check `/healthz`, login, URL redirects, text bodies, file downloads and SHA-256 before switching the live instance or DNS. Downgrades after a schema migration need the complete pre-upgrade backup; do not force an older binary to open the migrated database. The repository’s `go test ./cmd/sani -run TestStoppedBackup` exercises shutdown, flushing, the database snapshot, file copy, restore and hash verification.

## Upgrading {#upgrade}

[Back up](#backup) first, then put the new version in place:

::: code-group

```sh [Docker]
docker compose pull
docker compose up -d
```

```sh [systemd]
curl -fsSL https://github.com/DejavuMoe/sani/releases/latest/download/sani-linux-amd64.tar.gz | tar -xz sani
sudo install -m 755 sani /usr/local/bin/sani
sudo systemctl restart sani
```

:::

What each version changes, and anything to watch for when upgrading, is in the [changelog](../project/changelog). The database schema is upgraded on start and older versions can’t open it afterwards, so going back means restoring the backup from before the upgrade.

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

**Fewer clicks than expected.** Crawlers, link previews and your own clicks from the admin app don’t count. Browsers cache permanent (301) redirects, so repeat visits from the same browser skip Sani. See [Statistics](./statistics).

**The File tab says sharing files needs a domain of its own.** Set up a [files domain](./deploy#files-domain) and `SANI_FILES_URL`.

**Uploads fail with “too large”, though the file is under the limit.** The reverse proxy refuses the body before Sani sees it: raise nginx’s `client_max_body_size`, or the equivalent in your proxy.

**The admin app only says “The admin app is not part of this build”.** The binary was built with plain `go build`, without the frontend. Rebuild with `make build`.
