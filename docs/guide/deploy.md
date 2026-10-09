# 部署

<p class="lead">Sani 本身为轻量 HTTP 服务，生产部署通常由前置反向代理提供 HTTPS。下方的配置生成器会基于你输入的域名，直接生成仓库适配好的配置文件。</p>

## 生成配置

<ConfigBuilder />

生成器基于仓库内的 `compose.yaml`、`deploy/sani.service`、`deploy/Caddyfile` 和 `deploy/nginx.conf` 动态替换，高亮行即为自定义项。文档在构建时会自动校验这些规则行是否存在，确保生成配置与源码始终同步。

## Docker Compose 部署

官方发布的多平台镜像 `ghcr.io/dejavumoe/sani` 原生支持 `linux/amd64`、`linux/arm64` 与 `linux/arm/v7`（如树莓派）。在服务器新建目录并保存生成的 `compose.yaml`。**启动前必须创建 `./sani-data` 并授予容器用户 `65532:65532` 写权限**，在 Compose 文件所在目录执行：

```sh
sudo install -d -m 750 -o 65532 -g 65532 ./sani-data
docker compose up -d
```

`compose.yaml` 的关键特性：

- **仅监听本地回环**：端口映射为 `127.0.0.1:8080:8080`，外部请求全部经由反代转发。
- **绑定本地目录**：SQLite 数据库与文件上传保存在 Compose 文件旁的 `./sani-data`，绑定到容器内 `/data`，容器重建不删除这个目录。默认不使用命名卷。
- **极小基础镜像**：基于 `scratch` 构建，大小仅约 25 MB，仅含 `sani` 可执行文件与 CA 证书。以 `65532` 非特权用户运行且无 shell。如需执行命令可直接调用 `/sani`（例如 `docker exec -it sani /sani passwd`）。
- **内置健康检查**：已配置 `HEALTHCHECK`，可通过 `docker ps` 查看容器 `healthy` 状态。

### 镜像版本

| 标签 | 指向 |
|---|---|
| `v0.9.2` | 对应 Git tag 和 GitHub Release `v0.9.2` 的具体版本 |
| `v0.9.2-rc.1` | 对应同名 Git tag 的预发布版（仅在发布该版本后可用） |

从 v0.7.0 起，镜像标签与 Git tag、GitHub Release 完全一致，保留 `v` 前缀；不再发布 `latest`、主版本或次版本浮动标签。仓库模板与配置生成器固定使用 `ghcr.io/dejavumoe/sani:v0.9.2`。部署前确认该版本已出现在 [Releases](https://github.com/DejavuMoe/sani/releases) 中；发布准备分支中的版本可能尚未发布。

升级时先[备份](./operations#backup)，再手动将 `compose.yaml` 的 `image:` 改为目标版本的完整标签，随后执行：

```sh
docker compose pull
docker compose up -d
```

如需从源码自建镜像，在仓库根目录将 `image:` 替换为 `build: .`，然后执行 `docker compose up -d --build`。

### 数据目录权限 {#data-permissions}

默认配置绑定 Compose 文件旁的 `./sani-data`，不需要顶层 `volumes:` 声明。容器以 `65532:65532` 运行，宿主机登录用户是否为 root 不会改变容器身份。**第一次启动前**，在 Compose 文件所在目录执行：

```sh
sudo install -d -m 750 -o 65532 -g 65532 ./sani-data
```

模板和生成器都使用下面的绑定写法。普通 Linux Docker Engine 下，`create_host_path: false` 让缺少目录时直接报错，避免自动创建容器无法写入的 `root:root` 目录。Docker Desktop 的文件共享层可能仍创建目录，因此任何环境都不要省略权限初始化：

```yaml
    volumes:
      - type: bind
        source: ./sani-data
        target: /data
        bind:
          create_host_path: false
```

此前使用命名卷的实例，应先[备份](./operations#backup)并将数据迁移到绑定目录，再切换挂载；直接改指向空目录会显示为全新实例。

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
base=https://github.com/DejavuMoe/sani/releases/download/v0.9.2
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

下载路径固定到 `v0.9.2`；升级时将路径中的标签改为已发布的目标版本。

### 校验来源与签名 {#verify}

发布包与容器镜像均由 GitHub Actions 在打标提交上自动构建，并包含构建来源证明（Build Attestation）。安装 [GitHub CLI](https://cli.github.com) 后可快速核验完整性：

```sh
gh attestation verify sani-linux-amd64.tar.gz -R DejavuMoe/sani
gh attestation verify oci://ghcr.io/dejavumoe/sani:v0.9.2 -R DejavuMoe/sani
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
3. **请求体大小**：后台对超过 25 MB 的文件发送多个独立请求，每片最多 25,000,000 字节。nginx 示例 `client_max_body_size 100m` 可容纳 32 MiB 导入及默认 99 MB 单请求上传的表单开销。更大的直接 API 上传需提高反代上限；分片只需容纳单次请求。Cloudflare Free/Pro 的请求上限为 100 MB，zone 可另行调低；分片避免单请求超限，但不改变 Sani 的完整文件上限。参阅 [Cloudflare 413 官方说明](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/)。慢速上传仍可能触发代理超时。
4. **环境变量**：将 [`SANI_FILES_URL`](../reference/configuration#sani-files-url) 设为 `https://f.example.com` 并重启 Sani。

Sani 要求文件下载使用 **不同的主机名**，以隔离上传内容与管理后台。仅换路径不能隔离浏览器来源；仅换端口也不被接受，因为同主机的不同端口仍共享 Cookie。子域名符合要求，Sani 的管理会话 Cookie 不会发送到子域名。上传仍经由主域名的 API 完成。

不配置文件下载域名时，短链接与文本分享仍可使用，访客可在主域名的 `/p/` 页面阅读和复制文本；文件上传被禁用，文本页也不提供“原始文本”或“下载”入口。

## Cloudflare 与 CDN 缓存 {#cdn-cache}

短链接的计数、停用、过期和访问上限都需要请求到达 Sani。推荐对主域名和文件域名默认**绕过 CDN 缓存**，只为主域名的 `/admin/assets/` 静态资源开放缓存；只绕过文件域名还不够。

| 内容 | Sani 的响应策略 | CDN 建议 |
| --- | --- | --- |
| 有有效期或访问上限的跳转（301、302、307、308） | `no-store` | 绕过 |
| 无限制的临时跳转（302、307） | `private, max-age=0` | 绕过 |
| 无限制的永久跳转（301、308） | `public, max-age=86400` | 仍建议绕过；浏览器本地可缓存一天 |
| 分享页面、文件域名、失效与不存在页面 | `no-store` | 绕过 |
| `/api/` | JSON 与导出禁止缓存，图标为私有缓存 | 整段绕过 |
| 管理端 HTML | `no-cache` | 绕过 |
| 已存在的 `/admin/assets/` 构建资源 | `public, max-age=31536000, immutable` | 尊重源站缓存头 |

Cloudflare **Cache Rules** 可按下面顺序设置（替换示例域名）：

1. 主域名与文件域名默认绕过：表达式 `http.host in {"s.example.com" "f.example.com"}`，Cache eligibility 选 **Bypass cache**。
2. 主域名静态资源例外：表达式 `http.host eq "s.example.com" and starts_with(http.request.uri.path, "/admin/assets/")`，Cache eligibility 选 **Eligible for cache**；Edge TTL 选 **Use cache-control header if present, bypass cache if not**，Browser TTL 选 **Respect origin**。

把这两条放在可能匹配的通用缓存规则之后，并保持静态资源例外在最后；Cloudflare 对冲突设置采用最后匹配的规则。不要再用其他规则、旧 Page Rules 或 Worker 覆盖这些路径的策略，也不要强制忽略源站头或设置状态码 TTL。不要只按 `.png` 等扩展名放行缓存：短码本身也可以带扩展名。设置名称与规则顺序见 Cloudflare 的[缓存规则设置](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/)和[规则顺序](https://developers.cloudflare.com/cache/how-to/cache-rules/order/)。

若希望配置最简单，只有第一条也可以，代价是管理端静态资源每次都回源。变更前已经进入 CDN 的动态响应应清除缓存。验证时检查实际短链、分享页面和文件响应：`DYNAMIC`、`BYPASS` 或未缓存的 `MISS` 本身不表示故障；受限跳转和文件不应持续出现 `HIT`、`STALE` 或 `UPDATING`。静态资源出现 `HIT` 则是预期行为。单次 `/healthz` 或 `robots.txt` 的结果不能证明其他路径的缓存策略。

::: warning 永久重定向的浏览器缓存
CDN 绕过规则不能清除浏览器已保存的 301/308 跳转。无限制永久跳转仍允许浏览器缓存一天，其间点击统计、目标修改、停用和删除无法影响未回源的请求。需要这些行为及时生效时使用默认 302；给曾经缓存的永久跳转追加限制时，必要时换一个短码。v0.8.0 起带有效期或访问上限的跳转统一发送 `no-store`，但不能撤回此前已缓存的响应。
:::

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
