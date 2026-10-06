# Introduction

<p class="lead">Sani is a link shortener for one person. It runs on your own server, with you as its only admin: it turns long links into short ones, tells you how often each one is clicked, and otherwise stays out of your way.</p>

<Screenshot name="dashboard" alt="The Sani dashboard: the box for new links and the 30-day click trend at the top, then the list of short links, each with its title, destination, a 14-day activity line and its click count." />

## What it does

- **Paste and done.** Paste a link anywhere in the admin app and press Enter: the short link is created and already on your clipboard. The page title and icon are fetched in the background, so you can recognize links later.
- **Fast redirects.** Targets live in memory, and recording statistics never sits in a redirect’s way. On a laptop, Sani serves about 130,000 redirects a second and counts every single click (see [Performance](../internals/performance)).
- **Enough statistics.** Total and daily clicks, referring sites and the last visit. Crawlers, link previews, browser prefetches and your own clicks don’t count.
- **Control over every link.** Expiry dates, visit limits, temporary or permanent redirects, and an off switch. A new destination applies from the very next visit.
- **Texts and files too.** Share a note, a snippet of code or a file at `/p/…`, with the same expiry, visit limit and statistics as a link. See [Everyday use](./usage#shares).
- **Simple to run.** One binary with the admin app inside, and one SQLite file. The Docker image is about 25 MB, and there’s no Redis, PostgreSQL or anything else to run next to it.
- **Any language.** A slug like `s.example.com/简历` just works, and both the admin app and the pages visitors see come in English and Chinese.

## Who it’s for

Sani is for people who want a link shortener **entirely under their own control**: for a blog, a newsletter or social media, you need short links that keep working for years, without a provider shutting down, changing the rules or adding ads. It’s also a nice thing to run on a home server or a small VPS.

It’s probably not for you if you need:

- **Several users.** Sani has one admin password; there are no accounts, teams or permissions.
- **Detailed visitor analytics.** Sani doesn’t record location, device or browser. If you need those, use your own analytics on the destination pages.
- **Rule-based routing.** Sending visitors to different destinations by device, region or percentage.

## Design choices

**One user.** Signing in takes one password, and scripts use API tokens. Leaving out a user system leaves out a large part of what would need maintaining and protecting.

**Simple statistics.** The database only keeps aggregated numbers: how many clicks each link got on each day, and from which sites. There’s no record of individual visits, so the database doesn’t grow with traffic and holds no personal data about visitors. See [Statistics](./statistics).

**Redirects come first.** Everything serves one goal: redirects must be fast, whatever else is happening. Database writes, statistics and title fetching all happen off the redirect path.

**No external services.** One process is the whole thing. Backing up is copying one database file, plus the directory of shared files if you share files, and moving is putting them on another machine.

## Next

- [Quick start](./quick-start): run it on your computer and shorten your first link.
- [Deployment](./deploy): put it on a server with your domain and HTTPS.
- [Architecture](../internals/architecture): see what a redirect goes through.
