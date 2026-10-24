# Security policy

## Reporting a vulnerability

Please don’t open a public issue. Report it privately through GitHub’s
[private vulnerability reporting](https://github.com/DejavuMoe/sani/security/advisories/new),
with the version (`sani version`), what an attacker can do, and how to
reproduce it. Chinese or English are both fine.

Reports are answered as soon as possible. Once a fix is released, the advisory is
published with credit to you, unless you’d rather stay anonymous.

请勿通过公开 issue 报告安全漏洞。请通过 GitHub [私密漏洞报告](https://github.com/DejavuMoe/sani/security/advisories/new)提交，并注明程序版本（可通过 `sani version` 查看）、安全影响与利用场景以及复现步骤。中英文均可。

## Supported versions

Security fixes go into the newest release. Older releases are not maintained
as separate branches: upgrade to the latest release to receive fixes.

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
gh attestation verify oci://ghcr.io/dejavumoe/sani:v1.0.1 --repo DejavuMoe/sani
```
