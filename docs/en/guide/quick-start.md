# Quick start

<p class="lead">Try Sani on your own computer first; it takes a few minutes. When you’re ready for a server, continue with Deployment.</p>

## Start Sani

::: code-group

```sh [Docker]
mkdir -p ~/sani && cd ~/sani
sudo install -d -m 750 -o 65532 -g 65532 ./sani-data
docker run -d --name sani -p 127.0.0.1:8080:8080 \
  --mount "type=bind,source=$(pwd)/sani-data,target=/data" ghcr.io/dejavumoe/sani:v0.9.3
```

```sh [Binary]
curl -fsSL https://github.com/DejavuMoe/sani/releases/download/v0.9.3/sani-linux-amd64.tar.gz | tar -xz sani
SANI_LISTEN=127.0.0.1:8080 ./sani     # keeps its data in ./data
```

```sh [From source]
git clone https://github.com/DejavuMoe/sani && cd sani
make install build                      # needs Go 1.27+, Node 24 and pnpm
SANI_LISTEN=127.0.0.1:8080 ./bin/sani   # keeps its data in ./data
```

:::

Docker data lives in `~/sani/sani-data`. Run the permission initialization above before starting: the container user `65532:65532` must be able to write the database. For an existing root-owned directory, follow [Data directory permissions](./deploy#data-permissions).

Binaries for other systems and architectures are listed under [Deployment](./deploy#binaries). The repository’s `compose.yaml` is meant for a real deployment, with a domain and a reverse proxy in mind; for a local try, `docker run` is simpler.

## Choose the admin password

Open `http://127.0.0.1:8080/admin/`. The first visit asks you to choose the admin password, together with the **setup code** Sani printed to its log when it started:

```sh
docker logs sani 2>&1 | grep setup_code
```

When you run the binary directly, the code is in the terminal output. The line looks like this:

```log
time=2026-09-29T14:03:12.418+08:00 level=WARN msg="no admin password yet: open /admin/ and enter this setup code, or set SANI_PASSWORD" setup_code=k7m2-p9x4-hq3d
```

<Screenshot name="setup" alt="The first-run page: the setup code first, then the new password twice." />

::: tip Why a setup code
A freshly started instance without a password could be claimed by whoever opens it first. The code only appears in the server’s log, so only someone who can read the log can finish the setup. To skip this step, set the password up front with [`SANI_PASSWORD`](../reference/configuration#sani-password).
:::

## Shorten your first link

1. Copy any long link in your browser.
2. Back in Sani, press <kbd>Ctrl</kbd> <kbd>V</kbd> (<kbd>⌘</kbd> <kbd>V</kbd> on a Mac). There’s no need to click the input first.
3. Press <kbd>Enter</kbd>.

The short link is on your clipboard, and a new row sits at the top of the list. The page title and icon arrive a few seconds later.

Locally, short links look like `http://127.0.0.1:8080/k7m2p`: without [`SANI_BASE_URL`](../reference/configuration#sani-base-url), Sani uses the address you opened the admin app at.

## Look at the statistics

Click a row, or select it with <kbd>J</kbd> <kbd>K</kbd> and press <kbd>Enter</kbd>, to see daily clicks, referring sites and a QR code, and to edit, turn off or delete the link.

<Screenshot name="detail" alt="Link details: a bar chart of daily clicks, the top referring sites and a QR code, next to the edit, turn off and delete actions." />

Opening a short link from the admin app doesn’t count as a click, so your own testing doesn’t skew the numbers. To watch the count go up, paste the short link into another browser’s address bar.

## Next

- [Deployment](./deploy): put it on a server with your domain and HTTPS.
- [Everyday use](./usage): shortcuts, the bookmarklet and your phone’s share menu.
- [HTTP API](../reference/api): create and manage links from scripts.
