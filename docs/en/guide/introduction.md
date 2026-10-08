# Introduction

<p class="lead">Sani is a self-hosted link shortener with text and file sharing for one administrator. It runs on your own server, with tags, expiry and visit limits, and aggregated click statistics.</p>

<Screenshot name="dashboard" alt="The Sani dashboard: the box for new links and the 30-day click trend at the top, then the list of short links, each with its title, destination, a 14-day activity line and its click count." />

## What it does

- **Paste and done.** Paste a link anywhere in the admin app and press Enter: the short link is created and already on your clipboard. The page title and icon are fetched in the background, so you can recognize links later.
- **Cached redirects.** Cache hits avoid database queries, and clicks aggregate in memory before batch writes. The published test measured about 130,000 redirects per second and checked the counts; this is a measurement in one environment, not a capacity or durability guarantee. See [Performance](../internals/performance).
- **Enough statistics.** Total and daily clicks, referring sites and the last visit. Crawlers, link previews, browser prefetches and your own clicks don’t count.
- **Control over every link.** Expiry dates, visit limits, temporary or permanent redirects, and an off switch. A new destination applies from the very next visit.
- **Tags.** Assign colored tags to URLs, texts and files, then filter by tag or find untagged items. Tags are visible only to the administrator.
- **Texts and files too.** Share a note, a snippet of code or a file at `/p/…`, with the same expiry, visit limit and statistics as a link. See [Everyday use](./usage#shares).
- **Simple to run.** One binary with the admin app inside, and one SQLite file. The Docker image is about 25 MB, and there’s no Redis, PostgreSQL or anything else to run next to it.
- **Any language.** A slug like `s.example.com/简历` just works, and both the admin app and the pages visitors see come in English and Chinese.

## Who it’s for

Sani is for people who want a link shortener **entirely under their own control**: for a blog, a newsletter or social media, you need short links that keep working for years, without a provider shutting down, changing the rules or adding ads. It’s also a nice thing to run on a home server or a small VPS.

It’s probably not for you if you need:

- **Several users.** Sani has one admin password; there are no accounts, teams or permissions.
- **Detailed visitor analytics.** Sani doesn’t record location, device or browser. If you need those, use your own analytics on the destination pages.
- **Rule-based routing.** Sending visitors to different destinations by device, region or percentage.
- **Multiple active replicas.** Caches and pending clicks live in one process. Several processes serving the same database are not supported; use one instance and measure capacity with your data and traffic.

Sani is still in 0.x. Before serving public traffic, read [Versioning](../project/versioning), configure HTTPS and persistent storage, and rehearse backups and restores using [Operations](./operations).

## Design choices

**One user.** Signing in takes one password, and scripts use API tokens. Leaving out a user system leaves out a large part of what would need maintaining and protecting.

**Simple statistics.** Daily clicks and referring sites are aggregated, without individual visit records or visitor IP addresses and User-Agents in the statistics tables. Storage still grows with links, active days and referrers; treat referrer data according to your deployment’s privacy needs. See [Statistics](./statistics).

**Redirects come first.** Cache hits do not wait for database writes. Cold loads still query the database and coordinate with click flushing, and resource contention can affect latency. Metadata fetching runs in the background.

**No external database.** The binary embeds the admin app, SQLite stores records and texts, and `files/` stores uploads. Use `sani backup` for an online database snapshot. For a complete backup, stop all writers and copy the data directory together; copying a running instance’s `sani.db` alone is not a backup procedure.

## Next

- [Quick start](./quick-start): run it on your computer and shorten your first link.
- [Deployment](./deploy): put it on a server with your domain and HTTPS.
- [Architecture](../internals/architecture): see what a redirect goes through.
