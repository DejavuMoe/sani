# Configuration

<p class="lead">Sani is configured entirely through environment variables; there’s no configuration file. An empty value counts as unset. At startup every variable is checked, and all problems are reported together.</p>

## Overview

| Variable | Default | What it sets |
|---|---|---|
| [`SANI_LISTEN`](#sani-listen) | `:8080` | Address to listen on |
| [`SANI_DATA_DIR`](#sani-data-dir) | `data` | Directory for the database |
| [`SANI_BASE_URL`](#sani-base-url) | — | Domain of your short links |
| [`SANI_PASSWORD`](#sani-password) | — | Fixed admin password |
| [`SANI_SETUP_CODE`](#sani-setup-code) | random | Code for choosing the first password |
| [`SANI_ROOT_REDIRECT`](#sani-root-redirect) | — | Where the bare domain goes |
| [`SANI_TRUST_PROXY`](#sani-trust-proxy) | `false` | Trust the reverse proxy’s headers |
| [`SANI_SLUG_LENGTH`](#sani-slug-length) | `5` | Length of generated slugs |
| [`SANI_FETCH_META`](#sani-fetch-meta) | `true` | Fetch titles and icons automatically |
| [`SANI_FORWARD_QUERY`](#sani-forward-query) | `true` | Pass query strings on to destinations |
| [`SANI_CACHE_SIZE`](#sani-cache-size) | `100000` | Redirect targets kept in memory |
| [`SANI_LOG_LEVEL`](#sani-log-level) | `info` | Log level |
| [`SANI_LOG_FORMAT`](#sani-log-format) | `text` | Log format |
| [`TZ`](#tz) | system | Time zone for daily statistics |

The repository’s `.env.example` lists every variable with a comment, as a starting point.

## Server

### `SANI_LISTEN`

Default `:8080`. The address and port to listen on; `:8080` means every interface. When only a reverse proxy on the same machine should reach Sani, use `127.0.0.1:8080`, as the example systemd unit does. The Docker image keeps `:8080`, and `compose.yaml` publishes the port on localhost only.

### `SANI_DATA_DIR`

Default `data`, relative to the working directory. The database file `sani.db` lives here; the directory is created if it doesn’t exist. It’s `/data` in the Docker image and `/var/lib/sani` in the systemd example.

You’ll also see `sani.db-wal` and `sani.db-shm` there. They belong to SQLite’s WAL mode; don’t delete them on their own. To copy the database, use [`sani backup`](./cli#sani-backup).

### `SANI_BASE_URL`

No default. The public origin of your short links: a scheme and a host, optionally with a port, and no path. For example `https://s.example.com`.

Without it, short links use the domain entered in Settings, and without that, the address you opened the admin app at. When it’s set, the domain in Settings can’t be changed.

It has one more benefit: the setup code in the log comes with a link you can open directly.

### `SANI_ROOT_REDIRECT`

No default. Where visitors to the root path `/` are sent, as a full `http://` or `https://` address, such as your home page. Without it, `/` redirects to the admin app at `/admin/`.

### `SANI_TRUST_PROXY`

Default `false`. With `true`, Sani trusts these headers from the reverse proxy:

- The **last** `X-Forwarded-For` entry, or `X-Real-IP` when that’s missing, is the client address. It’s used for sign-in rate limiting and logs.
- `X-Forwarded-Proto` tells whether the visit came over HTTPS, which decides the session cookie’s `Secure` flag.
- `X-Forwarded-Host` builds short links when `SANI_BASE_URL` isn’t set.

Only turn it on when Sani really sits behind a proxy that sets these headers. Otherwise anyone could forge them, pose as another address and get around the sign-in rate limit.

## Account

### `SANI_PASSWORD`

No default. A fixed admin password of at least 8 characters. When it’s set:

- at every start, if it differs from the stored password, it replaces it and signs out every device;
- Settings can’t change the password;
- a password set with `sani passwd` is replaced again at the next start.

It suits automated deployments. When you deploy by hand, the setup code is the better way to choose the first password, as it keeps the password out of configuration files and the process environment.

### `SANI_SETUP_CODE`

No default. The code the first visit asks for when choosing the password.

Without it, as long as there’s no password, Sani generates a code at every start, such as `k7m2-p9x4-hq3d`, and logs it; that line is written whatever the log level. Case, spaces and dashes don’t matter when typing it. Once a password exists, the code has no use.

Set it when an automated setup needs to know the code in advance.

## Links

### `SANI_SLUG_LENGTH`

Default `5`, from 3 to 32. The length of generated slugs.

Generated slugs use only the 31 characters of `23456789abcdefghjkmnpqrstuvwxyz`; 5 of them make about 28.6 million combinations. Existing links aren’t affected. When there are so many links that random slugs start colliding, new ones grow automatically.

### `SANI_FETCH_META`

Default `true`. After a link is created, fetch the destination in the background for its title and icon. When off, new links aren’t fetched and the list shows their domain. Clicking “Refetch title” in a link’s details still fetches the page.

Fetches only ever reach public addresses; see [Security](../internals/security#fetching). If the server reaches the internet through a proxy, set the usual `HTTPS_PROXY` and `HTTP_PROXY` variables.

### `SANI_FORWARD_QUERY`

Default `true`. Append the visitor’s query string to the destination:

```
https://s.example.com/gh?utm_source=weekly
→ https://github.com/DejavuMoe/sani?utm_source=weekly
```

If the destination already has a query, the two are joined with `&`, and a `#` fragment in the destination stays at the end.

### `SANI_CACHE_SIZE`

Default `100000`, from 64 to 100,000,000. How many redirect targets to keep in memory. Sani also caches up to a quarter as many unknown slugs, so a scan for random slugs neither keeps hitting the database nor pushes real links out of the cache.

When the cache is full, a random entry makes room. With far fewer links than this, every link that has been visited stays in memory.

## Logging

### `SANI_LOG_LEVEL`

Default `info`. One of `debug`, `info`, `warn` (or `warning`) and `error`. `debug` adds the reasons title and icon fetches failed. What each level records is listed under [Operations](../guide/operations#logs).

### `SANI_LOG_FORMAT`

Default `text`. `text` is readable `key=value` lines; `json` writes one JSON object per line for log collectors. Logs go to standard error.

## Other variables

### `TZ`

Default: the system time zone. “Today” and the daily statistics follow it. The binary carries its own time zone data, so `TZ=Europe/Berlin` works even in the `scratch` image, which has no zone files. Without `TZ`, the Docker image uses UTC.

### `HTTPS_PROXY` and `HTTP_PROXY`

The proxy for fetching titles and icons, with the usual meaning; `NO_PROXY` is honored too. The proxy itself may have a private address, like a proxy running on the same machine; destinations still have to pass the public address check.

## Configuration errors

Sani checks every variable at startup. If anything is wrong, it lists all the problems at once and exits:

```
sani: invalid configuration:
  SANI_SLUG_LENGTH: expected a number from 3 to 32, got "2"
  SANI_LOG_FORMAT: expected text or json
```
