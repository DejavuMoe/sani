# Command line

<p class="lead">Sani is a single executable that provides both the service and its maintenance commands. Every command reads the same SANI_* environment variables, so run maintenance commands with the same data directory as the service.</p>

| Command | What it does |
|---|---|
| [`sani serve`](#sani-serve) | Start the service. Running `sani` without arguments does the same |
| [`sani passwd`](#sani-passwd) | Set a new admin password and sign out every device |
| [`sani backup`](#sani-backup) | Write a consistent copy of the database to a file or standard output |
| [`sani healthcheck`](#sani-healthcheck) | Check that the local service is healthy |
| [`sani version`](#sani-version) | Print the version |
| `sani help` | Print the usage text |

In Docker, the executable is `/sani`, as in `docker exec -it sani /sani passwd`.

Commands exit with 0 on success, 1 on errors, and 2 for unknown commands.

## `sani serve`

Starts the service. At startup it reads and checks the configuration, opens the database and upgrades its schema if needed, logs a setup code if there’s no password yet, and starts listening. On `SIGTERM` or `SIGINT`, it lets requests in flight finish (for up to 10 seconds), writes the clicks still in memory and exits.

## `sani passwd`

Sets a new admin password and signs out every device. Use it when you’ve forgotten the password.

In a terminal, it asks for the new password twice without echoing it. Otherwise it reads one line from standard input:

```sh
echo 'a-new-password' | sani passwd
```

The password needs at least 8 characters. If `SANI_PASSWORD` is set, the next start brings back the password from the environment, and the command reminds you of that. `sani password` is an alias.

## `sani backup`

Writes a consistent copy of the database to a file while the service keeps running:

```sh
sani backup /backups/sani-2026-09-29.db
docker exec sani /sani backup - > sani-2026-09-29.db
```

- It uses SQLite’s `VACUUM INTO`, so the copy is compacted and usually smaller than the original.
- With `-` as the file name, the copy goes to standard output. If standard output is a terminal, it refuses, rather than print binary data to your screen.
- An existing file is never overwritten.
- It only reads the database and never upgrades its schema, so any version of `sani` can back up a running instance.

How to restore is described under [Operations](../guide/operations#backup).

## `sani healthcheck`

Requests `/healthz` from the local service and exits with 0 on a `200`, and 1 otherwise. The address comes from `SANI_LISTEN`; when that listens on every interface, it asks `127.0.0.1`. The Docker image’s `HEALTHCHECK` runs this command, since the image has no curl.

## `sani version`

Prints the version, such as `sani v0.1.0`. Builds from source take it from `git describe`, or use `dev` without Git metadata. `sani -v` and `sani --version` do the same.
