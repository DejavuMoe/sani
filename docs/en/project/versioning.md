# Versioning

<p class="lead">When you upgrade Sani, will your short links, scripts and deployment keep working? This page says what version numbers promise, how things may change, and what’s different before 1.0.</p>

## Version numbers {#semver}

Sani follows [semantic versioning](https://semver.org). A version looks like `major.minor.patch`:

- **Patch releases** (0.1.0 → 0.1.1) only fix things; still back up and read the changelog before upgrading.
- **Minor releases** (1.1 → 1.2) add things without breaking what exists.
- **Major releases** (1.x → 2.0) are the only ones with breaking changes, and the [changelog](./changelog) says how to upgrade.

**Before 1.0**, a minor release may also break things, as from 0.1 to 0.2. Every such change is listed under “Breaking changes” in the changelog, with how to upgrade. From 1.0 on, the promises below hold for the whole major version.

## What stays the same {#stable}

### Short links

Existing short links keep redirecting after an upgrade: the same address, the same status code, the same destination. Reserved paths (`admin`, `api` and a few more, listed under [Everyday use](../guide/usage)) only grow with a major version, so no slug in use suddenly stops working.

### The HTTP API

The endpoints, fields, values and [error codes](../reference/api#errors) documented in the [HTTP API](../reference/api) stay as they are. A minor release may:

- add endpoints;
- add fields to responses;
- add optional request fields, which behave as before when left out;
- add error codes.

So scripts should ignore fields they don’t know, and treat unknown error codes as a general failure. The `message` in an error is an English explanation for people and may change at any time; programs should look at `code` only.

### Settings

Every `SANI_*` [environment variable](../reference/configuration) keeps its name, default and meaning. New settings come with defaults that keep Sani behaving as before.

### The command line

[Subcommands](../reference/cli) and their arguments stay as they are.

### Data

- **The database.** Within the compatibility policy, startup applies migrations to older databases in order. Migration writes need sufficient disk space and may extend startup time. Older binaries reject schemas beyond the versions they support: take a [complete backup](../guide/operations#backup-files) before upgrading, and restore it to downgrade.
- **Backups.** `sani backup` writes a plain SQLite file. Restoring file shares also requires `files/` copied during the same stopped-service interval; see [paired backups](../guide/operations#backup-files).
- **Exports.** JSON and CSV compatibility follows the version policy above. `"version": 1` identifies the JSON format version. Prefer JSON to preserve field contents; protective CSV formula apostrophes remain on reimport. See [Import and export](../guide/import-export).

### Release files

The image name `ghcr.io/dejavumoe/sani`, the scheme of its tags and the names of the binary archives (listed under [Deployment](../guide/deploy#binaries)) stay the same, so download URLs in scripts keep working.

## What isn’t covered {#unstable}

- **The admin app.** Its layout, wording and shortcuts may improve at any time.
- **Logs.** They’re written for people; wording and fields may change. The one exception is the `setup_code` field for first-run setup, which the docs’ commands rely on.
- **The database’s tables.** Tables and columns may change in any release. Use the data through the API, exports or `sani backup`, not by reading or writing the database file directly.
- **Performance figures.** Benchmark results in the docs describe a measurement, not a promise.
- **Go code.** The packages under `internal/` aren’t for use by other programs.

## Deprecation {#deprecation}

Something that is going away is first marked deprecated in the changelog and the docs, and keeps working for the rest of that major version. It’s only removed in the next major version.

## Acceptance before 1.0 {#before-1}

These gates precede the formal compatibility promise; Sani is still in 0.x:

- Settle the public API, configuration defaults, CLI, reserved paths, export formats and release filenames, with bilingual references checked against the source.
- Exercise incremental database upgrades, preserving URLs, texts, files, statistics and credentials. Roll back failed migrations, reject newer schemas in older binaries, and rehearse a complete restore.
- Complete tests on Linux, Windows and macOS, build every release platform, and pass E2E, accessibility and dependency checks. Release decisions use remote CI for the exact commit.
- Record reproducible capacity measurements for latency, memory, SQLite waits and count consistency. Those measurements are not an SLA.
- List changes to documented behavior, such as resumed-download counting, under “Breaking changes” with migration steps. During 0.x, ship them in a minor release instead of silently including them in a patch.

Database tables remain internal implementation details after 1.0.
