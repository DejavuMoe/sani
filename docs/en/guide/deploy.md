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
- **A tiny image.** It’s built `FROM scratch`, about 24 MB, and holds only the `sani` binary and CA certificates. It runs as the unprivileged user 65532 and has no shell, so to run a command inside, call `/sani` directly, as in `docker exec -it sani /sani passwd`.
- **A built-in health check.** The image defines a `HEALTHCHECK`, so `docker ps` shows it as `healthy`.

The image has these tags:

| Tag | Points at |
|---|---|
| `latest` | The newest release |
| `0.3` | The newest patch release of 0.3, which only fixes things |
| `0.3.0` | That one version, for good |

`compose.yaml` uses `latest`. To decide for yourself when to upgrade, put a version number there instead. To upgrade, [back up](./operations#backup) first, then pull the new image:

```sh
docker compose pull
docker compose up -d
```

To build the image from source instead, replace the `image:` line with `build: .` in a checkout of the repository and run `docker compose up -d --build`.

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
base=https://github.com/DejavuMoe/sani/releases/latest/download
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

`latest/download` always points at the newest release; to pin one, use a path like `download/v0.3.0` instead.

### Checking where a build came from {#verify}

Release files and images are built by GitHub Actions from the tagged commit, with build provenance attached. With the [GitHub CLI](https://cli.github.com), you can confirm that what you have really came from this repository:

```sh
gh attestation verify sani-linux-amd64.tar.gz -R DejavuMoe/sani
gh attestation verify oci://ghcr.io/dejavumoe/sani:latest -R DejavuMoe/sani
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

Short links use the first of these that is set:

1. the [`SANI_BASE_URL`](../reference/configuration#sani-base-url) environment variable;
2. the short domain entered in Settings;
3. the address you opened the admin app at. With `SANI_TRUST_PROXY`, that’s the `X-Forwarded-Host` and `X-Forwarded-Proto` your proxy passes on.

Setting `SANI_BASE_URL` in production is a good idea. Short links then don’t depend on where you opened the admin app, and the setup code in the log comes with a link you can open directly.

Someone opening the bare domain `https://s.example.com/` lands on the admin app’s sign-in page. To send them to your home page instead, set [`SANI_ROOT_REDIRECT`](../reference/configuration#sani-root-redirect).

## Files domain {#files-domain}

[Sharing files](./usage#shares) needs a second domain, such as `f.example.com`, that serves the files and raw text. It’s the same Sani behind the same proxy; there’s nothing else to run.

1. **DNS.** Point the files domain at the same server.
2. **The proxy.** Serve it like the short domain, with the same headers: list it in the Caddy site address (`s.example.com, f.example.com {`), or add it to both `server_name` lines in nginx, with a certificate that covers both. The builder above does this when you fill in a files domain.
3. **Body size.** Uploads can be as large as [`SANI_MAX_FILE_MB`](../reference/configuration#sani-max-file-mb) plus 1 MB. Caddy has no limit by default; in nginx, set `client_max_body_size` to at least that, as the example does for the default 64 MB. If you raise `SANI_MAX_FILE_MB`, raise this too.
4. **Sani.** Set [`SANI_FILES_URL`](../reference/configuration#sani-files-url) to `https://f.example.com` and restart.

The files domain must be a different host, not just another port: browsers share cookies across the ports of one host, and keeping uploaded files away from the admin app’s cookies is the point. A subdomain of the short domain is fine, since Sani’s session cookie is never sent to subdomains. Uploads go to the short domain’s API; only the downloads come from the files domain.

Without a files domain, texts still work: visitors read and copy them on their page.

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
