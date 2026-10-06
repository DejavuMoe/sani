# 部署

<p class="lead">Sani 本身是一个普通的 HTTP 服务。正式部署时，还需要在它前面放一个负责 HTTPS 的反向代理。下面的生成器会按照你的域名，改好仓库里现成的配置文件。</p>

## 生成配置

<ConfigBuilder />

生成器修改的是仓库里的 `compose.yaml`、`deploy/sani.service`、`deploy/Caddyfile` 和 `deploy/nginx.conf`，高亮的行填的是你的输入。每次构建文档时，都会检查这些行在仓库的文件里是否还在，所以生成结果和仓库不会脱节。

## 用 Docker Compose

每个版本都会发布多平台镜像 `ghcr.io/dejavumoe/sani`，支持 `linux/amd64`、`linux/arm64` 和 `linux/arm/v7`（比如树莓派）。在服务器上新建一个目录，把生成的 `compose.yaml` 保存进去，然后启动：

```sh
docker compose up -d
```

`compose.yaml` 里值得了解的几点：

- **只监听本机**：端口映射为 `127.0.0.1:8080:8080`，外面的访问都要经过反向代理。
- **数据在卷里**：数据库和分享的文件保存在 `sani-data` 卷中，挂载到容器里的 `/data`。删除或重建容器不会丢数据。
- **镜像很小**：镜像基于 `scratch`，大约 25 MB，里面只有 `sani` 程序和 CA 证书，以 65532 号非特权用户运行，没有 shell。要在容器里执行命令，直接运行 `/sani`，比如 `docker exec -it sani /sani passwd`。
- **自带健康检查**：镜像定义了 `HEALTHCHECK`，`docker ps` 里能看到 `healthy`。

镜像有这几种标签：

| 标签 | 指向 |
|---|---|
| `latest` | 最新的正式版本 |
| `0.3` | 0.3 系列最新的修订版本，只包含修复 |
| `0.3.0` | 固定的某一个版本 |

`compose.yaml` 默认使用 `latest`。想自己决定什么时候升级，就把标签换成具体的版本号。升级时先[备份](./operations#backup)，再拉取新镜像：

```sh
docker compose pull
docker compose up -d
```

想从源码构建镜像，在仓库目录里把 `image:` 这一行换成 `build: .`，再运行 `docker compose up -d --build`。

## 用 systemd {#binaries}

不用 Docker 时，可以把二进制文件交给 systemd 管理。每个版本都在 [GitHub Releases](https://github.com/DejavuMoe/sani/releases) 上提供这些平台的压缩包，里面是 `sani` 程序、许可证和说明：

| 系统 | 架构 | 文件 |
|---|---|---|
| Linux | x86-64 | `sani-linux-amd64.tar.gz` |
| Linux | ARM64 | `sani-linux-arm64.tar.gz` |
| Linux | ARMv7（32 位） | `sani-linux-armv7.tar.gz` |
| macOS | Intel | `sani-darwin-amd64.tar.gz` |
| macOS | Apple 芯片 | `sani-darwin-arm64.tar.gz` |
| Windows | x86-64 | `sani-windows-amd64.zip` |
| Windows | ARM64 | `sani-windows-arm64.zip` |
| FreeBSD | x86-64 | `sani-freebsd-amd64.tar.gz` |

二进制文件是静态链接的，不依赖服务器上的任何库。在 macOS、Windows 或 FreeBSD 上，解压后直接运行 `sani`（Windows 上是 `sani.exe`），配置方式完全相同。在 Linux 服务器上，下载、核对校验和，然后安装：

::: code-group

```sh [下载]
base=https://github.com/DejavuMoe/sani/releases/latest/download
curl -fsSLO "$base/sani-linux-amd64.tar.gz" -O "$base/SHA256SUMS"
sha256sum --ignore-missing -c SHA256SUMS
tar -xzf sani-linux-amd64.tar.gz sani
sudo install -m 755 sani /usr/local/bin/sani
```

```sh [从源码构建]
make install build        # 需要 Go、Node 和 pnpm，产物为 bin/sani
scp bin/sani server:/tmp/sani
ssh server sudo install -m 755 /tmp/sani /usr/local/bin/sani
```

:::

`latest/download` 总是指向最新版本；要固定版本，把它换成 `download/v0.3.0` 这样的路径。

### 核对来源 {#verify}

发布的文件和镜像都由 GitHub Actions 从打了标签的提交构建，并附带构建来源证明。装有 [GitHub CLI](https://cli.github.com) 时，可以确认手里的文件确实出自这个仓库：

```sh
gh attestation verify sani-linux-amd64.tar.gz -R DejavuMoe/sani
gh attestation verify oci://ghcr.io/dejavumoe/sani:latest -R DejavuMoe/sani
```

然后把生成的 `sani.service` 保存到 `/etc/systemd/system/`，启用它：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now sani
journalctl -u sani -f        # 日志里有首次设置用的设置码
```

示例的单元文件已经做好了这些事：

- **不用手动建用户**：`DynamicUser=yes` 让 systemd 临时分配一个系统用户来运行 Sani。
- **数据目录固定**：`StateDirectory=sani`，数据库和分享的文件保存在 `/var/lib/sani`。
- **只监听本机，并且在沙箱里运行**：监听 `127.0.0.1:8080`，系统目录只读，不能提权，只能使用网络和本地套接字。

## 反向代理 {#proxy}

Sani 不处理 TLS，Caddy、nginx 或者其他反向代理都可以。要求只有三条：

1. 把请求转发到 `127.0.0.1:8080`；
2. 设置 `X-Forwarded-For`、`X-Forwarded-Proto` 和 `X-Forwarded-Host` 请求头；
3. Sani 这边设置 [`SANI_TRUST_PROXY=true`](../reference/configuration#sani-trust-proxy)，否则这些请求头会被忽略。

### Caddy

Caddy 会自动申请和续期证书，也会自动设置上面这些请求头，所以配置只有三行：

::: code-group

<<< @/../deploy/Caddyfile{txt} [deploy/Caddyfile]

:::

### nginx

nginx 需要你自己准备证书，比如用 certbot 申请。示例里的证书路径是 Let’s Encrypt 的默认位置，第二个 `server` 块把 HTTP 请求跳转到 HTTPS。nginx 默认只接受 1 MB 的请求体，导入和上传都不够用，所以示例调大了这个上限：

::: code-group

<<< @/../deploy/nginx.conf{nginx} [deploy/nginx.conf]

:::

### 其他代理和 CDN

Traefik、Cloudflare Tunnel 这类方案也一样，满足上面三条要求就行。

如果最外层还有一个 CDN，要注意客户端地址：Sani 取的是 `X-Forwarded-For` 的**最后一项**，也就是离它最近的那层代理看到的地址。这时需要让这层代理先还原真实的访问者地址，比如 nginx 的 `real_ip` 模块。否则，经过同一个 CDN 节点的所有人会被当成同一个客户端来做登录限流。客户端地址只用于登录限流和日志，跳转和统计都不用它。

## 域名 {#domain}

短链接使用的地址按这个顺序确定：

1. 环境变量 [`SANI_BASE_URL`](../reference/configuration#sani-base-url)；
2. 设置页里填写的“短链接域名”；
3. 你打开管理界面时的地址。开启 `SANI_TRUST_PROXY` 后，取反向代理传来的 `X-Forwarded-Host` 和 `X-Forwarded-Proto`。

正式部署时建议设置 `SANI_BASE_URL`。这样短链接的地址不会因为你从哪里打开管理界面而改变，启动日志里的设置码也会附带一个可以直接打开的链接。

有人直接访问裸域名 `https://s.example.com/` 时，默认会进入管理界面的登录页。想让它跳到你的主页，设置 [`SANI_ROOT_REDIRECT`](../reference/configuration#sani-root-redirect)。

## 文件域名 {#files-domain}

[分享文件](./usage#shares)需要第二个域名，比如 `f.example.com`，用来提供文件和原始文本。它背后还是同一个 Sani、同一个反向代理，不需要额外运行任何东西。

1. **DNS**：把文件域名也指向这台服务器。
2. **反向代理**：和短链接域名一样转发，请求头也一样。Caddy 把它写进站点地址（`s.example.com, f.example.com {`）；nginx 把它加到两处 `server_name` 里，并使用同时包含两个域名的证书。在上面的生成器里填写文件域名，会自动改好。
3. **请求体大小**：上传最大可以是 [`SANI_MAX_FILE_MB`](../reference/configuration#sani-max-file-mb) 再加 1 MB。Caddy 默认不限制；nginx 要把 `client_max_body_size` 设得至少这么大，示例按默认的 64 MB 设好了。调大 `SANI_MAX_FILE_MB` 时，这里也要跟着调大。
4. **Sani**：把 [`SANI_FILES_URL`](../reference/configuration#sani-files-url) 设为 `https://f.example.com`，然后重启。

文件域名必须是另一个主机名，只换端口不行：浏览器在同一个主机名的不同端口之间共享 Cookie，而让上传的文件远离管理界面的 Cookie 正是这么做的目的。用短链接域名的子域名没有问题，Sani 的会话 Cookie 不会发给子域名。上传走的是短链接域名上的 API，只有下载从文件域名提供。

不设置文件域名时，文本照样可以分享，访问者在页面上阅读和复制。

## 首次设置密码 {#first-password}

有两种方式：

- **用设置码（推荐）**：只要还没有设置密码，Sani 每次启动都会生成一个新的设置码写进日志。设置了 `SANI_BASE_URL` 时，同一行日志里还有一个已经带上设置码的链接，比如 `https://s.example.com/admin/#setup=k7m2-p9x4-hq3d`，打开就能直接设置密码。设置码放在 `#` 后面，浏览器不会把它发给服务器，所以它不会出现在任何访问日志里。
- **用 `SANI_PASSWORD`**：适合自动化部署。密码以环境变量为准：每次启动时，如果它和数据库里的密码不一致，就会替换掉，并让所有设备退出登录；设置页里也不能再修改密码。

## 升级与回退 {#upgrade}

升级时，Sani 会在启动时自动升级数据库结构。旧版本的程序打不开新版本升级过的数据库，会直接报错退出，而不是冒险读写：

```
sani: database schema version 2 is newer than this build supports (1)
```

所以升级前先[备份](./operations#backup)。想回退到旧版本，就用升级前的备份。
