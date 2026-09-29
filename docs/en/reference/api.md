# HTTP API

<p class="lead">Everything the admin app does goes through this JSON API, so anything the app can do, a script can do too.</p>

## Conventions {#conventions}

- **Location.** Every endpoint is under `/api/`, and requests and responses are UTF-8 JSON.
- **Authentication.** Everything except sign-in and first-run setup needs it. Scripts use an API token, sent as `Authorization: Bearer sani_…` or `X-Api-Key: sani_…`; the admin app uses a session cookie. Create tokens in Settings → API tokens; they have full access.
- **Cross-site requests.** Requests a browser sends from another site are refused, based on the `Sec-Fetch-Site` and `Origin` headers browsers add. Scripts and command-line tools don’t send those headers and are unaffected.
- **Times.** RFC 3339 in UTC, such as `2026-09-28T09:30:00Z`.
- **Sizes.** Request bodies are limited to 1 MB, and to 32 MB for imports.
- **Caching.** Every response has `Cache-Control: no-store`.
- **Errors.** A failed request gets a matching HTTP status and the body below. `code` is stable and meant for programs; `message` is an English explanation for people and may change. The full list is under [Error codes](#errors).

```json
{ "error": { "code": "slug_taken", "message": "this slug is already in use" } }
```

A complete request:

```sh
curl https://s.example.com/api/links \
  -H "Authorization: Bearer $SANI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/launch", "slug": "launch"}'
```

## Endpoints {#index}

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/links` | [List links](#list) |
| `POST` | `/api/links` | [Create a link](#create) |
| `GET` | `/api/links/{id}` | [Read a link](#get) |
| `PATCH` | `/api/links/{id}` | [Update a link](#update) |
| `DELETE` | `/api/links/{id}` | [Delete a link](#delete) |
| `POST` | `/api/links/{id}/restore` | [Restore a deleted link](#restore) |
| `POST` | `/api/links/{id}/refresh` | [Fetch the title and icon again](#refresh) |
| `GET` | `/api/links/{id}/stats` | [A link’s statistics](#stats) |
| `GET` | `/api/slugs/{slug}` | [Check whether a slug is free](#slug-check) |
| `GET` | `/api/overview` | [Totals across all links](#overview) |
| `GET` | `/api/favicons/{host}` | [Site icons](#favicons) |
| `GET` | `/api/export` | [Export every link](#export) |
| `POST` | `/api/import` | [Import links](#import) |
| `GET` | `/api/config` | [Read settings](#config) |
| `PATCH` | `/api/config` | [Change the short domain](#config) |
| `GET` | `/api/tokens` | [List API tokens](#tokens) |
| `POST` | `/api/tokens` | [Create an API token](#tokens) |
| `DELETE` | `/api/tokens/{id}` | [Revoke an API token](#tokens) |
| `GET` | `/api/session` | [Sign-in state](#session) |
| `POST` | `/api/session` | [Sign in](#session) |
| `DELETE` | `/api/session` | [Sign out](#session) |
| `POST` | `/api/setup` | [Choose the first password](#session) |
| `PUT` | `/api/password` | [Change the password](#password) |
| `POST` | `/api/sessions/revoke` | [Sign out other devices](#password) |

## Links {#links}

### The link object {#link-object}

```json
{
  "id": 12,
  "slug": "gh",
  "shortUrl": "https://s.example.com/gh",
  "url": "https://github.com/DejavuMoe/sani",
  "host": "github.com",
  "title": "DejavuMoe/sani",
  "meta": "ok",
  "icon": true,
  "redirect": 302,
  "enabled": true,
  "status": "active",
  "expiresAt": null,
  "maxClicks": null,
  "clicks": 2507,
  "lastClickAt": "2026-09-28T16:02:11.402Z",
  "createdAt": "2026-08-01T14:19:03.118Z",
  "updatedAt": "2026-08-01T14:19:03.118Z"
}
```

| Field | Meaning |
|---|---|
| `slug` | The slug, with the capitalization it was created with. Lookups ignore case. |
| `shortUrl` | The full short link; where its domain comes from is explained under [Deployment](../guide/deploy#domain). |
| `url` | The normalized destination. |
| `host` | The destination’s host without `www.`. Empty for addresses without a host, like `mailto:`. |
| `title` | The title, or an empty string. |
| `meta` | Where the title came from: `pending` while fetching, `ok` fetched from the page, `failed` nothing found, `manual` set by you and never replaced automatically. |
| `icon` | Whether a site icon is stored; get it from [`/api/favicons/{host}`](#favicons). |
| `redirect` | The redirect status: 301, 302, 307 or 308. |
| `status` | `active`, `disabled`, `expired`, or `exhausted` when the visit limit is used up. |
| `expiresAt`, `maxClicks` | Expiry and visit limit, `null` when not set. |
| `clicks` | Total clicks, including those still in memory and not yet written. |
| `lastClickAt` | The last counted visit, or `null`. |

### Create a link {#create}

`POST /api/links`

Only `url` is required.

| Field | Meaning |
|---|---|
| `url` | The destination. `example.com/a` becomes `https://example.com/a`, and `localhost` or IP addresses get `http://`; the host is lowercased and spaces become `%20`; at most 8,192 bytes. Thirteen dangerous schemes such as `javascript:`, `data:` and `file:` are refused, and so is another short link on this server. Addresses like `mailto:` and `tel:` are fine. |
| `slug` | The slug; see the rules under [Everyday use](../guide/usage#slugs). A leading `/` is dropped. Generated when missing or empty. |
| `title` | The title. Runs of whitespace are collapsed, and titles over 300 characters are cut. Fetched in the background when missing. |
| `expiresAt` | The expiry, which must be in the future. `null` means never. |
| `maxClicks` | The visit limit, a whole number; `0` or `null` means none. |
| `redirect` | `302` (default), `301`, `307` or `308`. |
| `enabled` | Defaults to `true`. |
| `reuse` | With `true`, and no slug, expiry, visit limit or redirect given, an existing plain link to the same URL (enabled, no expiry, no limit, 302) is returned instead of a new one, with status `200` and `"reused": true`. The bookmarklet and the share menu use it. |

Returns `201` with the new [link](#link-object).

### List links {#list}

`GET /api/links`

| Parameter | Meaning |
|---|---|
| `q` | Search slugs, titles and destinations. A full short link works too. |
| `sort` | `created` (default, newest first), `clicks` (most clicked) or `visited` (last visited). |
| `limit` | Links per page, 1 to 200, default 50. |
| `cursor` | The `next` value from the previous page. |

```json
{ "items": [ … ], "next": "kx3f2a.c", "total": 128 }
```

- Each item in `items` is a [link](#link-object) with an extra `spark`: clicks on each of the last 14 days, oldest first. Links without clicks in those 14 days have no `spark`.
- `next` is the cursor for the next page, and `null` on the last one.
- `total` is the number of links matching the search.

### Read a link {#get}

`GET /api/links/{id}`

Returns the [link](#link-object).

### Update a link {#update}

`PATCH /api/links/{id}`

Takes every field of *Create* except `reuse`, and changes only the fields present:

- `null` for `expiresAt` or `maxClicks` clears it;
- an empty `title` fetches a new one;
- a new `url` fetches a new title if the old one was fetched automatically;
- after a `slug` change, the old slug stops working immediately.

Changes apply from the next visit. Returns the updated [link](#link-object).

### Delete a link {#delete}

`DELETE /api/links/{id}`

Returns `204`. The link stops redirecting at once but can be restored for an hour; after that it’s removed for good, with its statistics. Its slug is free for a new link right away.

### Restore a link {#restore}

`POST /api/links/{id}/restore`

Undoes a delete and returns the restored [link](#link-object). Returns `404` after an hour, or when a new link has taken the slug.

### Fetch the title and icon again {#refresh}

`POST /api/links/{id}/refresh`

Fetches the destination’s title and icon again, waits for the result and returns the [link](#link-object). This can take a few seconds. A title you set yourself is kept.

### Statistics {#stats}

`GET /api/links/{id}/stats`

The `days` parameter sets how many days to return, 1 to 366, default 30.

```json
{
  "link": { … },
  "days": [{ "date": "2026-09-01", "count": 41 }, …],
  "referrers": [{ "host": "", "count": 1053 }, { "host": "t.co", "count": 451 }],
  "referrersTotal": 2507
}
```

- `days` runs oldest to newest and ends today, in the server’s time zone.
- `referrers` holds the 8 sites with the most clicks. `""` means direct visits, and `"*"` the other sites beyond the first 200.
- `referrersTotal` is the number of clicks with referrer data.

The numbers are explained under [Statistics](../guide/statistics).

### Check a slug {#slug-check}

`GET /api/slugs/{slug}`

Tells whether a slug can be used:

```json
{ "available": false, "reason": "slug_taken" }
```

`reason` is `slug_taken`, `slug_reserved`, `slug_invalid` or `slug_too_long`, and absent when the slug is free.

## Overview {#overview}

`GET /api/overview`

Takes the same `days` parameter as [Statistics](#stats).

```json
{ "links": 128, "clicks": 6920, "today": 37, "days": [{ "date": "2026-08-31", "count": 212 }, …] }
```

## Site icons {#favicons}

`GET /api/favicons/{host}`

Returns the icon itself, or `404` when there’s none. `{host}` is the `host` of a [link](#link-object). Icons come from third-party sites, so they’re served with a sandboxing Content Security Policy: not even an SVG can run scripts.

## Import and export {#import-export}

### Export {#export}

`GET /api/export`

Returns every link as a JSON attachment; the format is described under [Import and export](../guide/import-export#export). Add `?format=csv` for CSV.

### Import {#import}

`POST /api/import`

The request body is the file itself: up to 32 MB and 100,000 links. Formats and rules are under [Import and export](../guide/import-export#import).

```sh
curl https://s.example.com/api/import \
  -H "Authorization: Bearer $SANI_TOKEN" \
  --data-binary @shlink-export.json
```

```json
{ "created": 42, "skipped": [{ "row": 7, "reason": "url_invalid" }, { "slug": "blog", "reason": "slug_taken" }] }
```

`row` in `skipped` is the record’s position in the file, starting at 1; entries skipped because their slug is taken only have `slug`.

## Settings {#config}

`GET /api/config`

```json
{
  "version": "v0.1.0",
  "baseUrl": "https://s.example.com",
  "baseUrlSource": "env",
  "requestOrigin": "https://s.example.com",
  "slugLength": 5,
  "fetchMeta": true,
  "forwardQuery": true,
  "passwordFromEnv": false,
  "timezone": "Europe/Berlin"
}
```

`baseUrlSource` says where the short domain comes from: `env` for `SANI_BASE_URL`, `setting` for Settings, `request` for the current request’s address.

`PATCH /api/config`

Changes the short domain stored in Settings:

```json
{ "baseUrl": "https://s.example.com" }
```

`null` or an empty string clears it. Returns `409` when `SANI_BASE_URL` is set, and the updated settings on success.

## API tokens {#tokens}

`GET /api/tokens`

Lists the tokens, each like `{"id": 3, "name": "iPhone Shortcuts", "hint": "sani_Ab3d", "createdAt": "…", "usedAt": "…"}`. `hint` is the start of the token, to tell tokens apart; `usedAt` is when it was last used, to the minute, or `null`.

`POST /api/tokens`

Takes `{"name": "iPhone Shortcuts"}`, with a name of 1 to 60 characters. Returns `201`, and the `token` field holds the token itself: **this is the only time it’s returned**. Sani keeps only its hash.

`DELETE /api/tokens/{id}`

Revokes the token and returns `204`.

## Sign-in and sessions {#session}

The admin app uses these, and they need no authentication.

`GET /api/session`

Returns `{"authenticated": false, "needsSetup": true}`: whether you’re signed in, and whether no password has been set yet.

`POST /api/setup`

Sets the first password, with `{"code": "k7m2-p9x4-hq3d", "password": "…"}`. `code` is the [setup code from the log](../guide/deploy#first-password); case, spaces and dashes don’t matter. On success you’re signed in and get `{"authenticated": true}`. Returns `409` once a password exists.

`POST /api/session`

Signs in with `{"password": "…"}`, sets the session cookie and returns `{"authenticated": true}`.

`DELETE /api/session`

Signs out and returns `204`.

Sign-in and setup are rate-limited per client address: after 8 failures within 15 minutes, requests get `429` until those 15 minutes are over. The `Retry-After` header and the `retryAfter` field in the body give the seconds left.

The session cookie is `sani_session`: `HttpOnly`, `SameSite=Strict`, only sent to addresses under `/api/`, and valid for 30 days, renewed as you use it.

## Password {#password}

`PUT /api/password`

Changes the password, with `{"current": "…", "password": "…"}`. Returns `204` and ends the sessions on every other device. Returns `409` when `SANI_PASSWORD` manages the password.

`POST /api/sessions/revoke`

Ends every session except the current one and returns `204`.

## Redirects {#redirects}

These paths are outside `/api/` and need no authentication.

`GET /{slug}`

- Redirects with the link’s status code and the destination in `Location`. Non-ASCII hosts are converted to Punycode, and other non-ASCII characters are percent-encoded.
- Temporary redirects (302, 307) send `Cache-Control: private, max-age=0`, so every visit reaches Sani; permanent ones (301, 308) send `Cache-Control: public, max-age=86400`, so browsers cache them for up to a day.
- Unknown slugs get `404`, and turned off, expired or used-up links `410`, both as small HTML pages in the visitor’s language.
- Only `GET` and `HEAD` are accepted; other methods get `405`.

`GET /healthz`

Returns `200` with `ok`, for health checks.

## Error codes {#errors}

| Code | Status | Meaning |
|---|---|---|
| `bad_json` | 400 | The body isn’t a valid JSON object, or is over 1 MB |
| `cursor_invalid` | 400 | The pagination cursor is invalid |
| `url_required` | 400 | The destination is missing |
| `url_invalid` | 400 | The destination isn’t a valid URL |
| `url_too_long` | 400 | The destination is over 8,192 bytes |
| `url_scheme` | 400 | The scheme isn’t allowed, like `javascript:` |
| `url_self` | 400 | The destination is a short link on this server |
| `slug_invalid` | 400 | The slug has unsupported characters, or an update sent an empty slug |
| `slug_too_long` | 400 | The slug is over 64 characters |
| `slug_reserved` | 400 | The slug is reserved |
| `expires_invalid` | 400 | `expiresAt` isn’t an RFC 3339 time |
| `expires_past` | 400 | `expiresAt` is in the past |
| `max_clicks_invalid` | 400 | `maxClicks` isn’t a whole number from 0 to 10¹² |
| `redirect_invalid` | 400 | `redirect` isn’t 301, 302, 307 or 308 |
| `base_url_invalid` | 400 | The domain should look like `https://s.example.com` |
| `name_invalid` | 400 | The token name is empty or over 60 characters |
| `password_short` | 400 | The password is shorter than 8 characters |
| `password_long` | 400 | The password is over 1,024 bytes |
| `import_unreadable` | 400 | The import file can’t be read |
| `import_too_many` | 400 | More than 100,000 links in one import |
| `wrong_password` | 400, 401 | Wrong password: 401 when signing in, 400 for a wrong current password when changing it |
| `unauthorized` | 401 | Not signed in, and no valid token |
| `cross_origin` | 403 | A browser request from another site |
| `setup_code` | 403 | Wrong setup code |
| `not_found` | 404 | No such link, token or endpoint, or the deleted link can no longer be restored |
| `slug_taken` | 409 | The slug is taken |
| `already_setup` | 409 | A password is already set |
| `needs_setup` | 409 | No password yet, so there’s nothing to sign in with |
| `password_env` | 409 | `SANI_PASSWORD` manages the password, so the API can’t change it |
| `base_url_env` | 409 | `SANI_BASE_URL` fixes the short domain, so the API can’t change it |
| `too_large` | 413 | The import file is over 32 MB |
| `rate_limited` | 429 | Too many failures; wait for `Retry-After` |
| `internal` | 500 | Something failed on the server; its log has the details |
