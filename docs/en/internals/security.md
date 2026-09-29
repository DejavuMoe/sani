# Security

<p class="lead">Sani sits on the public internet but has a single owner. Its security design starts from two ideas: without the password or a token, nobody can do anything; and even someone who has them can’t use Sani to attack visitors or probe the network your server sits in.</p>

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
- **Changing the password** signs out every other device; `sani passwd` signs out all of them.

## API tokens {#tokens}

A token is `sani_` followed by 43 random characters (about 256 bits). The database stores only its hash, and the token itself is shown once, when you create it. Tokens have full access and survive password changes, so scripts don’t break when you change the password; in turn, a leaked token has to be revoked on its own.

## Cross-site requests {#cross-origin}

Every `/api/` request passes through the Go standard library’s `http.CrossOriginProtection`: requests a browser sends from another site carry a `Sec-Fetch-Site` or `Origin` header and are refused. Together with the `SameSite=Strict` session cookie, other sites can’t act on your behalf. Scripts and command-line tools don’t send those headers, so token requests are unaffected.

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

## Fetching titles and icons {#fetching}

A server that fetches arbitrary URLs for its users is the classic entry point for server-side request forgery (SSRF): someone could create a link to `http://169.254.169.254/` or `http://192.168.1.1/` and have the server talk to a cloud metadata endpoint or a device on the local network. Sani’s fetcher guards against it twice:

1. **Before the request.** Only `http` and `https`; no `localhost`, no hostnames without a dot, nothing ending in `.localhost`, `.local`, `.internal`, `.lan` or `.home.arpa`; and the name is resolved, with the fetch refused if any address isn’t public.
2. **When connecting.** The dialer checks the IP it’s about to connect to once more. Even if a name resolves to a private address the second time (DNS rebinding), the connection can’t be made.

Not public: loopback, private networks, link-local addresses (including cloud metadata endpoints), carrier-grade NAT (`100.64.0.0/10`), multicast, documentation ranges, `240.0.0.0/4`, NAT64 and 6to4 prefixes, and Azure’s host service address `168.63.129.16`. `198.18.0.0/15` is allowed on purpose: transparent proxies in fake-ip mode resolve every name into it.

More limits:

- every redirect is checked again, and at most 5 are followed;
- pages are read up to 1 MB and icons up to 256 KB, a single request times out after 12 seconds, and fetching for one link takes 20 seconds at most;
- at most 3 fetches run at once, so creating many links can’t exhaust outgoing connections;
- with `HTTPS_PROXY` set, the proxy’s own address may be private, and names the server can’t resolve are left to the proxy;
- fetches carry an `X-Sani-Preview` header, so if the destination is a short link on another Sani instance, the fetch isn’t counted as a click.

Fetched icons come from third-party sites. Sani checks from the content that they really are images and serves them with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and `nosniff`. Even someone opening an SVG icon directly can’t make it run scripts.

## Untrusted input is bounded {#limits}

Everything whose size someone outside controls has an explicit limit:

| Input | Limit |
|---|---|
| Request headers | 32 KB, read within 5 seconds |
| Whole requests | 60 seconds each to read and write, 120 seconds idle |
| JSON request bodies | 1 MB |
| Import files | 32 MB, 100,000 links |
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

Sani doesn’t store visitors’ IP addresses or User-Agents, sets no cookies and keeps only aggregated counts; see [Statistics](../guide/statistics). The 404 and 410 pages visitors may see load nothing from elsewhere, carry a Content Security Policy that blocks all scripts, and ask search engines not to index them.

## Release files {#releases}

Images and binaries are built by GitHub Actions from the tagged commit, without passing through anyone’s computer:

- **Checksums.** Every release has a `SHA256SUMS` covering all archives.
- **Build provenance.** Archives and images carry provenance signed by GitHub, recording the repository, commit and workflow that built them. `gh attestation verify` checks it; [Deployment](../guide/deploy#verify) shows how. Images also carry an SBOM listing everything inside.
- **Reproducible.** Building one commit twice gives byte-for-byte identical archives.
- **Dependency updates.** Dependabot proposes dependency updates regularly, and CI checks for known vulnerabilities with `govulncheck` every week.

## Reporting a vulnerability {#reporting}

Please don’t open a public issue for security problems. Report them privately through GitHub’s [private vulnerability reporting](https://github.com/DejavuMoe/sani/security/advisories/new) instead.
