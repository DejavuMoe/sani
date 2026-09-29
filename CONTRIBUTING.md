# Contributing to Sani

Thanks for your interest. Bug reports, fixes and documentation improvements
are all welcome, in Chinese or English.

欢迎反馈问题、修复缺陷和改进文档，中文或英文都可以。开发环境和约定见[参与开发](https://dejavumoe.github.io/sani/project/development)。

## Before you start

Sani is a link shortener for one person, and stays small on purpose. For a
new feature, please open an issue first so we can agree on whether and how it
fits; the [status page](https://dejavumoe.github.io/sani/en/project/progress#non-goals)
lists what Sani deliberately won’t do. Fixes and small improvements can go
straight to a pull request.

## Making a change

The [development guide](https://dejavumoe.github.io/sani/en/project/development)
covers the toolchain, the commands and the conventions. In short:

```sh
mise install          # Go, Node and pnpm, at the versions in mise.toml
make install          # web and docs dependencies
make check test       # before every pull request
make e2e              # when the admin app is involved
```

A few rules that reviews will hold you to:

- **The docs follow the code.** A build-time check compares the docs with the
  source (settings, API routes, error codes, subcommands, benchmarks, the
  deploy files). Update both languages; the check says what’s missing.
- **Every UI string exists in `zh` and `en`**, and Chinese copy is written for
  Chinese readers rather than translated word for word.
- **Redirects never touch the database** when the slug is cached. Run
  `make bench` before and after changing the redirect path.
- **No cgo, no UI or icon libraries**, and nothing that weakens the security
  boundaries described in [SECURITY.md](SECURITY.md).

CI runs the same checks, the end-to-end tests, axe over the admin app and every
docs page, and builds the image and the release archives for every platform.

## Commits

Write commit messages in English, in the imperative (“Add …”, “Fix …”), with
a body that explains why when it isn’t obvious. Keep unrelated changes in
separate commits.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
