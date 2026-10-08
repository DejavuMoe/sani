# 部署

<p class="lead">Sani 本身为轻量 HTTP 服务，生产部署通常由前置反向代理提供 HTTPS。下方的配置生成器会基于你输入的域名，直接生成仓库适配好的配置文件。</p>

## 生成配置

<ConfigBuilder />

生成器基于仓库内的 `compose.yaml`、`deploy/sani.service`、`deploy/Caddyfile` 和 `deploy/nginx.conf` 动态替换，高亮行即为自定义项。文档在构建时会自动校验这些规则行是否存在，确保生成配置与源码始终同步。

## Docker Compose 部署

官方发布的多平台镜像 `ghcr.io/dejavumoe/sani` 原生支持 `linux/amd64`、`linux/arm64` 与 `linux/arm/v7`（如树莓派）。在服务器新建目录并保存生成的 `compose.yaml`，随后启动：

```sh
docker compose up -d
```

`compose.yaml` 的关键特性：

- **仅监听本地回环**：端口映射为 `127.0.0.1:8080:8080`，外部请求全部经由反代转发。
- **持久化数据卷**：SQLite 数据库与文件上传保存在 `sani-data` 数据卷中（挂载于 `/data`），容器重建或销毁不丢失数据。
- **极小基础镜像**：基于 `scratch` 构建，大小仅约 25 MB，仅含 `sani` 可执行文件与 CA 证书。以 `65532` 非特权用户运行且无 shell。如需执行命令可直接调用 `/sani`（例如 `docker exec -it sani /sani passwd`）。
- **内置健康检查**：已配置 `HEALTHCHECK`，可通过 `docker ps` 查看容器 `healthy` 状态。

### 镜像版本

| 标签 | 指向 |
|---|---|
| `v0.7.0` | 对应 Git tag 和 GitHub Release `v0.7.0` 的具体版本 |
| `v0.7.0-rc.1` | 对应同名 Git tag 的预发布版（仅在发布该版本后可用） |

从 v0.7.0 起，镜像标签与 Git tag、GitHub Release 完全一致，保留 `v` 前缀；不再发布 `latest`、主版本或次版本浮动标签。仓库模板与配置生成器固定使用 `ghcr.io/dejavumoe/sani:v0.7.0`。部署前确认该版本已出现在 [Releases](https://github.com/DejavuMoe/sani/releases) 中；发布准备分支中的版本可能尚未发布。

升级时先[备份](./operations#backup)，再手动将 `compose.yaml` 的 `image:` 改为目标版本的完整标签，随后执行：

```sh
docker compose pull
docker compose up -d
```

如需从源码自建镜像，在仓库根目录将 `image:` 替换为 `build: .`，然后执行 `docker compose up -d --build`。

### 数据目录权限 {#data-permissions}

默认配置使用 Docker 命名卷 `sani-data:/data`。新卷会继承镜像内 `/data` 的所有权 `65532:65532`，无需手动创建服务器目录。容器重建保留数据；不要用 `docker compose down -v` 升级，它会删除命名卷。

如果要把数据直接放在 Compose 文件旁边，改用 `./sani-data:/data` **之前**，先在该目录执行：

```sh
sudo install -d -m 750 -o 65532 -g 65532 ./sani-data
```

然后把服务的挂载改为下面的写法，并删除文件末尾不再使用的顶层 `volumes:` 声明。`create_host_path: false` 可避免 Docker 在忘记初始化时自动创建 `root:root` 目录：

```yaml
    volumes:
      - type: bind
        source: ./sani-data
        target: /data
        bind:
          create_host_path: false
```

如果已经出现 `sani: open database: unable to open database file (14)`，先检查实际挂载和目录权限：

```sh
docker inspect sani --format '{{json .Mounts}}'
ls -ldn ./sani-data
```

若确认挂载的是当前目录下的 `./sani-data`，且所有者是 `root:root`、权限为 `755`，非特权容器不能创建数据库及 SQLite 的 WAL/SHM 文件。停止服务后，只修复这个专用数据目录：

```sh
docker compose stop sani
sudo chown -R 65532:65532 ./sani-data
sudo chmod -R u+rwX ./sani-data
sudo chmod 750 ./sani-data
docker compose up -d
docker compose logs --tail=50 sani
docker exec sani /sani healthcheck
```

已有数据不要删除目录或换成空卷；不要用 `chmod 777` 或改为 root 运行来绕过权限。如果所有权正确仍报错，再检查挂载是否只读、磁盘空间和宿主机的 SELinux 策略。这里的 UID/GID 适用于普通 Docker Engine；启用了 rootless 或 user namespace 映射时，需要按映射后的宿主 UID/GID 授权。

## systemd 服务管理 {#binaries}

若不使用 Docker，可直接使用 systemd 管理静态二进制程序。每个版本在 [GitHub Releases](https://github.com/DejavuMoe/sani/releases) 提供以下平台的发布包（内含 `sani`、许可证与说明）：

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

所有二进制文件均为静态编译，不依赖宿主机动态链接库。macOS、Windows 与 FreeBSD 解压后直接执行 `sani`（Windows 为 `sani.exe`），配置项完全一致。在 Linux 服务器上按如下步骤安装：

::: code-group

```sh [下载]
base=https://github.com/DejavuMoe/sani/releases/download/v0.7.0
curl -fsSLO "$base/sani-linux-amd64.tar.gz" -O "$base/SHA256SUMS"
sha256sum --ignore-missing -c SHA256SUMS
tar -xzf sani-linux-amd64.tar.gz sani
sudo install -m 755 sani /usr/local/bin/sani
```

```sh [从源码构建]
make install build        # 需 Go、Node 和 pnpm，构建产物在 bin/sani
scp bin/sani server:/tmp/sani
ssh server sudo install -m 755 /tmp/sani /usr/local/bin/sani
```

:::

下载路径固定到 `v0.7.0`；升级时将路径中的标签改为已发布的目标版本。

### 校验来源与签名 {#verify}

发布包与容器镜像均由 GitHub Actions 在打标提交上自动构建，并包含构建来源证明（Build Attestation）。安装 [GitHub CLI](https://cli.github.com) 后可快速核验完整性：

```sh
gh attestation verify sani-linux-amd64.tar.gz -R DejavuMoe/sani
gh attestation verify oci://ghcr.io/dejavumoe/sani:v0.7.0 -R DejavuMoe/sani
```

将生成的 `sani.service` 写入 `/etc/systemd/system/` 并启动：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now sani
journalctl -u sani -f        # 查看日志获取首次设置码
```

配置模板已包含最佳生产实践：

- **免建系统账户**：通过 `DynamicUser=yes` 由 systemd 自动分配隔离的运行身份。
- **规范数据路径**：通过 `StateDirectory=sani`，持久化数据和分享文件统一存放于 `/var/lib/sani`。
- **本地监听与安全沙箱**：仅监听 `127.0.0.1:8080`，系统目录只读、禁止提权，仅开放网络与本地套接字。

## 反向代理 {#proxy}

Sani 本身不包含 TLS 实现，可自由搭配 Caddy、nginx 或其他反代工具。需满足三项规则：

1. 将流量反代至 `127.0.0.1:8080`；
2. 传递 `X-Forwarded-For`、`X-Forwarded-Proto` 与 `X-Forwarded-Host` 请求头；
3. Sani 侧开启 [`SANI_TRUST_PROXY=true`](../reference/configuration#sani-trust-proxy)，否则相关代理头将被忽略。

### Caddy

Caddy 默认自动管理证书申请与续期，且自动传递必要转发头，配置仅需三行：

::: code-group

<<< @/../deploy/Caddyfile{txt} [deploy/Caddyfile]

:::

### nginx

使用 nginx 需自行准备证书（例如 certbot）。示例中的路径为 Let’s Encrypt 默认路径，且前置 `server` 块负责将 HTTP 重定向至 HTTPS。由于 nginx 默认请求体限制仅 1 MB（无法支持较大文件上传），示例已调整相关上限：

::: code-group

<<< @/../deploy/nginx.conf{nginx} [deploy/nginx.conf]

:::

### 其他代理与 CDN

Traefik、Cloudflare Tunnel 等方案同样满足前述三条原则即可。

若外部挂载 CDN，需特别关注客户端 IP 提取逻辑：Sani 默认获取 `X-Forwarded-For` 的**最后一项**（即离它最近的反代看到的地址）。此时需确保前置反代正确恢复真实访客 IP（如 nginx 的 `real_ip` 模块），以免同一 CDN 节点下的访客被判定为同一客户端而误触登录限流。客户端 IP 仅用于登录频控与日志，不用于跳转及统计。

## 域名解析 {#domain}

短链接与文本、文件分享页使用同一个主域名，按以下优先级确定：

1. 环境变量 [`SANI_BASE_URL`](../reference/configuration#sani-base-url)；
2. 管理后台“设置”页中填写的“短链接域名”；
3. 打开后台管理界面时所使用的实际地址（启用 `SANI_TRUST_PROXY` 时依据 `X-Forwarded-Host` 与 `X-Forwarded-Proto`）。

正式部署强烈建议显式指定 `SANI_BASE_URL`，避免短链接主机因管理员访问来源改变而漂移；启动日志还会输出含有效设置码的直达链接。

访问根路径 `/` 时默认重定向至后台管理页面 `/admin/`。若需跳往外部主页，可配置 [`SANI_ROOT_REDIRECT`](../reference/configuration#sani-root-redirect)。

## 文件下载域名 {#files-domain}

文本和文件的 **分享页始终使用主域名的 `/p/短码`**。启用 [文件分享](./usage#shares) 时，还需配置一个不同的主机名（例如 `f.example.com`），仅用于文件下载与原始文本。它可以是主域名的子域名；两个域名指向同一个 Sani 与反代实例，无需部署额外服务。

例如，设置 `SANI_BASE_URL=https://example.com` 和 `SANI_FILES_URL=https://f.example.com` 后：

| 用途 | 地址示例 |
|---|---|
| 短链接 | `https://example.com/blog` |
| 文本分享页 | `https://example.com/p/xxx1` |
| 文件分享页 | `https://example.com/p/xxx2` |
| 文件下载 | `https://f.example.com/xxx2/report.pdf` |
| 原始文本 | `https://f.example.com/xxx1` |

创建分享后复制的链接指向主域名上的分享页。访客点击“下载”或“原始文本”时才访问文件下载域名。配置步骤如下：

1. **DNS 解析**：将文件域名解析指向当前服务器。
2. **反向代理**：同主域名一样反代并传递请求头。Caddy 仅需在站点列表中追加域名（上述例子为 `example.com, f.example.com {`）；nginx 需在两处 `server_name` 中添加该域名并配置覆盖两者的证书。上方配置生成器填入后会自动适配。
3. **请求体大小**：文件上传上限受 [`SANI_MAX_FILE_MB`](../reference/configuration#sani-max-file-mb) 限制（另加 1 MB 表单开销）。Caddy 默认无限制；nginx 示例设置 `client_max_body_size 65m`，容纳默认的 64 MB 文件与表单开销。若修改了环境变量限制，反代配置也需同步增加。
4. **环境变量**：将 [`SANI_FILES_URL`](../reference/configuration#sani-files-url) 设为 `https://f.example.com` 并重启 Sani。

Sani 要求文件下载使用 **不同的主机名**，以隔离上传内容与管理后台。仅换路径不能隔离浏览器来源；仅换端口也不被接受，因为同主机的不同端口仍共享 Cookie。子域名符合要求，Sani 的管理会话 Cookie 不会发送到子域名。上传仍经由主域名的 API 完成。

不配置文件下载域名时，短链接与文本分享仍可使用，访客可在主域名的 `/p/` 页面阅读和复制文本；文件上传被禁用，文本页也不提供“原始文本”或“下载”入口。

## 管理员初始密码 {#first-password}

支持两种初始化方式：

- **设置码（推荐）**：未初始化密码前，Sani 每次启动都会生成随机设置码并打印在日志中。若已配置 `SANI_BASE_URL`，日志会提供带 hash 的直接设置链接（如 `https://s.example.com/admin/#setup=k7m2-p9x4-hq3d`）。Hash 锚点不会发送至服务端，不会在反代访问日志中留下痕迹。
- **环境变量 `SANI_PASSWORD`**：适用于自动化编排。启动时若检测到与数据库当前密码不一致将自动覆盖，并令所有活跃会话失效；此模式下管理后台中将禁用密码修改。

## 升级与回退 {#upgrade}

Sani 在启动时会自动执行数据库表结构升级迁移。旧版程序无法向后兼容新版迁移后的数据库，会直接退出并输出警告：

```
sani: database schema version 2 is newer than this build supports (1)
```

因此在升级前请务必先做[备份](./operations#backup)；如需回滚至旧版本，需还原升级前的备份数据。
