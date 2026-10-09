# Security policy

## Reporting a vulnerability

Please don’t open a public issue. Report it privately through GitHub’s
[private vulnerability reporting](https://github.com/DejavuMoe/sani/security/advisories/new),
with the version (`sani version`), what an attacker can do, and how to
reproduce it. Chinese or English are both fine.

Reports are answered as soon as possible. Once a fix is released, the advisory is
published with credit to you, unless you’d rather stay anonymous.

请不要公开提交 issue，而是通过 GitHub 的[私密漏洞报告](https://github.com/DejavuMoe/sani/security/advisories/new)告诉我们，附上版本号、攻击者能做到什么，以及复现方法。

## Supported versions

Fixes go into the newest release. Before 1.0 there are no backports: upgrade
to the latest version to get them.

## Scope

What Sani defends against, and how, is described on the
[security page](docs/en/internals/security.md) of the
docs: the admin session and API tokens, the first-run setup code, the SSRF
guard of the title fetcher, blocked URL schemes, rate limits and the admin
app’s content security policy. A way around any of these is in scope.

Releases are built by GitHub Actions from the tagged commit, with build
provenance for every archive and image. To check a download:

```sh
gh attestation verify sani-linux-amd64.tar.gz --repo DejavuMoe/sani
gh attestation verify oci://ghcr.io/dejavumoe/sani:v0.9.2 --repo DejavuMoe/sani
```
