# Security

<p class="lead">Sani has one administrator. Authentication, cross-site request checks, content isolation and fetch-address validation limit its attack surface within specific boundaries. Operators still configure and maintain HTTPS, trusted proxies, host permissions and backups.</p>

## First-run setup {#setup}

If a fresh instance without a password went to whoever opened it first, it would be open to anyone until you got there. So the first password also takes the **setup code**:

- the code is generated at every start and only written to the server’s log, so only someone who can read the log can finish the setup;
- the setup link in the log puts the code after the `#`, which browsers never send to the server, so it can’t end up in the reverse proxy’s or any other access log;
- a wrong code counts as a failed sign-in and is rate-limited the same way;
- setup succeeds exactly once and is refused afterwards. Storing the password is atomic, so of two simultaneous requests, only one can win.

## Passwords and sessions {#sessions}

- **The password** is stored as an argon2id hash with OWASP’s recommended parameters (2 iterations, 19 MiB of memory, 1 thread). At most 2 hashes are computed at once, so a flood of sign-in attempts can’t exhaust memory.
- **Sign-in rate limiting** works per client address: after 8 failures within 15 minutes, the client waits until those 15 minutes are over. The limiter remembers at most 10,000 addresses, so forged addresses can’t blow up memory.
- **Session secrets** are 256 random bits, and the database only stores their SHA-256 hashes; a leaked database doesn’t let anyone sign in.
- **The session cookie** is `HttpOnly` and `SameSite=Strict`, only sent to addresses under `/api/`, and `Secure` over HTTPS. It lasts 30 days and is renewed at most once a day as you use it.
- **Changing the password** in the admin app keeps the current session and signs out other devices. CLI and environment password replacements revoke all sessions. Password replacement and revocation share one transaction; an in-flight verification against an old password cannot issue a session after the change.

## API tokens {#tokens}

A token is `sani_` followed by 43 random characters (about 256 bits). The database stores only its hash, and the token itself is shown once, when you create it. Tokens have full access and survive password changes, so scripts don’t break when you change the password; in turn, a leaked token has to be revoked on its own.

## Cross-site requests {#cross-origin}

Every `/api/` request passes through Go’s `http.CrossOriginProtection`, which checks `Sec-Fetch-Site` and `Origin` for cross-origin unsafe methods. This works alongside the `SameSite=Strict` cookie to defend against CSRF. Scripts without those headers still need valid credentials. An external link to `/admin/new` only prefills a URL and title; creation requires confirmation. Origin checks alone cannot prevent actions initiated by scripts on a same-origin page.

## The admin app {#admin}

The admin app’s pages carry a strict Content Security Policy:

- scripts only come from Sani itself; the one inline script, which applies the theme before the page renders to avoid a flash, is allowed by its hash, computed from the page at startup;
- no plugins, no embedding in other sites (`frame-ancestors 'none'`), and restricted `<base>` and form targets;
- plus `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` and `X-Content-Type-Options: nosniff`, with camera, microphone and geolocation disabled.

The admin app loads nothing from third parties; its fonts and icons are part of the binary.

## Destinations {#destinations}

- **Dangerous schemes** are refused: `javascript:`, `vbscript:`, `data:`, `file:`, `blob:`, `about:`, `filesystem:`, `view-source:`, `jar:`, `chrome:`, `chrome-extension:`, `moz-extension:` and `resource:`.
- **Short links on the same server** are refused as destinations, which rules out redirect loops and chains of short links hiding the real target.
- **The `Location` header** has every non-ASCII character encoded: international domain names become Punycode and everything else is percent-encoded. Line breaks and other control characters are removed when a destination is saved, so no extra headers can be injected. Percent-encoded hosts are refused, because they hide the real destination.

## Texts and files {#shares}

[Shared files](../guide/usage#shares) can be anything, an HTML page or an SVG with a script in it included, so Sani never serves their bytes from the domain the admin app lives on:

- **A domain of its own.** Raw text and file downloads only come from the [files domain](../reference/configuration#sani-files-url). That host never receives the session cookie, which is host-only and scoped to `/api/`, and serves nothing but shares: no admin app, no API, no redirects. The two must be different hosts, since cookies don’t keep ports apart; Sani refuses the same host for both.
- **Inert responses.** Everything from the files domain is sent with `Content-Security-Policy: default-src 'none'; sandbox`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin` and `X-Frame-Options: DENY`. Files are always attachments, never shown in place; a text is `text/plain`. Even a browser that opened one in a tab would run no script and load nothing.
- **Escaped pages.** The page at `/p/{slug}` on the short domain shows a text through Go’s `html/template`, so markup appears as written. Its Content Security Policy allows no script except the copy button’s, by hash, and the page loads nothing from anywhere.
- **Only you create them.** Texts and files are created through the API like links, so they need the password or a token. Visitors can’t upload.
- **Guessing.** Shares aren’t listed anywhere. Generated slugs for them are 10 characters from 31, about 8 × 10¹⁴ combinations; scanning for them is as slow as scanning for any slug, and `robots.txt` keeps crawlers away from `/p/` and the whole files domain.
- **On disk.** Uploads stream to a temporary file in `files/` and get a random 128-bit name once complete; the name a visitor sees is only kept in the database, without its path, control characters or bidirectional overrides. A stored name is checked before a file is opened, so a damaged row can’t reach outside the directory. Unreferenced files are swept every 10 minutes.

## Fetching titles and icons {#fetching}

A server that fetches arbitrary URLs for its users is the classic entry point for server-side request forgery (SSRF): someone could create a link to `http://169.254.169.254/` or `http://192.168.1.1/` and have the server talk to a cloud metadata endpoint or a device on the local network. Sani’s fetcher guards against it twice:

1. **Before the request.** Only `http` and `https`; no `localhost`, no hostnames without a dot, nothing ending in `.localhost`, `.local`, `.internal`, `.lan` or `.home.arpa`; and the name is resolved, with the fetch refused if any address isn’t public.
2. **When connecting directly.** The dialer checks the destination IP again, blocking DNS rebinding to a restricted address. Configured proxy addresses are an exception, with the trust boundary described below.

Not public: loopback, private networks, link-local addresses (including cloud metadata endpoints), carrier-grade NAT (`100.64.0.0/10`), multicast, documentation ranges, `240.0.0.0/4`, NAT64 and 6to4 prefixes, and Azure’s host service address `168.63.129.16`. `198.18.0.0/15` is allowed on purpose: transparent proxies in fake-ip mode resolve every name into it.

More limits:

- every redirect is checked again, and at most 5 are followed;
- pages are read up to 1 MB and icons up to 256 KB, a single request times out after 12 seconds, and fetching for one link takes 20 seconds at most;
- at most 32 HTML icon candidates are retained; base and HTTP(S) icon URLs are limited to 8,192 bytes before and after resolution;
- background automatic fetching runs at most 3 jobs at once, limiting outgoing requests from bulk link creation; manual refreshes do not use these job slots;
- the standard library handles `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`. Targets still pass through `checkHost`; with a proxy configured, failed local DNS lookups may be left to it, and its own address may be private. Sani’s dial checks do not inspect the proxy’s remote DNS or final outbound connection: use a trusted proxy and restrict reachable addresses there;
- fetches carry an `X-Sani-Preview` header, so if the destination is a short link on another Sani instance, the fetch isn’t counted as a click.

Fetched icons come from third-party sites. Sani checks from the content that they really are images and serves them with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and `nosniff`. Even someone opening an SVG icon directly can’t make it run scripts.

## Untrusted input is bounded {#limits}

Everything whose size someone outside controls has an explicit limit:

| Input | Limit |
|---|---|
| Request headers | 32 KB, read within 5 seconds |
| Whole requests | 60 seconds each to read and write, 120 seconds idle; uploads and downloads a minute plus the time a 64 KB/s connection needs |
| JSON request bodies | 1 MB; 8 MB to create or update a link |
| Import files | 32 MB, 100,000 links |
| Texts | 1 MB |
| Files | `SANI_MAX_FILE_MB`, 99,000,000 bytes by default; other upload fields 4 KB each |
| File names | 255 bytes |
| Downloads at once | 32 |
| Destinations | 8,192 bytes |
| Slugs | 64 characters |
| Titles | 300 characters |
| Passwords | 1,024 bytes |
| Token names | 60 characters |
| Referring sites per link | 200; between two writes, at most 64 new ones per link in memory |
| Addresses tracked for rate limiting | 10,000 |
| Cached unknown slugs | A quarter of `SANI_CACHE_SIZE` |
| Fetched pages and icons | 1 MB and 256 KB |

## Visitor privacy {#privacy}

Visitor statistics keep aggregate counts and referrer hosts, without IP addresses, User-Agents or tracking cookies. Failed sign-in logs may contain client IPs, and reverse proxies may keep access logs separately; see [Statistics](../guide/statistics) and [Logs](../guide/operations#logs). Error and share pages ask search engines not to index them, but `robots.txt` only guides cooperative crawlers and is not access control. Anyone with a valid share URL can read it; a random slug is not authentication for sensitive data.

## Release files {#releases}

Images and binaries are built by GitHub Actions from the tagged commit, without passing through anyone’s computer:

- **Checksums.** Every release has a `SHA256SUMS` covering all archives.
- **Build provenance.** Archives and images carry provenance signed by GitHub, recording the repository, commit and workflow that built them. `gh attestation verify` checks it; [Deployment](../guide/deploy#verify) shows how. Images also carry an SBOM listing everything inside.
- **Reproducible.** Building one commit twice gives byte-for-byte identical archives.
- **Dependency updates.** Dependabot proposes dependency updates regularly, and CI checks for known vulnerabilities with `govulncheck` every week.

## Reporting a vulnerability {#reporting}

Please don’t open a public issue for security problems. Report them privately through GitHub’s [private vulnerability reporting](https://github.com/DejavuMoe/sani/security/advisories/new) instead.

Dedicated proxies, whether saved in Settings or supplied by `SANI_META_PROXY`, pin verified public IPs through CONNECT/SOCKS5 and fail closed. Saved passwords are recoverable in the restricted database and its backups, without encryption. The API exposes only a password-set flag; errors omit transport details and credentials. Changing the proxy scheme, host, port or username cannot reuse a saved password. Authenticated connection tests use a fixed target, a 12-second deadline, one active request and a five-second start interval; they do not save settings. Legacy environment proxies retain their previous trust boundary; see [configuration](../reference/configuration#sani-meta-proxy).

Chunk uploads are bound to the authenticated credential hash, limited to 8 active sessions, 2 per credential and 8 GiB reserved total. Up to 32 completion receipts are retained, evicting the oldest completed receipt under pressure. Each session expires after an hour of inactivity; maintenance runs every minute, and restart removes abandoned chunk files. Completed shares retain the existing deletion/expiry rules.
