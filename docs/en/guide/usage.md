# Everyday use

<p class="lead">The admin app is built around one job: getting a short link into your hands as quickly as possible. Here are the everyday actions, plus a few details that are easy to miss.</p>

## Shortening links

There are three ways to hand Sani a link:

- **Paste.** Press <kbd>Ctrl</kbd> <kbd>V</kbd> (<kbd>⌘</kbd> <kbd>V</kbd> on a Mac) anywhere on the page; there’s no need to click the input first. Pasting a sentence that contains a link works too: Sani picks the link out.
- **Drop.** Drag a link from another tab or app onto the page.
- **Type.** An address without a scheme, like `example.com/a`, gets `https://` added.

Then press <kbd>Enter</kbd>. The new short link is copied to your clipboard and appears at the top of the list.

The page title and icon are fetched in the background and usually show up within seconds; if that fails, the list shows the destination’s domain. To write a title yourself, open “More options”. A title you write is never overwritten.

You can shorten the same URL as often as you like, and each time you get a new link. The bookmarklet and the share menu are the exception: if you shortened the page before, they hand you that link again.

## Grouping with tags {#tags}

Choose existing tags or create one by name when creating a URL, text or file link. Each link supports up to 5 tags. Names allow 24 Unicode code points, are trimmed and NFC-normalized, and are matched case-insensitively. New tags can have a color; the default is blue. Each instance supports up to 1,000 tags.

Open a link's details and choose Edit to change its tags. Saving applies assignments; canceling keeps the previous grouping. Creating a tag saves it to the catalog immediately, so it remains available even if you later cancel the link edit.

Filter by one tag or Untagged alongside search and type filters. Tag counts include all non-deleted links, including disabled and expired links, and do not change with filters. A successful creation clears filters to show the new link. Tags have their own column on desktop and appear under the destination on phones. Creation time appears only in details; sorting by Newest and Last visited remains available.

Tags are private to administrators. Undoing deletion restores assignments. Tag names and colors are also kept in [link exports](./import-export).

## Slugs {#slugs}

Leave the slug empty and Sani makes one up. Generated slugs are 5 characters from the 31 in `23456789abcdefghjkmnpqrstuvwxyz`, which leaves out look-alikes such as 0 and o or 1, l and i, so they survive being read aloud. When random slugs start colliding with existing ones, new ones grow by a character. [`SANI_SLUG_LENGTH`](../reference/configuration#sani-slug-length) sets the length.

When you pick a slug yourself, the field tells you as you type whether it’s free. The rules:

- letters and digits of any language, such as `简历`, `café` or `2026`;
- after the first character, also `-`, `_` and `.`, but no `.` at the end;
- at most 64 characters;
- case doesn’t matter: `/GitHub` and `/github` are the same link;
- these are used by Sani itself and can’t be taken: `admin`, `api`, `p`, `rest`, `healthz`, `robots.txt`, `favicon.ico`, `favicon.svg`, `apple-touch-icon.png`.

## Link options

Under “More options”, when creating a link or any time later:

| Option | What it does |
|---|---|
| Expires | Never, or after 1 hour, 1 day, 7 days or 30 days, or at a time you pick. Afterwards visitors see a “no longer available” page. |
| Visit limit | How many visits the link allows. Only visits that count toward the statistics use it up; see [Statistics](./statistics#visit-limits). |
| Redirect | **Temporary** (302, the default): you can change the destination any time, and every visit goes through Sani. **Permanent** (301): browsers cache it for a day, and repeat visits from the same browser in that time skip Sani, so they aren’t counted and see changes only later. The API also offers 307 and 308. |
| Turned off | Visitors see a “no longer available” page until you turn the link back on. |

## Editing and deleting

- **Edit.** Select a link and press <kbd>E</kbd> to change its destination, slug, title or options. The next visit follows the new settings.
- **Renaming a slug.** The old slug stops working as soon as you save.
- **Changing the destination.** If the title was fetched automatically, the new destination’s title is fetched.
- **Delete.** Press <kbd>Del</kbd> (<kbd>⌘</kbd> <kbd>⌫</kbd> on a Mac). There’s no confirmation dialog; the notification offers undo instead. An hour after deletion, the link and its statistics are gone for good.
- **Reusing a slug.** A deleted link’s slug is free for a new link right away. Once a new link takes it, the old one can no longer be restored.

## Several links at once {#bulk}

Click “Select” above the list, or press <kbd>X</kbd> on a selected row, to enter selection mode. A click on a row then checks it; <kbd>Shift</kbd>-click another row to check everything in between, and the box at the left of the action bar checks every loaded link.

With links checked, the action bar turns them on or off, or deletes them, up to 500 at a time. Deleting offers undo, as usual. Press <kbd>Esc</kbd> or click “Done” to leave selection mode.

Search first and then check everything to handle a group of related links at once, such as turning off all the links of a campaign. Changing the search or the sort clears the checks, so nothing out of sight gets changed.

## Texts and files {#shares}

Besides links, Sani shares a piece of text or a file. Switch to the Text or File tab above the link box, or start from anywhere on the page:

- **Paste text.** Pasting text with several lines, or a line that isn’t a link, opens it in the Text tab. A link on its own is shortened as usual.
- **Paste or drop a file.** It lands in the File tab, ready to upload. Files up to 64 MB by default; [`SANI_MAX_FILE_MB`](../reference/configuration#sani-max-file-mb) changes that.

A text is **plain text**, shown as running text that wraps, or **code**, shown monospace with line numbers and never wrapped. Texts are limited to 1 MB. Nothing is rendered: Markdown and HTML show as written.

Press <kbd>Ctrl</kbd> <kbd>Enter</kbd> (<kbd>⌘</kbd> <kbd>Enter</kbd> on a Mac) or click “Share”; for a file, the bar shows the upload’s progress and can cancel it. The address, such as `s.example.com/p/k3m9x2qv7h`, is copied as with a link. Expiry, the visit limit and the off switch work the same way; a visit limit of 1 makes a text that can be read once.

Generated slugs for texts and files are 10 characters long instead of 5. Nothing lists your shares, so the address is what keeps them private, and 10 characters can’t be guessed. You can still pick a slug yourself.

Visitors open the address and see a page with the text, a Copy button and, if you set up a [files domain](./deploy#files-domain), Raw and Download buttons. A file’s page shows its name, type, size and SHA-256, and a Download button. The bytes always come from the files domain, never from your short domain, so a file can’t pose as a page of your site; that’s why sharing files needs one.

In the list, texts and files show `/p/` before the slug and an icon instead of a site icon. Their details show the text, or the file’s name and SHA-256, with “Copy text” or “Copy download link”. The admin app has no download button: a download from it would use up a visit. To edit a text, press <kbd>E</kbd>; a file can’t be replaced, so share a new one.

## Finding and sorting

Search matches slugs, titles, destinations, file names and the first line of texts; press <kbd>/</kbd> to start typing. Pasting a full short link finds that link. Next to it, “All types” narrows the list to links, texts or files.

The list sorts by “Newest”, “Most clicked” or “Last visited”.

## Link details

Click a row, or select it and press <kbd>Enter</kbd>, to open its details:

- total clicks, clicks today, the last visit and the creation date, plus how much of the expiry and visit limit is used;
- daily clicks for the last 7, 30 or 90 days;
- the top referring sites;
- a QR code, downloadable as PNG or SVG;
- edit, turn off, delete and “Refetch title”.

## Keyboard shortcuts {#keyboard}

Press <kbd>?</kbd> in the admin app to see them any time.

| Keys | Action |
|---|---|
| <kbd>N</kbd> | New short link |
| <kbd>Ctrl</kbd> <kbd>V</kbd> / <kbd>⌘</kbd> <kbd>V</kbd> | Paste a link anywhere |
| <kbd>/</kbd> | Search |
| <kbd>J</kbd> / <kbd>K</kbd>, or <kbd>↓</kbd> / <kbd>↑</kbd> | Move the selection |
| <kbd>Enter</kbd> | Open or close details |
| <kbd>C</kbd> | Copy the short link |
| <kbd>E</kbd> | Edit |
| <kbd>Ctrl</kbd> <kbd>Enter</kbd> / <kbd>⌘</kbd> <kbd>Enter</kbd> | Save changes |
| <kbd>Del</kbd> / <kbd>⌘</kbd> <kbd>⌫</kbd> | Delete, with undo; with links checked, deletes all of them |
| <kbd>X</kbd> | Check or uncheck, for [bulk actions](#bulk) |
| <kbd>Esc</kbd> | Close or clear |
| <kbd>?</kbd> | Show shortcuts |

## Bookmarklet

In Settings → Shortcuts, drag the “Shorten this page” button to your bookmarks bar. Clicking it on any page opens a small window with the URL and title filled in. Review them, then click “Shorten” to create and copy the link, with a QR code next to it. If you shortened the page before, you get that link again. Opening the window alone never creates a link.

## On your phone

Open the admin app in your phone’s browser and add it to your home screen: Sani then sits among your apps. On Android it also shows up in other apps’ Share menu. Sharing to Sani fills in the URL and title for review. Click “Shorten” to create the link and show its copy button and QR code.

## From scripts

Create a token in Settings → API tokens, then call the [HTTP API](../reference/api) from scripts, Shortcuts or browser extensions:

```sh
curl https://s.example.com/api/links \
  -H "Authorization: Bearer sani_…" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/some/long/path"}'
```

A token has full access and keeps working after a password change. It’s shown only once, when you create it; revoke tokens you no longer use.

## What visitors see

- **The redirect.** Visitors go straight to the destination, with no page in between.
- **Query strings.** A visitor’s query string is added to the destination, as in `s.example.com/gh?utm_source=x`. Turn this off with [`SANI_FORWARD_QUERY`](../reference/configuration#sani-forward-query).
- **Forgiving addresses.** A trailing `/` or different capitalization still redirects.
- **Texts and files.** They open at `/p/{slug}` on a page in the visitor’s language; `/{slug}` without the `/p/` doesn’t find them.
- **Error pages.** Unknown slugs get a 404 page, and expired, turned off or used-up links a 410 page, in English or Chinese depending on the visitor’s browser, and marked so search engines don’t index them.
