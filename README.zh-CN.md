# Sani

一个小而快、可以自己部署的短链接服务。一个二进制文件、一个 SQLite 数据库，不依赖任何外部服务。

[![CI](https://github.com/DejavuMoe/sani/actions/workflows/ci.yml/badge.svg)](https://github.com/DejavuMoe/sani/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/DejavuMoe/sani?label=release)](https://github.com/DejavuMoe/sani/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[文档](https://dejavumoe.github.io/sani/) · [下载](https://github.com/DejavuMoe/sani/releases) · [English](README.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/public/screenshots/dashboard-dark-zh.png">
  <img alt="Sani 的管理界面：顶部是缩短链接的输入框和近 30 天的点击趋势，下面是短链接列表。" src="docs/public/screenshots/dashboard-light-zh.png">
</picture>

粘贴长链接，按下回车，短链接就已经在剪贴板里了。Sani 会自动获取网页标题和图标，方便日后辨认。点击统计不会拖慢跳转。除此之外，它不来打扰你。

- **快在该快的地方**：跳转直接从内存返回。在一台 8 核笔记本上约每秒 13 万次请求，中位延迟不到 1 毫秒，而且每一次点击都被准确计数（见下方[性能](#性能)）。
- **用起来顺手**：在页面任意位置粘贴或拖入链接即可缩短。自定义短码边输入边检查是否可用。整个控制台都可以用键盘完成。删除后可以撤销，不弹确认框。
- **够用的统计**：总点击、每日趋势、主要来源、最近访问。爬虫、链接预览、浏览器预取和你自己在控制台里的点击都不计入。
- **每条链接都可控**：设置过期时间、访问次数上限，选择临时或永久跳转，也可以随时停用。修改目标链接后立即生效。
- **融入你的日常**：书签小工具、Android 系统分享菜单（添加到主屏幕后），供脚本和快捷指令使用的 API 令牌，还能从 Shlink、Sink、YOURLS 或 CSV 导入。
- **支持中文短码**：`s.example.com/简历` 可以直接使用，短码不区分大小写。
- **中文 / English 切换**，浅色 / 深色主题，桌面和手机都好用。

## 文档

完整的中英文文档在 **[dejavumoe.github.io/sani](https://dejavumoe.github.io/sani/)**：[部署](https://dejavumoe.github.io/sani/guide/deploy)与[运维](https://dejavumoe.github.io/sani/guide/operations)指南，[配置项](https://dejavumoe.github.io/sani/reference/configuration)、[HTTP API](https://dejavumoe.github.io/sani/reference/api) 和[命令行](https://dejavumoe.github.io/sani/reference/cli)参考，以及 Sani 内部是怎么工作的。部署页有一个配置生成器，填上域名就能拿到全部部署文件。每次构建都会拿文档与源码逐项核对，所以文档里列出的配置项、接口、错误码和命令，就是代码里实际有的那些。

## 快速开始

### Docker Compose

```sh
mkdir sani && cd sani
curl -fsSLO https://raw.githubusercontent.com/DejavuMoe/sani/main/compose.yaml
# 在 compose.yaml 里设置 SANI_BASE_URL（以及 TZ），然后：
docker compose up -d
```

打开 `http://127.0.0.1:8080/admin/`，设置管理员密码。首次设置时还需要填写 Sani 打印在启动日志里的设置码（`docker logs sani` 查看），这样刚部署好的实例不会被别人抢先占用；设置了 `SANI_BASE_URL` 时，日志里还会给出一个已经带上设置码的链接。也可以事先用 `SANI_PASSWORD` 指定密码，跳过这一步。对外服务时请在前面加一层 TLS 反向代理，[deploy/](deploy/) 目录里有 Caddy、nginx 和 systemd 的示例。

镜像 `ghcr.io/dejavumoe/sani` 基于 `scratch` 构建，支持 `linux/amd64`、`linux/arm64` 和 `linux/arm/v7`：约 24 MB，以非特权用户运行，数据保存在 `/data` 卷中。

### 单个二进制文件

每个[版本](https://github.com/DejavuMoe/sani/releases/latest)都提供 Linux、macOS、Windows 和 FreeBSD 的压缩包，附校验和与构建来源证明：

```sh
curl -fsSL https://github.com/DejavuMoe/sani/releases/latest/download/sani-linux-amd64.tar.gz | tar -xz sani
SANI_BASE_URL=https://s.example.com ./sani
```

二进制文件内嵌了管理界面，运行时不再需要其他任何东西。想自己构建，运行 `make install build`（需要 Go 1.27+、Node 24 和 pnpm），产物为 `./bin/sani`。忘记密码时，`sani passwd` 会重设密码并让所有设备退出登录（Docker 中：`docker exec -it sani /sani passwd`）。

## 配置

全部通过环境变量配置，示例见 [.env.example](.env.example)，每一项的详细说明见[配置项](https://dejavumoe.github.io/sani/reference/configuration)。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SANI_LISTEN` | `:8080` | 监听地址。 |
| `SANI_DATA_DIR` | `data` | `sani.db` 所在目录。 |
| `SANI_BASE_URL` | — | 短链接使用的域名，如 `https://s.example.com`。不设置时使用你当前访问的地址，也可以在设置页里修改。 |
| `SANI_PASSWORD` | — | 固定的管理员密码（至少 8 个字符）。不设置则在首次访问时设置。 |
| `SANI_SETUP_CODE` | 随机 | 首次设置密码时要填写的设置码。默认在还没有密码时每次启动随机生成，并打印到日志里。 |
| `SANI_ROOT_REDIRECT` | — | 访问根路径 `/` 时跳转到哪里，默认进入管理界面。 |
| `SANI_TRUST_PROXY` | `false` | 信任 `X-Forwarded-*` 和 `X-Real-IP`，客户端地址取 `X-Forwarded-For` 的最后一项。只在会设置这些请求头的反向代理之后开启。 |
| `SANI_SLUG_LENGTH` | `5` | 自动生成的短码长度。字符集为 `23456789abcdefghjkmnpqrstuvwxyz`，去掉了 0/o、1/l/i，念出来也不会弄错。 |
| `SANI_FETCH_META` | `true` | 为新链接获取网页标题和图标。不会访问内网、本机等私有地址。 |
| `SANI_FORWARD_QUERY` | `true` | 把访问者的查询参数带到目标链接上（`/gh?utm_source=x`）。 |
| `SANI_CACHE_SIZE` | `100000` | 内存中缓存的跳转目标数量。 |
| `SANI_LOG_LEVEL` / `SANI_LOG_FORMAT` | `info` / `text` | 日志级别 `debug`…`error`；格式 `text` 或 `json`。 |
| `TZ` | 系统时区 | 每日统计按这个时区划分日期。 |

管理界面位于 `/admin/`，API 位于 `/api/`，其余路径都是短链接。`admin`、`api`、`rest`、`healthz`、`robots.txt` 和几个网站图标文件名是保留的，不能用作短码。

## 日常使用

**键盘**：`N` 新建 · `/` 搜索 · `J`/`K` 上下移动 · `回车` 展开 · `C` 复制 · `E` 编辑 · `Del`（Mac 上为 `⌘⌫`）删除，可撤销 · `Esc` 收起 · `?` 查看全部快捷键。在页面任意位置粘贴链接，就能开始缩短。

**书签小工具**：打开设置 → 快捷方式，把“缩短此页”拖到书签栏。之后在任何网页上点一下，会弹出一个小窗口缩短当前页面并复制结果。如果这个页面以前缩短过，直接给你原来的短链接。

**手机**：把 Sani 添加到主屏幕。在 Android 上，之后它会出现在其他应用的“分享”菜单里。

**API**：在设置里创建令牌，然后：

```sh
curl -X POST https://s.example.com/api/links \
  -H "Authorization: Bearer sani_…" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/some/long/path", "slug": "demo"}'
```

每个接口和错误码的说明见 [HTTP API](https://dejavumoe.github.io/sani/reference/api)。

**导入与导出**：设置 → 数据，可以把全部链接导出为 JSON 或 CSV。导入支持 Sani 自己的导出文件、Shlink 的 JSON（`shortCode`、`longUrl`、`visitsSummary` 等字段）、Sink 的导出、YOURLS 或 Kutt 的 CSV，以及任何带 `url` 列的 CSV。已存在的短码会被跳过，并列出来告诉你。

**访问者看到的页面**：短码不存在时显示简洁的 404 页面；链接过期、停用或次数用完时显示 410 页面。页面会按访问者的浏览器语言显示中文或英文。

## 性能

`make load` 会用 [bombardier](https://github.com/codesenberg/bombardier) 压测发布版构建：128 个并发连接，持续 15 秒。压测工具和服务运行在同一台 8 核笔记本上（Intel Core Ultra 7 255H，WSL2）。

| 路径 | 每秒请求数 | p50 | p99 |
|---|---|---|---|
| 命中缓存的跳转（计入点击） | 131,075 | 0.80 ms | 3.43 ms |
| 带访问次数上限的跳转 | 129,448 | 0.81 ms | 3.44 ms |
| 不存在的短码（404 页面） | 83,746 | 1.24 ms | 5.29 ms |

脚本最后会核对数据库中的点击总数与实际完成的跳转次数。上面这次运行中，完成了 1,965,880 次跳转，记录了 1,965,880 次点击，一次不差。单看处理函数本身，每次跳转约 0.42 微秒（`make bench`）。笔记本上每次压测的结果会有 10% 左右的浮动，但点击总数始终一致。

做法：

- 跳转目标放在 SQLite 前面的分片内存缓存里。不存在的短码单独缓存且有上限，随机扫描短码不会把真实链接挤出缓存；同一个短码的并发未命中只查一次数据库。
- 记一次点击只是内存里的一次累加。聚合后的计数每两秒合并成一个事务写入 SQLite，关闭服务时也会写入。
- SQLite 使用 WAL 模式，一个写连接加一组读连接，读永远不用等写。
- 管理界面内嵌在二进制中，构建时预先用 Brotli 和 gzip 压缩好。

测试方法和微基准测试见文档里的[性能](https://dejavumoe.github.io/sani/internals/performance)。

## 项目结构

```
cmd/sani            入口：serve、passwd、backup、healthcheck、version
internal/server     HTTP：跳转、JSON API、内嵌界面、访问者页面
internal/cache      跳转缓存：未命中缓存与写入竞争保护
internal/clicks     点击的内存聚合与批量写入
internal/store      SQLite（modernc.org/sqlite，无 cgo）、迁移与查询
internal/links      短码规则、URL 规范化、Location 头编码
internal/meta       带 SSRF 防护的标题与图标获取
internal/auth       argon2id 密码、令牌、登录限流
web/                管理界面：Svelte 5 + TypeScript，Vite 构建
docs/               文档站：VitePress，构建时与源码核对
```

安全方面（详见文档里的[安全](https://dejavumoe.github.io/sani/internals/security)）：

- 会话 Cookie 为 HttpOnly、SameSite=Strict，只作用于 `/api/`，跨站请求一律拒绝（`http.CrossOriginProtection`）。
- API 令牌和会话凭据只保存 SHA-256 哈希，密码使用 argon2id。
- 新实例只有同时提供启动日志里的设置码，才能设置第一个密码；登录和首次设置都按客户端限流。
- 管理界面启用严格的 CSP，除带哈希的主题初始化脚本外不允许内联脚本。
- 抓取来的网站图标以无害方式返回。
- 目标链接不能是 `javascript:`、`data:`、`file:` 这类地址。获取标题时拒绝内网、本机和链路本地地址，DNS 解析之后也会再检查一次。
- 来源（Referer）谁都可以伪造，所以每条链接最多记录 200 个来源网站，其余的计入“其他来源”。

## 开发

```sh
mise install          # 按 mise.toml 安装 Go、Node、pnpm
make install          # 安装管理界面和文档站的依赖（同一个 pnpm 工作区）
make dev-backend      # API 运行在 127.0.0.1:8080
make dev-frontend     # Vite 运行在 127.0.0.1:5173/admin/，/api 代理到后端
make demo             # 带演示数据的本地实例（密码：sani-demo）
make docs-dev         # 文档站运行在 127.0.0.1:5174
make check test e2e   # gofmt、vet、类型检查、文档核对；Go（-race）与单元测试；Playwright
make load             # 上面的压测
```

改动需要遵守的规则见文档里的[参与开发](https://dejavumoe.github.io/sani/project/development)，提交改动的方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请[私下报告](SECURITY.md)，不要公开提交 issue。

## 数据与备份

所有数据都在 `SANI_DATA_DIR` 下的 `sani.db` 里，这是一个普通的 SQLite 文件（WAL 模式）。`sani backup FILE` 会在服务运行时写出一份一致的副本；文件名写 `-` 时，副本输出到标准输出。镜像里没有 shell，所以 Docker 下这样备份：

```sh
docker exec sani /sani backup - > sani-backup.db
```

恢复时先停止服务，再用副本替换 `sani.db`；具体步骤、定时备份和升级方法见[运维](https://dejavumoe.github.io/sani/guide/operations)。想要可移植的链接列表，用设置 → 数据 → 导出。

## 许可证

[MIT](LICENSE)
