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

### Shared files {#backup-files}

Texts are in the database, but [shared files](./usage#shares) are kept next to it in `files/`, and `sani backup` reminds you of that. Copy the directory after the database: files never change once uploaded, so a copy taken after the database has every file the database refers to.

::: code-group

```sh [Docker]
docker run --rm --volumes-from sani -v "$PWD":/backup alpine \
  tar -czf /backup/sani-files-$(date +%F).tar.gz -C /data files
```

```sh [systemd]
sudo tar -czf /root/sani-files-$(date +%F).tar.gz -C /var/lib/sani files
```

:::

With many files, `rsync` to the same place each time only copies the new ones. A file whose link is gone is removed from `files/` an hour or so after the link is deleted.

## Restoring

Stop Sani, replace `sani.db` with the backup, delete the `sani.db-wal` and `sani.db-shm` next to it if they exist, and start Sani again.

::: code-group

```sh [Docker]
docker compose stop
docker run --rm --volumes-from sani -v "$PWD":/backup alpine sh -c \
  'cp /backup/sani-2026-09-29.db /data/sani.db && rm -f /data/sani.db-wal /data/sani.db-shm && chown 65532:65532 /data/sani.db'
docker compose start
```

```sh [systemd]
sudo systemctl stop sani
sudo cp sani-2026-09-29.db /var/lib/sani/sani.db
sudo rm -f /var/lib/sani/sani.db-wal /var/lib/sani/sani.db-shm
sudo chown --reference=/var/lib/sani /var/lib/sani/sani.db
sudo systemctl start sani
```

:::

The image has no shell, so with Docker a throwaway `alpine` container copies the file and hands it to the user Sani runs as. To bring back shared files too, unpack their archive into the data directory in the same step, as in `tar -xzf /backup/sani-files-2026-09-29.tar.gz -C /data && chown -R 65532:65532 /data/files`. Files the restored database doesn’t know are removed on their own.

Moving to another server is the same: back up on the old one, restore on the new one, then point DNS at it.

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

On `SIGTERM` or `SIGINT`, Sani stops accepting requests, gives the ones in flight up to 10 seconds to finish, writes the clicks still in memory to the database and exits. Both `docker stop` and `systemctl stop` send `SIGTERM`.

Clicks are written every 2 seconds. If the process is killed outright or the machine loses power, at most the last 2 seconds of clicks are lost.

## Troubleshooting

**Short links show the wrong domain.** Set [`SANI_BASE_URL`](../reference/configuration#sani-base-url), or enter the short domain in Settings.

**A few failed sign-ins lock everyone out.** Sani is behind a reverse proxy but `SANI_TRUST_PROXY=true` isn’t set, so every request seems to come from the proxy. Set it and restart.

**Titles and icons never show up.** The server may not reach the internet, the site may refuse the fetch, or the destination may resolve to a private address, which Sani never fetches. If the server reaches the internet through a proxy, set `HTTPS_PROXY`. `SANI_LOG_LEVEL=debug` logs the reason for each failure.

**Fewer clicks than expected.** Crawlers, link previews and your own clicks from the admin app don’t count. Browsers cache permanent (301) redirects, so repeat visits from the same browser skip Sani. See [Statistics](./statistics).

**The File tab says sharing files needs a domain of its own.** Set up a [files domain](./deploy#files-domain) and `SANI_FILES_URL`.

**Uploads fail with “too large”, though the file is under the limit.** The reverse proxy refuses the body before Sani sees it: raise nginx’s `client_max_body_size`, or the equivalent in your proxy.

**The admin app only says “The admin app is not part of this build”.** The binary was built with plain `go build`, without the frontend. Rebuild with `make build`.
