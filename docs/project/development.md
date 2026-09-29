# 参与开发

<p class="lead">Sani 的仓库里有三样东西：Go 写的服务端、Svelte 写的管理界面，以及这个文档站。这一页介绍开发环境、常用命令，以及修改代码时需要守住的几条约定。</p>

## 准备环境

需要 Go、Node.js 和 pnpm，版本固定在 `mise.toml` 里。装了 [mise](https://mise.jdx.dev) 的话，一条命令就能装好对应的版本，`make` 也会自动使用它们：

```sh
mise install
make install      # 安装 web 和 docs 的依赖（pnpm 工作区）
```

## 仓库结构

```
cmd/sani            程序入口和子命令
internal/server     路由、跳转、JSON API、内嵌的管理界面、访问者页面
internal/cache      跳转目标缓存
internal/clicks     点击聚合与批量写入
internal/store      SQLite：表结构、迁移和查询
internal/links      短码和网址的规则
internal/meta       标题和图标抓取，以及 SSRF 防护
internal/auth       密码哈希、随机凭据、登录限流
internal/config     读取环境变量
internal/webui      嵌入构建好的管理界面
web/                管理界面：Svelte 5 + TypeScript，Vite 构建
docs/               本文档站：VitePress
scripts/            演示数据和压测脚本
deploy/             systemd、Caddy 和 nginx 的示例配置
```

Go 模块在仓库根目录；`web` 和 `docs` 是同一个 pnpm 工作区里的两个包，共用一份锁文件，字体等共同依赖的版本写在 `pnpm-workspace.yaml` 的 `catalog` 里。

## 常用命令

| 命令 | 作用 |
|---|---|
| `make dev-backend` | 启动后端，监听 `127.0.0.1:8080` |
| `make dev-frontend` | 启动 Vite，打开 `127.0.0.1:5173/admin/`，`/api` 转发给后端 |
| `make demo` | 构建并启动一个带演示数据的实例，密码是 `sani-demo` |
| `make check` | gofmt、go vet、svelte-check，以及文档与源码的核对和类型检查 |
| `make test` | Go 测试（带 `-race`）和前端单元测试 |
| `make e2e` | 用 Playwright 对一个全新的实例做端到端测试 |
| `make bench` | 跳转、缓存和点击计数的基准测试 |
| `make load` | 压测，并核对点击数 |
| `make build` | 构建管理界面，再构建 `bin/sani` |
| `make docker` | 构建 Docker 镜像 |
| `make docs-dev` | 启动文档站，打开 `127.0.0.1:5174` |
| `make docs` | 构建静态文档站，输出到 `docs/.vitepress/dist` |

一个改动完成之前，至少运行 `make check test`；改动涉及管理界面时，再运行 `make e2e`。所有开发服务器都只监听 `127.0.0.1`。

## 约定

- **跳转不碰数据库。** 缓存命中时，跳转不访问数据库，也从不等待写入完成。修改 `redirect.go`、`cache` 或 `clicks` 前后，各跑一次 `make bench` 对比。
- **不用 cgo。** SQLite 使用纯 Go 的 `modernc.org/sqlite`，镜像基于 `scratch`。
- **安全边界不能退让。** 抓取器的 SSRF 检查、被拒绝的网址类型、首次设置的设置码、只作用于 `/api/` 的会话 Cookie、跨站请求保护，以及管理界面的内容安全策略。
- **外部输入都要有上限。** 以客户端输入为键的新 map，同样需要数量上限。
- **每条界面文案都有中英两个版本**，写在 `web/src/lib/i18n.svelte.ts` 里。中文是写给中文读者的，不逐字翻译英文。
- **不引入 UI 库和图标库。** 图标是 `Icon.svelte` 里手绘的路径，菜单用 Popover API，对话框用 `<dialog>`。
- **无障碍。** 两种主题下文字都满足 WCAG AA 对比度，所有操作都能用键盘完成，axe 检查没有问题：管理界面用 `pnpm --dir web a11y`，文档站用 `pnpm --dir docs a11y`。
- **API 的错误**统一为 `{"error": {"code": "…", "message": "…"}}`，管理界面把 `code` 映射到 `err.*` 文案。

## 文档

文档站在 `docs/` 目录，用 `make docs-dev` 在本地预览，修改会立即生效。

- **页面**：侧边栏里的页面都登记在 `docs/.vitepress/pages.ts` 中。中文页面放在 `docs/` 下，英文页面放在 `docs/en/` 下相同的位置，两种语言的页面必须一一对应。
- **与源码核对**：`node docs/.vitepress/sync/check.ts` 会把文档和源码逐项比对，`make check` 和文档构建都会运行它。比对的内容和结果见[进度](./progress#checks)。
- **无障碍检查**：先 `pnpm --dir docs build`，再用 `pnpm --dir docs preview` 启动预览，然后运行 `pnpm --dir docs a11y`。它会用 axe 检查每一页的中英文版本和两种主题。
- **来自源码的内容**：首页的演示使用管理界面自己的文案和短码规则，部署页的生成器直接修改仓库里的配置文件，性能数据来自 `docs/.vitepress/data/benchmark.ts`。这些内容不需要手动同步。

修改代码时，同时更新对应的文档：

| 修改了 | 需要更新 |
|---|---|
| 环境变量 | `reference/configuration.md` 和两份 README 的配置表 |
| API 接口或错误码 | `reference/api.md` |
| 子命令 | `reference/cli.md` |
| 保留的短码 | `guide/usage.md` |
| 压测结果 | `docs/.vitepress/data/benchmark.ts` 和两份 README |

中文和英文两个版本都要更新；漏掉的话，核对会指出具体是哪一项。

### 截图

文档和 README 里的截图由 `web/scripts/screenshots.mjs` 生成，覆盖两种语言、两种主题：

```sh
make build
go run ./scripts/seed -data /tmp/sani-demo -base https://s.example.com
SANI_LISTEN=127.0.0.1:18080 SANI_DATA_DIR=/tmp/sani-demo ./bin/sani &
SANI_LISTEN=127.0.0.1:8080 SANI_DATA_DIR=/tmp/sani-fresh ./bin/sani &
cd web && SANI_URL=http://127.0.0.1:18080 SANI_FRESH_URL=http://127.0.0.1:8080 node scripts/screenshots.mjs
```

第二个实例没有密码，用来拍首次设置的页面。这个页面会显示实例的地址，所以它使用快速开始里的 8080 端口。截图保存在 `docs/public/screenshots/`。
