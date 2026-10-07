# Import and export

<p class="lead">Your links are yours: export all of them any time, or bring them over from another shortener. An import never overwrites an existing slug, and every row it couldn’t import is reported with the reason.</p>

## Export {#export}

Settings → Data → “Export all links” gives you a JSON or CSV file. The API does the same: [`GET /api/export`](../reference/api#export), with `?format=csv` for CSV. Exports hold short links only, not shared texts and files; a [backup](./operations#backup) keeps those.

The JSON looks like this; fields without a value are left out:

```json
{
  "app": "sani",
  "version": 1,
  "exportedAt": "2026-09-29T08:00:00Z",
  "links": [
    {
      "slug": "gh",
      "url": "https://github.com/DejavuMoe/sani",
      "title": "DejavuMoe/sani",
      "redirect": 302,
      "enabled": true,
      "expiresAt": "2026-12-31T16:00:00Z",
      "maxClicks": 1000,
      "clicks": 2507,
      "createdAt": "2026-08-01T14:19:03.118Z"
    }
  ]
}
```

The CSV columns are `slug`, `url`, `title`, `redirect`, `enabled`, `expires_at`, `max_clicks`, `clicks`, `created_at` and `tags`.

CSV exports prefix cells that a spreadsheet could interpret as formulas with an apostrophe, including cells starting with `=`, `+`, `-`, `@` or control characters. CSV imports retain that protective prefix as data; choose JSON for lossless exports and migration.

Each JSON link can include `tags: [{"name":"work","color":"blue"}]`; the CSV `tags` cell holds the same JSON array. Import rebuilds assignments by normalized name, not source IDs. Existing tags keep their name and color. Older files without tags still import; JSON name arrays from other services, such as `["work"]`, create blue tags. Records with more than 5 entries or invalid names/colors are skipped with `tags_invalid`. Exceeding the instance catalog limit fails and rolls back the entire import. Unused catalog tags are not exported; a full database backup preserves them.

An export holds each link’s settings and total clicks. It does **not** include daily statistics, referring sites, deleted links, API tokens or the password. It’s for moving links around, not a replacement for a [backup](./operations#backup).

## Import {#import}

In Settings → Data, drop a file onto “Import links” or click to choose one. With the API: [`POST /api/import`](../reference/api#import), with the file as the request body.

Sani tells the format from the content and understands:

| Source | Format |
|---|---|
| Sani | Its own JSON or CSV export |
| Shlink | The JSON of its short URL list endpoint: `{"shortUrls": {"data": [...]}}` |
| Sink | Its JSON export: `{"links": [...]}` |
| YOURLS, Kutt and others | A CSV with a header row and a column with the destination |
| Anything else | A JSON array of objects, or a JSON object with such an array under `links`, `data`, `items` or `urls` |

### Field names

Sani recognizes each field by its column (or JSON key) name. Names are case-insensitive, and spaces count as underscores.

| Field | Accepted names |
|---|---|
| Destination (required) | `url`, `longUrl`, `long_url`, `target`, `destination`, `original_url`, `link` |
| Slug | `slug`, `shortCode`, `short_code`, `code`, `keyword`, `key`, `alias`, `address`, `custom_slug` |
| Title | `title`, `name`, `description` |
| Created | `createdAt`, `created_at`, `dateCreated`, `date_created`, `timestamp`, `created` |
| Clicks | `clicks`, `visits`, `visitsCount`, `visits_count`, `visit_count`, `count` |
| Expires | `expiresAt`, `expires_at`, `validUntil`, `valid_until`, `expiration`, `expires` |
| Visit limit | `maxClicks`, `max_clicks`, `maxVisits`, `max_visits` |
| Redirect | `redirect` (301, 302, 307 or 308) |
| Enabled | `enabled` (`true` or `false`) |

Shlink nests some values, so `visitsSummary.total`, `meta.validUntil` and `meta.maxVisits` are recognized as well.

Times can be RFC 3339 (`2026-09-29T08:00:00Z`), `2026-09-29 08:00:00`, `2026-09-29`, or a Unix timestamp in seconds or milliseconds. Times without a zone are read as UTC.

### Rules

- **Nothing is overwritten.** Rows whose slug is taken are skipped and listed.
- **Every row is checked.** Rows with an invalid destination or slug are skipped, with the row number and reason.
- **Rows without a slug** get a generated one, a character longer than usual.
- **Titles** from the file are kept and never replaced automatically. Links without a title are not fetched, so one import can’t send requests to thousands of sites; use “Refetch title” in the details where you want one.
- **Click counts** add to a link’s total, but come without days or referrers, so they don’t appear in the daily chart.
- **Creation times** in the future are ignored.
- **Expiry** is stored in milliseconds. A nonempty value that is malformed, predates the Unix epoch or exceeds UTC years 0000–9999 skips the row with `expires_invalid`; Unix seconds are also checked for overflow before conversion to milliseconds. Empty values and `0` mean never, and valid past expiry dates are preserved. Check skipped rows, correct the source file and import again.
- **Counter ceiling:** per-link and overall click totals saturate at `9223372036854775807` (the int64 maximum). Summing large imports or counting later visits cannot overflow these totals. Links without a visit limit continue to work at the ceiling.
- **Limits:** files up to 32 MB, and at most 100,000 links per import.

Afterwards you see how many links were imported and which rows were skipped. Through the API the result looks like this:

```json
{
  "created": 42,
  "skipped": [
    { "row": 7, "reason": "url_invalid" },
    { "slug": "blog", "reason": "slug_taken" }
  ]
}
```

The reasons are [API error codes](../reference/api#errors).
