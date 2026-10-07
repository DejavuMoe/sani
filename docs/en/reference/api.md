# HTTP API

<p class="lead">Everything the admin app does goes through this JSON API, so anything the app can do, a script can do too.</p>

## Conventions {#conventions}

- **Location.** Every endpoint is under `/api/`, and requests and responses are UTF-8 JSON.
- **Authentication.** Everything except sign-in and first-run setup needs it. Scripts use an API token, sent as `Authorization: Bearer sani_…` or `X-Api-Key: sani_…`; the admin app uses a session cookie. Create tokens in Settings → API tokens; they have full access.
- **Cross-site requests.** Requests a browser sends from another site are refused, based on the `Sec-Fetch-Site` and `Origin` headers browsers add. Scripts and command-line tools don’t send those headers and are unaffected.
- **Times.** RFC 3339 in UTC, such as `2026-09-28T09:30:00Z`.
- **Sizes.** Request bodies are limited to 1 MB; to 8 MB when they create or update a link, so a text at its 1 MB limit fits even with JSON escapes; to 32 MB for imports; and for uploads to the [file size limit](./configuration#sani-max-file-mb) plus 1 MB for the form around it.
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
| `GET` | `/api/tags` | [Tag catalog and counts](#tags) |
| `POST` | `/api/tags` | [Create or get a tag](#tags) |
| `POST` | `/api/links` | [Create a link](#create) |
| `POST` | `/api/links/bulk` | [Change several links at once](#bulk) |
| `GET` | `/api/links/{id}` | [Read a link](#get) |
| `PATCH` | `/api/links/{id}` | [Update a link](#update) |
| `DELETE` | `/api/links/{id}` | [Delete a link](#delete) |
| `POST` | `/api/links/{id}/restore` | [Restore a deleted link](#restore) |
| `POST` | `/api/links/{id}/refresh` | [Fetch the title and icon again](#refresh) |
| `GET` | `/api/links/{id}/stats` | [A link’s statistics](#stats) |
| `POST` | `/api/texts` | [Share a text](#create-text) |
| `POST` | `/api/files` | [Share a file](#create-file) |
| `GET` | `/api/links/{id}/text` | [Read a shared text](#read-text) |
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

### Tags {#tags}

`GET /api/tags`

Returns `{"items":[{"id":1,"name":"work","color":"blue","count":3}],"total":8,"untagged":2}`. A tag's `count` includes every non-deleted URL, text and file link using it, including disabled links. `total` and `untagged` count all links and untagged links. These counts do not depend on search, type or tag filters. Unused tags remain in the catalog.

`POST /api/tags`

Send `{"name":"work","color":"blue"}`; returns `200` and a tag object. Names are trimmed and NFC-normalized, with 1–24 Unicode code points and no control characters. Lowercase names identify duplicates: an existing tag is returned without changing its name or color. Color defaults to `blue`; allowed values are `blue`, `green`, `amber`, `rose`, `neutral`. The body limit is 4 KB and each instance holds at most 1,000 tags.

Tags appear only in authenticated administration APIs and screens, never on visitor share pages.

### The link object {#link-object}

```json
{
  "id": 12,
  "tags": [1],
  "kind": "url",
  "content": null,
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
| `kind` | `url` for a short link, `text` or `file` for a [share](#shares). |
| `tags` | Tag IDs in selection order, or `[]` when untagged. Read names and colors from the [catalog](#tags). |
| `content` | What a text or file shares, described [below](#shares); `null` for short links. |
| `slug` | The slug, with the capitalization it was created with. Lookups ignore case. |
| `shortUrl` | The full short link, with `/p/` before the slug of a text or file; where its domain comes from is explained under [Deployment](../guide/deploy#domain). |
| `url` | The normalized destination; empty for texts and files. |
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

Optional `tags` accepts up to 5 distinct, existing positive tag IDs. Omission creates an untagged link; create tags first through `POST /api/tags`. Supplying `tags` (even `[]`) disables `reuse` so tag choices are never silently discarded. Text and file shares also support tags.

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
| `reuse` | With `true`, and no slug, expiry, visit limit, redirect or tags given, an existing plain link to the same URL (enabled, no expiry, no limit, 302) is returned instead of a new one, with status `200` and `"reused": true`. The bookmarklet and the share menu use it. |

Returns `201` with the new [link](#link-object).

### List links {#list}

`GET /api/links`

| Parameter | Meaning |
|---|---|
| `q` | Search slugs, titles, destinations, file names and the first line of texts. A full short link works too. |
| `kind` | Only links of this [kind](#link-object): `url`, `text` or `file`. |
| `sort` | `created` (default, newest first), `clicks` (most clicked) or `visited` (last visited). |
| `limit` | Links per page, 1 to 200, default 50. |
| `cursor` | The `next` value from the previous page. |
| `tag` | One tag ID, or `untagged`; omit to include all tags. Intersects search and type filters. Totals and cursor pagination reflect the filtered result. |

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

Omitted `tags` preserves the assignments; `[]` clears them; an ID array replaces them. `null`, duplicates, nonexistent IDs or more than 5 entries fail and roll back the entire update.

`PATCH /api/links/{id}`

Takes every field of *Create* except `reuse`, and changes only the fields present:

- `null` for `expiresAt` or `maxClicks` clears it;
- an empty `title` fetches a new one;
- a new `url` fetches a new title if the old one was fetched automatically;
- after a `slug` change, the old slug stops working immediately;
- for a text, `text` and `format` replace its body and its format.

`url` and `redirect` don’t apply to texts and files, and `text` and `format` only apply to texts; sending one to a link of another kind gets `kind_mismatch`. A file’s bytes can’t be replaced: share a new one. Changes apply from the next visit. Returns the updated [link](#link-object).

### Delete a link {#delete}

`DELETE /api/links/{id}`

Returns `204`. The link stops redirecting at once but can be restored for an hour; after that it’s removed for good, with its statistics. Its slug is free for a new link right away.

### Restore a link {#restore}

`POST /api/links/{id}/restore`

Undoes a delete and returns the restored [link](#link-object). Returns `404` after an hour, or when a new link has taken the slug.

### Change several links at once {#bulk}

`POST /api/links/bulk`

Turns links on or off, deletes or restores them, in one transaction:

```json
{ "action": "disable", "ids": [12, 15, 31] }
```

- `action` is `enable`, `disable`, `delete` or `restore`, and `ids` lists 1 to 500 links.
- Returns `{"items": [...]}`: the [links](#link-object) that changed, as they are now, or, for `delete`, as they were before. Ids that don’t exist, links already in that state and links that can [no longer be restored](#restore) are left out, so the list can be shorter than `ids`.
- Deleted links can be restored for an hour, as with [a single delete](#delete).

### Fetch the title and icon again {#refresh}

`POST /api/links/{id}/refresh`

Fetches the destination’s title and icon again, waits for the result and returns the [link](#link-object). This can take a few seconds. A title you set yourself is kept. Texts and files have no page to fetch, and get `kind_mismatch`.

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

## Texts and files {#shares}

A share is a link that shows something instead of redirecting: visitors open it at `/p/{slug}`, and its bytes come from the [files domain](./configuration#sani-files-url). Shares and short links have one slug namespace, so `gh` can’t be both. They have the same `title`, `enabled`, `expiresAt` and `maxClicks`, and the same [statistics](#stats); the list, delete, restore and bulk endpoints treat them like any link. Generated slugs for shares are at least 10 characters long, because nothing else keeps them private.

A share’s `content`:

```json
{
  "format": "code",
  "preview": "server {",
  "lines": 11,
  "size": 286,
  "rawUrl": "https://f.example.com/nginx-conf"
}
```

```json
{
  "name": "Design review v3.pdf",
  "type": "application/pdf",
  "sha256": "67b21479e9f0cda26f49fe72be530b79adb35d2040cb207f61f0cc7bd2847f6e",
  "size": 597,
  "rawUrl": "https://f.example.com/tn5ya24hh6/Design%20review%20v3.pdf"
}
```

| Field | Meaning |
|---|---|
| `format` | Texts: `plain`, shown as running text, or `code`, monospace with line numbers. |
| `preview` | Texts: the first line that isn’t blank, up to 120 characters. |
| `lines` | Texts: the number of lines. |
| `name`, `type` | Files: the file name and its media type, from the extension or, without one, the first bytes. |
| `sha256` | Files: the SHA-256 of the bytes, in hex. |
| `size` | The size in bytes. |
| `rawUrl` | The bytes on the files domain, or `null` when there is none. Opening it counts as a visit. |

### Share a text {#create-text}

`POST /api/texts`

```json
{ "text": "server {\n    listen 443 ssl;\n}\n", "format": "code", "slug": "nginx-conf" }
```

`text` is required: at most 1 MB of UTF-8, and not only whitespace. It is stored as sent, line breaks and all. `format` defaults to `plain`. `slug`, `title`, `expiresAt`, `maxClicks` and `enabled` work as for [a link](#create). Returns `201` with the new [link](#link-object).

### Share a file {#create-file}

The optional multipart `tags` field is a JSON array string such as `[1,2]`. It uses the same validation as JSON creation. A rejected tag assignment also cleans up any file received during that upload.

`POST /api/files`

The body is `multipart/form-data` with one `file` part and, optionally, the fields `slug`, `title`, `expiresAt`, `maxClicks` and `enabled`, as text and with the same meaning as for [a link](#create):

```sh
curl https://s.example.com/api/files \
  -H "Authorization: Bearer $SANI_TOKEN" \
  -F file=@report.pdf -F maxClicks=10
```

- The file must not be empty and is limited by [`SANI_MAX_FILE_MB`](./configuration#sani-max-file-mb). It’s written to disk as it arrives, never held in memory.
- The file name is kept, without its path, control characters or invisible direction marks.
- Sharing files needs a files domain; without one this answers `409 files_disabled`.

Returns `201` with the new [link](#link-object).

### Read a shared text {#read-text}

`GET /api/links/{id}/text`

Returns `{"text": "…"}`, the whole body, which listings leave out. It doesn’t count as a visit. Links that aren’t texts get `404`.

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
  "version": "v0.3.0",
  "baseUrl": "https://s.example.com",
  "baseUrlSource": "env",
  "requestOrigin": "https://s.example.com",
  "slugLength": 5,
  "fetchMeta": true,
  "forwardQuery": true,
  "passwordFromEnv": false,
  "timezone": "Europe/Berlin",
  "filesUrl": "https://f.example.com",
  "maxFileSize": 67108864,
  "maxTextSize": 1048576
}
```

`baseUrlSource` says where the short domain comes from: `env` for `SANI_BASE_URL`, `setting` for Settings, `request` for the current request’s address. `filesUrl` is the [files domain](./configuration#sani-files-url), or `null` without one; `maxFileSize` and `maxTextSize` are the limits for a file and a text, in bytes.

`PATCH /api/config`

Changes the short domain stored in Settings:

```json
{ "baseUrl": "https://s.example.com" }
```

`null` or an empty string clears it. The files domain can’t be the short domain too. Returns `409` when `SANI_BASE_URL` is set, and the updated settings on success.

## API tokens {#tokens}

`GET /api/tokens`

Returns `{"items": [...]}`, the tokens, each like `{"id": 3, "name": "iPhone Shortcuts", "hint": "sani_Ab3d", "createdAt": "…", "usedAt": "…"}`. `hint` is the start of the token, to tell tokens apart; `usedAt` is when it was last used, to the minute, or `null`.

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
- A text or file at this path gets `404`: shares live under `/p/`.

`GET /p/{slug}`

- A page that shows a text, escaped and in the visitor’s language, or describes a file with a download button. `404` and `410` work as for redirects.
- Opening a text’s page counts as a visit; a file’s page doesn’t, its download does.
- The page’s only script is its copy button, allowed by hash in the Content Security Policy.

On the files domain:

- `GET /{slug}` returns a text as `text/plain` or a file as an attachment; `GET /{slug}/{name}` downloads either, a text as `{slug}.txt`. Files support `Range` requests and carry their SHA-256 as `ETag`.
- Every response is sandboxed, can’t be framed or embedded by other sites, and isn’t cached or indexed. `robots.txt` turns every crawler away; every other path is `404`.
- Every GET that starts a successful `200`/`206` content response counts, including all ranges, resumed downloads, curl and wget. Crawlers, previews, prefetches, `HEAD`, `304`/`412`/`416` and read failures do not count. Exhausted links return `410`; disconnecting does not refund a visit.
- When 32 downloads are already running, another one gets `503` with `Retry-After`, and isn’t counted.

`GET /healthz`

Returns `200` with `ok`, for health checks.

## Error codes {#errors}

| Code | Status | Meaning |
|---|---|---|
| `bad_json` | 400 | The body isn’t a valid JSON object |
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
| `text_required` | 400 | A text is missing or only whitespace |
| `format_invalid` | 400 | `format` isn’t `plain` or `code` |
| `kind_mismatch` | 400 | A field that doesn’t apply to this kind of link, like a `url` for a text, or a refresh of a share |
| `file_required` | 400 | The upload has no `file` part, or the file is empty |
| `upload_invalid` | 400 | The upload isn’t well-formed `multipart/form-data`, has more than one file, or a field over 4 KB |
| `bulk_invalid` | 400 | A bulk change with an unknown `action`, or without 1 to 500 `ids` |
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
| `files_disabled` | 409 | No files domain is set, so files can’t be shared |
| `too_large` | 413 | The request body is over its [limit](#conventions), such as an import file over 32 MB |
| `text_too_large` | 413 | The text is over 1 MB |
| `file_too_large` | 413 | The file is over the limit set by `SANI_MAX_FILE_MB` |
| `rate_limited` | 429 | Too many failures; wait for `Retry-After` |
| `internal` | 500 | Something failed on the server; its log has the details |
| `tags_invalid` | 400 | Invalid tag name, color, ID array or filter |
| `tag_limit` | 409 | The 1,000-tag catalog limit was reached; choose an existing tag |
