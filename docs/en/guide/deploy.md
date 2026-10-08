# Deployment

<p class="lead">Sani is a plain HTTP service. In production it needs a reverse proxy in front for HTTPS. The builder below edits the repository’s own configuration files for your domain.</p>

## Build your configuration

<ConfigBuilder />

The builder edits the repository’s actual `compose.yaml`, `deploy/sani.service`, `deploy/Caddyfile` and `deploy/nginx.conf`; highlighted lines are the ones filled in from your input. Every docs build checks that those lines still exist in the repository’s files, so the output can’t drift from them.

## With Docker Compose

Every release publishes the multi-platform image `ghcr.io/dejavumoe/sani`, for `linux/amd64`, `linux/arm64` and `linux/arm/v7` (a Raspberry Pi, for example). Create a directory on the server, save the generated `compose.yaml` in it, and start Sani:

```sh
docker compose up -d
```

A few things worth knowing about `compose.yaml`:

- **Localhost only.** The port is published as `127.0.0.1:8080:8080`, so outside traffic has to come through the reverse proxy.
- **Data in a volume.** The database and shared files live in the `sani-data` volume, mounted at `/data`. Removing or recreating the container keeps it.
- **A tiny image.** It’s built `FROM scratch`, about 25 MB, and holds only the `sani` binary and CA certificates. It runs as the unprivileged user 65532 and has no shell, so to run a command inside, call `/sani` directly, as in `docker exec -it sani /sani passwd`.
- **A built-in health check.** The image defines a `HEALTHCHECK`, so `docker ps` shows it as `healthy`.

### Image versions

| Tag | Points at |
|---|---|
| `v0.7.0` | The exact version matching Git tag and GitHub Release `v0.7.0` |
| `v0.7.0-rc.1` | The matching prerelease Git tag, available only once published |

From v0.7.0, image tags match Git tags and GitHub Releases exactly, including the `v` prefix. Releases no longer publish `latest`, major or minor floating tags. The repository template and configuration builder pin `ghcr.io/dejavumoe/sani:v0.7.0`. Check that the version appears in [Releases](https://github.com/DejavuMoe/sani/releases) before deploying; a release preparation branch may refer to a version that is not published yet.

To upgrade, [back up](./operations#backup), change `image:` in `compose.yaml` to the target version's full tag, then run:

```sh
docker compose pull
docker compose up -d
```

To build the image from source instead, replace the `image:` line with `build: .` in a checkout of the repository and run `docker compose up -d --build`.

### Data directory permissions {#data-permissions}

The default `sani-data:/data` is a Docker named volume. A new volume inherits the image's `/data` ownership, `65532:65532`; no host directory needs to be created manually. Recreating the container preserves it. Do not upgrade with `docker compose down -v`, which deletes named volumes.

To keep the data beside the Compose file instead, run this in that directory **before** switching to `./sani-data:/data`:

```sh
sudo install -d -m 750 -o 65532 -g 65532 ./sani-data
```

Then use the service mount below and remove the unused top-level `volumes:` declaration. `create_host_path: false` prevents Docker from silently creating a `root:root` directory if initialization was missed:

```yaml
    volumes:
      - type: bind
        source: ./sani-data
        target: /data
        bind:
          create_host_path: false
```

If startup already reports `sani: open database: unable to open database file (14)`, inspect the actual mount and permissions first:

```sh
docker inspect sani --format '{{json .Mounts}}'
ls -ldn ./sani-data
```

If the mount is confirmed to be `./sani-data` in the current directory, owned by `root:root` with mode `755`, the unprivileged container cannot create the database or SQLite WAL/SHM files. Stop the service and repair only this dedicated data directory:

```sh
docker compose stop sani
sudo chown -R 65532:65532 ./sani-data
sudo chmod -R u+rwX ./sani-data
sudo chmod 750 ./sani-data
docker compose up -d
docker compose logs --tail=50 sani
docker exec sani /sani healthcheck
```

Keep existing data: do not delete the directory or switch to an empty volume. Do not work around permissions with `chmod 777` or a root container. If ownership is correct, also check for a read-only mount, disk exhaustion or host SELinux policy. These UID/GID values assume ordinary Docker Engine; rootless Docker or user namespace remapping requires the mapped host UID/GID instead.

## With systemd {#binaries}

Without Docker, let systemd run the binary. Every release has archives for these platforms on [GitHub Releases](https://github.com/DejavuMoe/sani/releases), each with the `sani` binary, the license and the readme:

| System | Architecture | File |
|---|---|---|
| Linux | x86-64 | `sani-linux-amd64.tar.gz` |
| Linux | ARM64 | `sani-linux-arm64.tar.gz` |
| Linux | ARMv7 (32-bit) | `sani-linux-armv7.tar.gz` |
| macOS | Intel | `sani-darwin-amd64.tar.gz` |
| macOS | Apple silicon | `sani-darwin-arm64.tar.gz` |
| Windows | x86-64 | `sani-windows-amd64.zip` |
| Windows | ARM64 | `sani-windows-arm64.zip` |
| FreeBSD | x86-64 | `sani-freebsd-amd64.tar.gz` |

The binary is statically linked and needs no libraries on the server. On macOS, Windows or FreeBSD, unpack it and run `sani` (`sani.exe` on Windows), configured the same way. On a Linux server, download it, check it against the checksums, and install it:

::: code-group

```sh [Download]
base=https://github.com/DejavuMoe/sani/releases/download/v0.7.0
curl -fsSLO "$base/sani-linux-amd64.tar.gz" -O "$base/SHA256SUMS"
sha256sum --ignore-missing -c SHA256SUMS
tar -xzf sani-linux-amd64.tar.gz sani
sudo install -m 755 sani /usr/local/bin/sani
```

```sh [Build from source]
make install build        # needs Go, Node and pnpm; produces bin/sani
scp bin/sani server:/tmp/sani
ssh server sudo install -m 755 /tmp/sani /usr/local/bin/sani
```

:::

The download path pins `v0.7.0`. When upgrading, replace it with the published target version's tag.

### Checking where a build came from {#verify}

Release files and images are built by GitHub Actions from the tagged commit, with build provenance attached. With the [GitHub CLI](https://cli.github.com), you can confirm that what you have really came from this repository:

```sh
gh attestation verify sani-linux-amd64.tar.gz -R DejavuMoe/sani
gh attestation verify oci://ghcr.io/dejavumoe/sani:v0.7.0 -R DejavuMoe/sani
```

Save the generated `sani.service` in `/etc/systemd/system/` and enable it:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now sani
journalctl -u sani -f        # the log has the setup code for the first visit
```

The example unit already takes care of:

- **No user to create.** `DynamicUser=yes` has systemd allocate a system user for Sani.
- **A fixed data directory.** `StateDirectory=sani` keeps the database and shared files in `/var/lib/sani`.
- **Localhost only, in a sandbox.** It listens on `127.0.0.1:8080`, sees the system directories read-only, can’t gain privileges and can only use network and local sockets.

## Reverse proxy {#proxy}

Sani doesn’t handle TLS itself. Caddy, nginx or any other reverse proxy will do, as long as:

1. it forwards requests to `127.0.0.1:8080`;
2. it sets the `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` headers;
3. Sani runs with [`SANI_TRUST_PROXY=true`](../reference/configuration#sani-trust-proxy); otherwise it ignores those headers.

### Caddy

Caddy obtains and renews the certificate and sets those headers on its own, so the configuration is three lines:

::: code-group

<<< @/../deploy/Caddyfile{txt} [deploy/Caddyfile]

:::

### nginx

nginx needs a certificate you provide, for example from certbot. The example uses Let’s Encrypt’s default paths, and its second `server` block redirects HTTP to HTTPS. nginx accepts request bodies of 1 MB by default, too little for imports and uploads, so the example raises that limit:

::: code-group

<<< @/../deploy/nginx.conf{nginx} [deploy/nginx.conf]

:::

### Other proxies and CDNs

Traefik, Cloudflare Tunnel and the like work the same way: meet the three requirements above.

With a CDN in front, mind the client address: Sani uses the **last** `X-Forwarded-For` entry, which is the address seen by the proxy closest to it. Have that proxy restore the real visitor address first, for example with nginx’s `real_ip` module. Otherwise everyone coming through the same CDN node counts as one client for sign-in rate limiting. The client address is only used for rate limiting and logs; redirects and statistics don’t use it.

## Domain {#domain}

The main domain serves short links as well as text and file share pages. It comes from the first of these that is set:

1. the [`SANI_BASE_URL`](../reference/configuration#sani-base-url) environment variable;
2. the short domain entered in Settings;
3. the address you opened the admin app at. With `SANI_TRUST_PROXY`, that’s the `X-Forwarded-Host` and `X-Forwarded-Proto` your proxy passes on.

Setting `SANI_BASE_URL` in production is a good idea. Short links then don’t depend on where you opened the admin app, and the setup code in the log comes with a link you can open directly.

Someone opening the bare domain `https://s.example.com/` lands on the admin app’s sign-in page. To send them to your home page instead, set [`SANI_ROOT_REDIRECT`](../reference/configuration#sani-root-redirect).

## Download domain {#files-domain}

Text and file **share pages stay on the main domain at `/p/slug`**. [Sharing files](./usage#shares) also needs a different hostname, such as `f.example.com`, used only for file downloads and raw text. A subdomain of the main domain works. Both domains point to the same Sani and reverse proxy; there is no extra service to run.

For example, with `SANI_BASE_URL=https://example.com` and `SANI_FILES_URL=https://f.example.com`:

| Purpose | Example address |
|---|---|
| Short link | `https://example.com/blog` |
| Text share page | `https://example.com/p/xxx1` |
| File share page | `https://example.com/p/xxx2` |
| File download | `https://f.example.com/xxx2/report.pdf` |
| Raw text | `https://f.example.com/xxx1` |

The link copied after creating a share opens its page on the main domain. Visitors access the download domain when they follow Download or Raw. To configure it:

1. **DNS.** Point the files domain at the same server.
2. **The proxy.** Serve it like the main domain, with the same headers: list it in the Caddy site address (`example.com, f.example.com {` for the example above), or add it to both `server_name` lines in nginx, with a certificate that covers both. The builder above does this when you fill in a download domain.
3. **Body size.** Uploads can be as large as [`SANI_MAX_FILE_MB`](../reference/configuration#sani-max-file-mb) plus 1 MB. Caddy has no limit by default. The nginx example sets `client_max_body_size 65m` for the default 64 MB file limit plus form overhead. If you raise `SANI_MAX_FILE_MB`, raise the proxy limit too.
4. **Sani.** Set [`SANI_FILES_URL`](../reference/configuration#sani-files-url) to `https://f.example.com` and restart.

Sani requires a **different hostname** for downloads to isolate uploaded content from the admin app. Changing only the path does not isolate browser origins. Another port is not accepted either, because browsers share cookies across the ports of one host. A subdomain works, since Sani’s session cookie is not sent to subdomains. Uploads still go through the main domain’s API.

Without a download domain, short links and text shares still work: visitors can read and copy text on its `/p/` page on the main domain. File uploads are disabled, and text pages have no Raw or Download links.

## The first password {#first-password}

There are two ways:

- **With the setup code (recommended).** As long as there’s no password, Sani generates a new setup code at every start and writes it to the log. With `SANI_BASE_URL` set, the same log line has a link with the code filled in, such as `https://s.example.com/admin/#setup=k7m2-p9x4-hq3d`. The code sits after the `#`, which browsers never send to the server, so it doesn’t end up in any access log.
- **With `SANI_PASSWORD`.** Handy for automated deployments. The environment wins: at every start, if it differs from the stored password, it replaces it and signs out every device, and Settings can no longer change the password.

## Upgrading and rolling back {#upgrade}

On upgrade, Sani updates the database schema when it starts. An older binary refuses to open a database a newer one has upgraded, and exits instead of risking it:

```
sani: database schema version 2 is newer than this build supports (1)
```

So [back up](./operations#backup) before upgrading, and roll back with the backup you took.
