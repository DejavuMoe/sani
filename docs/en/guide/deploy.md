# Deployment

<p class="lead">Sani is a plain HTTP service. In production it needs a reverse proxy in front for HTTPS. The builder below edits the repository’s own configuration files for your domain.</p>

## Build your configuration

<ConfigBuilder />

The builder edits the repository’s actual `compose.yaml`, `deploy/sani.service`, `deploy/Caddyfile` and `deploy/nginx.conf`; highlighted lines are the ones filled in from your input. Every docs build checks that those lines still exist in the repository’s files, so the output can’t drift from them.

## With Docker Compose

A few things worth knowing about `compose.yaml`:

- **Localhost only.** The port is published as `127.0.0.1:8080:8080`, so outside traffic has to come through the reverse proxy.
- **Data in a volume.** The database lives in the `sani-data` volume, mounted at `/data`. Removing or recreating the container keeps it.
- **A tiny image.** It’s built `FROM scratch` and holds only the `sani` binary and CA certificates. It runs as the unprivileged user 65532 and has no shell, so to run a command inside, call `/sani` directly, as in `docker exec -it sani /sani passwd`.
- **A built-in health check.** The image defines a `HEALTHCHECK`, so `docker ps` shows it as `healthy`.

There’s no published image yet: `docker compose up -d` builds one locally. Upgrading later happens in the same directory:

```sh
git pull
docker compose up -d --build
```

## With systemd

Without Docker, let systemd run the binary. First get the binary:

::: code-group

```sh [Build from source]
make install build        # needs Go, Node and pnpm; produces bin/sani
scp bin/sani server:/tmp/sani
ssh server sudo install -m 755 /tmp/sani /usr/local/bin/sani
```

```sh [Copy it out of the image]
docker build -t sani .
docker create --name sani-bin sani
docker cp sani-bin:/sani ./sani && docker rm sani-bin
```

:::

The binary is statically linked and needs no libraries on the server. If the build machine’s OS or architecture differs from the server’s, run `make install web` and then cross-compile with something like `GOOS=linux GOARCH=arm64 make binary`.

Save the generated `sani.service` in `/etc/systemd/system/` and enable it:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now sani
journalctl -u sani -f        # the log has the setup code for the first visit
```

The example unit already takes care of:

- **No user to create.** `DynamicUser=yes` has systemd allocate a system user for Sani.
- **A fixed data directory.** `StateDirectory=sani` keeps the database in `/var/lib/sani`.
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

nginx needs a certificate you provide, for example from certbot. The example uses Let’s Encrypt’s default paths, and its second `server` block redirects HTTP to HTTPS:

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
