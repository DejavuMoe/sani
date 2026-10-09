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
| [`SANI_EXCLUDE_CONFUSABLE`](#sani-exclude-confusable) | `true` | Exclude look-alike characters |
| [`SANI_META_PROXY`](#sani-meta-proxy) | — | Dedicated HTTP/HTTPS/SOCKS5 metadata proxy |
| [`SANI_FETCH_META`](#sani-fetch-meta) | `true` | Fetch titles and icons automatically |
| [`SANI_FORWARD_QUERY`](#sani-forward-query) | `true` | Pass query strings on to destinations |
| [`SANI_CACHE_SIZE`](#sani-cache-size) | `100000` | Redirect targets kept in memory |
| [`SANI_FILES_URL`](#sani-files-url) | — | Domain that serves files and raw text |
| [`SANI_MAX_FILE_MB`](#sani-max-file-mb) | `99` | Default file limit in decimal MB; explicit variable values keep MiB semantics |
| [`SANI_LOG_LEVEL`](#sani-log-level) | `info` | Log level |
| [`SANI_LOG_FORMAT`](#sani-log-format) | `text` | Log format |
| [`TZ`](#tz) | system | Time zone for daily statistics |

The repository’s `.env.example` lists every variable with a comment, as a starting point.

## Server

### `SANI_LISTEN`

Default `:8080`. The address and port to listen on; `:8080` means every interface. When only a reverse proxy on the same machine should reach Sani, use `127.0.0.1:8080`, as the example systemd unit does. The Docker image keeps `:8080`, and `compose.yaml` publishes the port on localhost only.

### `SANI_DATA_DIR`

Default `data`, relative to the working directory. The database file `sani.db` lives here and shared files in its `files` directory; the directory is created if it doesn’t exist. It’s `/data` in the Docker image and `/var/lib/sani` in the systemd example.

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

No default. A fixed admin password of at least 8 Unicode code points and at most 1,024 UTF-8 bytes. Invalid length prevents startup without changing the stored password or sessions. When it’s set:

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

### `SANI_EXCLUDE_CONFUSABLE`

Default `true`. Omits `0`, `o`, `1`, `i`, `l`. `false` uses lowercase letters and digits. Only future generated URL slugs change; existing, manual and imported slugs stay intact. Shared text/file IDs retain the safe alphabet and at least 10 characters. Explicit values lock the corresponding setting.

### `SANI_META_PROXY`

No default. Accepts `http://`, `https://` or `socks5://` proxy URLs, optionally with username/password. This variable overrides the saved proxy and locks proxy fields and connection testing in Settings. Leave it unset to configure the host, port and optional authentication in the admin app. When fetching is enabled without a saved mode, a configured dedicated proxy is selected automatically. The API returns the effective host, port, username and password-set flag, never the password.

Admin proxy settings are stored in the instance database. The password is recoverable for connections, not encrypted; protect the database and backups as credential-bearing files. Connection testing uses the current form without saving it. Changing the scheme, host, port or username requires entering a password again so a saved secret cannot be sent to a different proxy.

Connections tunnel to a locally resolved, verified public IP through CONNECT or SOCKS5, preserving the destination Host and TLS SNI. Failures never fall back to direct connections and `NO_PROXY` does not apply. Private targets, unsafe redirects and fake-IP DNS answers (`198.18.0.0/15`) are rejected in this strict mode. DNS runs locally, so this does not promise DNS privacy. The configured proxy endpoint itself may be private. HTTP proxies must support CONNECT for HTTP as well as HTTPS targets.

HTTPS encrypts the server-to-proxy hop; ordinary HTTP/SOCKS5 do not. Password authentication alone is not encryption. The proxy operator can observe destination metadata. DuckDuckGo’s search redirect is not a general metadata relay.

### `SANI_FETCH_META`

Default `true`. Enables title and icon fetching. `false` also disables manual refresh; existing cached metadata remains available. An explicit value locks the metadata mode, proxy fields and connection testing in the admin app. With no explicit value, toggle fetching and choose Direct, HTTP(S) or SOCKS5 in Settings. Direct ignores environment proxies; an unchanged legacy deployment still uses `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`. The app describes that inherited mode without labeling it Direct. Requests already in progress may finish after a mode change.

### `SANI_FORWARD_QUERY`

Default `true`. Append the visitor’s query string to the destination:

```
https://s.example.com/gh?utm_source=weekly
→ https://github.com/DejavuMoe/sani?utm_source=weekly
```

If the destination already has a query, the two are joined with `&`, and a `#` fragment in the destination stays at the end.

### `SANI_CACHE_SIZE`

Default `100000`, from 64 to 100,000,000. How many redirect targets to keep in memory. Sani separately caches up to a quarter as many unknown slugs to reduce repeated misses. Scanning new slugs still queries the database; apply ingress traffic limits as needed.

When the cache is full, a random entry makes room. With far fewer links than this, every link that has been visited stays in memory.

## Sharing

### `SANI_FILES_URL`

No default. The origin that serves the raw content of texts and files, such as `https://f.example.com`. Like `SANI_BASE_URL` it’s a scheme and a host, optionally with a port, and it **must be a different host**: another port isn’t enough, because browsers share cookies across the ports of one host.

It cannot include a path. A subdomain of the main domain is fine. Setting it does not change share-page addresses: text and file pages stay at `/p/slug` on the main domain; only downloads and raw text use this origin. See the [deployment examples](../guide/deploy#files-domain).

Without it, short links and text shares still work. Visitors can read and copy text on its `/p/` page on the main domain, but file uploads are disabled and text pages have no Raw or Download links.

The domain points at the same Sani process; nothing else needs deploying. Sani tells the two apart by the request’s `Host` (or `X-Forwarded-Host` with [`SANI_TRUST_PROXY`](#sani-trust-proxy)). The files domain serves shared content and a `robots.txt` that turns every crawler away, and answers 404 to everything else. Why it needs a domain of its own is explained under [Security](../internals/security#shares).

### `SANI_MAX_FILE_MB`

When unset, the default is **99,000,000 bytes**. Settings accepts integer decimal MB (1–4096). For compatibility, an **explicit** environment value still means MiB: `99` means 103,809,024 bytes. Explicit values take precedence and lock this field in Settings.

The admin app sends files over 25,000,000 bytes in independent chunks of at most 25,000,000 bytes. The whole-file limit still applies. Raise it deliberately for larger files; chunking does not raise it automatically. The legacy single-request API remains available and needs a suitable proxy body limit. Text shares remain limited to 1,048,576 bytes.

## Logging

### `SANI_LOG_LEVEL`

Default `info`. One of `debug`, `info`, `warn` (or `warning`) and `error`. `debug` adds the reasons title and icon fetches failed. What each level records is listed under [Operations](../guide/operations#logs).

### `SANI_LOG_FORMAT`

Default `text`. `text` is readable `key=value` lines; `json` writes one JSON object per line for log collectors. Logs go to standard error.

## Other variables

### `TZ`

Default: the system time zone. “Today” and the daily statistics follow it. The binary carries its own time zone data, so `TZ=Europe/Berlin` works even in the `scratch` image, which has no zone files. Without `TZ`, the Docker image uses UTC.

### `HTTPS_PROXY` and `HTTP_PROXY`

Outbound proxies for title and icon fetching use the standard library’s `http.ProxyFromEnvironment`, including `NO_PROXY`. Targets still pass through `checkHost`; with a proxy configured, failed local DNS lookups may be left to it, and the proxy itself may be private. Sani does not inspect the address the proxy ultimately connects to. Use a trusted proxy with its own DNS and outbound restrictions; see the [fetching trust boundary](../internals/security#fetching).

Creation defaults are stored in SQLite when edited in Settings. Priority is built-in defaults → saved settings → explicitly set environment variables, per field. No configuration file is required.

## Configuration errors

Sani checks every variable at startup. If anything is wrong, it lists all the problems at once and exits:

```
sani: invalid configuration:
  SANI_SLUG_LENGTH: expected a number from 3 to 32, got "2"
  SANI_LOG_FORMAT: expected text or json
```
