# 参与开发

<p class="lead">Sani 代码仓库包含三大模块：Go 服务端核心、Svelte 管理后台与 VitePress 双语文档站。本页介绍本地开发环境搭建、常用工程脚本与核心设计不变量。</p>

## 环境准备

依赖 Go、Node.js 与 pnpm 工具链，版本均锁定于 `mise.toml`。使用 [mise](https://mise.jdx.dev) 可一键配置运行环境：

```sh
mise install
make install      # 安装 web 与 docs 依赖（pnpm workspace 统一管理）
```

## 目录结构

```
cmd/sani            程序入口与 CLI 子命令
internal/server     路由、跳转热路径、JSON API、内嵌资源、访客公开页
internal/cache      跳转目标分片内存缓存
internal/clicks     点击量内存聚合与批量入库
internal/store      SQLite 表结构、无感迁移与查询层
internal/links      短码与 URL 规范化过滤规则
internal/meta       元数据与 Favicon 抓取及 SSRF 阻断
internal/auth       密码 argon2id 哈希、会话管理与登录频控
internal/config     环境变量解析与校验
internal/webui      前端构建产物 Go embed 封装
web/                管理端前端：Svelte 5 (Runes) + TypeScript + Vite
docs/               双语技术文档：VitePress
scripts/            测试种子数据、基准压测与发版脚本
deploy/             systemd、Caddy 与 nginx 生产配置模板
.github/            CI/CD、发布流水线与 Issue 模板
```

根目录为 Go 模块；`web` 与 `docs` 组织为单一 pnpm 工作区，依赖版本通过 `pnpm-workspace.yaml` 中的 `catalog` 统一约束。

## 常用开发命令

| 命令 | 用途说明 |
|---|---|
| `make dev-backend` | 运行 Go 后端服务，监听 `127.0.0.1:8080` |
| `make dev-frontend` | 启动 Vite 热更新服务器（`127.0.0.1:5173/admin/`），API 自动代理至后端 |
| `make demo` | 编译并拉起内置演示数据的沙箱实例（预设密码 `sani-demo`） |
| `make check` | 静态质量检查：gofmt、go vet、svelte-check、文档与源码核对、vue-tsc |
| `make test` | 单元测试套件：Go 竞态检测（`-race`）与前端测试 |
| `make e2e` | 启动全新实例并运行 Playwright 端到端全链路测试 |
| `make smoke` | 运行真实二进制，验收认证、网址/文本/文件/标签、SIGTERM 停机、CLI 备份恢复与密码重置 |
| `make bench` | 核心跳转、缓存查找与点击累加基准性能测试 |
| `make load` | 高并发轰炸压测（自动校验重定向与落库计数绝对一致） |
| `make capacity` | 阶梯容量压测（1千/1万/10万级），输出结构化 JSON |
| `make build` | 编译前端资产并注入，输出二进制 `./bin/sani` |
| `make dist` | 打包全平台多架构发布压缩包及 `SHA256SUMS`（输出至 `dist/`） |
| `make docker` | 构建静态 Docker 镜像 |
| `make docs-dev` | 启动文档本地预览服务器（`127.0.0.1:5174`） |
| `make docs` | 构建静态文档站点（输出至 `docs/.vitepress/dist`） |

提交代码前务必通过 `make check test`；涉及管理界面改动必须执行 `make e2e`。发布验收还需运行 `make smoke`，通过真实进程验证 HTTP、CLI 与冷备恢复路径。本地测试服务一律限定绑定 `127.0.0.1`。

## 架构核心原则（不变量）

- **跳转路径零 DB 交互**：缓存命中时绝不触碰 SQLite，更不等待磁盘 I/O。修改 `redirect.go`、`cache` 或 `clicks` 前后必须运行 `make bench` 评估延迟基线。
- **坚守纯 Go 零 cgo 依赖**：SQLite 采用 `modernc.org/sqlite`，确保全静态链接并支持 `scratch` 裸容器运行。
- **坚守安全防护边界**：爬虫抓取层预解析与 Dial 拨号双重防 SSRF、危险 URL 协议过滤、首登日志设置码机制、会话 Cookie 严防跨站（Strict + /api/ 限域）、CSRF 拦截与后台强 CSP 策略。
- **外部输入严格施加容量边界**：任何以客户端输入为 Key 的映射结构必须配置显式容量上限。
- **UI 文案双语同源**：文案统一维护于 `web/src/lib/i18n.svelte.ts`。中文表达地道自然，拒绝生硬机器直译。
- **坚决不引入重量级 UI 与图标依赖**：图标采用 `Icon.svelte` 矢量手绘；下拉框使用原生 Popover API，弹窗使用原生 `<dialog>`。
- **无障碍（A11y）验收**：要求文本对比度满足 WCAG AA，操作支持键盘。管理端 `pnpm --dir web a11y` 检查主要页面的中文/英文与浅色/深色组合；文档站 `pnpm --dir docs a11y` 检查所有页面的双语双主题。axe 扫描应零违规，仍需人工核对焦点与键盘交互。
- **统一 API 错误协议**：所有异常统一响应 `{"error": {"code": "…", "message": "…"}}`，前端基于 `code` 路由至对应多语言文案。

## 文档同步维护

文档站位于 `docs/`，可通过 `make docs-dev` 实时预览改动。

- **页面对齐**：侧边栏路由登记于 `docs/.vitepress/pages.ts`。中文源文件位于 `docs/`，英文置于 `docs/en/`，目录层级严格一致。
- **强类型源码比对**：构建前执行 `node docs/.vitepress/sync/check.ts`，强一致性校验涵盖配置项、接口、错误码及命令行参数。比对规则与状态见[进度清单](./progress#checks)。
- **无障碍检测**：先构建 `pnpm --dir docs build`，通过 `pnpm --dir docs preview` 启动预览，随后执行 `pnpm --dir docs a11y` 进行全页全主题 axe 审计。
- **SEO 回归**：逐页摘要与 canonical、hreflang、OG、Twitter、JSON-LD 由 `.vitepress/seo.ts` 生成，随 `make check` 验证。`make docs` 在构建后执行 `scripts/check-seo.mjs`，检查真实 HTML 的唯一标题、摘要与 canonical，双语 sitemap、robots 与 404 禁止收录；新增页面需补充双语摘要。
- **自动化衍生内容**：首页演示组件、部署生成器与性能图表数据均通过模板或共享数据脚本自动挂载，无需手动复制粘贴。

源码变更与文档更新映射清单：

| 代码改动类型 | 必须同步更新的文档 |
|---|---|
| 环境变量配置 | `reference/configuration.md` 及根目录中英双语 README |
| API 端点或错误代码 | `reference/api.md` |
| CLI 子命令或标志位 | `reference/cli.md` |
| 系统保留短码字 | `guide/usage.md` |
| 压测基准数据 | `docs/.vitepress/data/benchmark.ts` 及双语 README |
| 官方发布架构平台 | `guide/deploy.md` 下载表格与镜像架构清单 |

变更必须同步维护中文与英文两套文档；若有遗漏，构建检测脚本会精准指出缺失条目。

### 自动化截图生成

文档与 README 中的系统截图由脚本 `web/scripts/screenshots.mjs` 全自动生成（覆盖双语与深浅模式）：

```sh
make build
go run ./scripts/seed -data /tmp/sani-demo -base https://s.example.com
SANI_LISTEN=127.0.0.1:18080 SANI_DATA_DIR=/tmp/sani-demo ./bin/sani &
SANI_LISTEN=127.0.0.1:8080 SANI_DATA_DIR=/tmp/sani-fresh ./bin/sani &
cd web && SANI_URL=http://127.0.0.1:18080 SANI_FRESH_URL=http://127.0.0.1:8080 node scripts/screenshots.mjs
```

第二个实例没有密码，用来拍首次设置的页面。这个页面会显示实例的地址，所以它使用快速开始里的 8080 端口。截图保存在 `docs/public/screenshots/`。

## 持续集成与发布 {#release}

每次推送和拉取请求都会运行 [CI](https://github.com/DejavuMoe/sani/actions/workflows/ci.yml)：

- `make check test`，另外在 macOS 和 Windows 上运行 Go 测试；
- 端到端测试，以及对管理界面的 axe 检查；
- 直接 HTTP 契约、旧二进制升级与完整快照回滚，以及非 root Docker 绑定存储故障演练；
- 构建文档站，对每一页做 axe 检查；
- 为每个发布平台试构建镜像，启动它，等健康检查通过；
- 构建全部二进制文件的压缩包；
- 用 `govulncheck`、工作区 `pnpm audit --audit-level=moderate` 和两个受跟踪设计工具的 npm audit 检查已知漏洞。每周一还会自动运行一次，不用等到有新提交。

[CodeQL](https://github.com/DejavuMoe/sani/actions/workflows/codeql.yml) 在推送、拉取请求和每周定时任务中扫描 Go、JavaScript/TypeScript、Python 与 GitHub Actions。Go 使用项目固定的工具链构建，其余语言直接分析源码。

发布一个新版本：

推送入口是 Forgejo：`origin` 应指向 `ssh://git@ssh.via.moe/dejavu/sani.git`。Forgejo 收到推送后自动镜像到 GitHub，触发应用 CI 与发布构建。文档站由 `.woodpecker/docs.yml` 监听 Forgejo 的 `master` 推送并部署到 `https://sani.zsh.moe`；只推 GitHub 或只推标签不会触发这条文档部署流程。

1. 把两份更新日志里的“未发布”一节改成新版本，标题是 `## v0.9.4` 这样的格式，并在下一行写上日期；同步 Compose、双语下载示例与镜像校验示例的完整版本标签。
2. 运行 `make check test e2e smoke docs VERSION=v0.9.4` 和 `bash scripts/test-release-notes.sh`，确认 `scripts/release-notes.sh v0.9.4` 能生成说明。
3. 提交后先用 `git remote get-url origin` 核对 Forgejo 地址，再 `git push origin master`。确认镜像到 GitHub 的提交一致，等待该提交的 CI 与 CodeQL 通过，并检查 Woodpecker 文档部署。
4. 在已通过检查的提交上创建附注标签，推送到同一个 Forgejo 远程：

   ```sh
   git tag -a v0.9.4 -m "Sani v0.9.4"
   git push origin refs/tags/v0.9.4
   ```

5. 等待 GitHub Release 成功，核对 Forgejo 与 GitHub 的标签对象及目标提交一致；验证所有压缩包的 SHA-256 与来源证明、多平台镜像和实际运行版本，以及线上中英文文档的版本和内容。已发布标签不得移动、重建或强推；补同步缺失标签时推送原有对象。

发布流程会先确认英文更新日志里有这个版本的条目（没有就停下），再运行一遍检查和测试，然后构建各平台的压缩包和 `SHA256SUMS`、推送多平台镜像（附 SBOM），为两者生成构建来源证明，最后创建 GitHub Release，说明取自更新日志。`v0.9.4-rc.1` 这样的标签会标记为预发布。镜像始终使用完整版本标签，不发布 `latest` 或浮动标签。

在本地可以用 `make web dist VERSION=v0.2.0` 得到和发布时相同的压缩包。同一个提交构建两次，结果逐字节相同。

HTTP 契约与升级门槛：`make install` 后执行 `make contract`，并使用 schema 5 基线二进制执行 `OLD_BIN=/absolute/path/to/old-sani make upgrade-drill`。仍需 `make check test`、`make e2e`、`make smoke`。契约脚本使用 Node 标准库、fetch 和 FormData，不依赖 s.ee SDK。


Docker 存储演练：先构建本地镜像，再执行 `bash scripts/test-docker-storage.sh sani:upgrade /absolute/path/to/old-sani`。脚本从待测镜像提取真实二进制，在 UID 65532、真实绑定目录和临时 Node 测试容器中复用完整 HTTP/迁移/回滚演练；Node 仅用于测试，正式镜像仍为 scratch。额外验证只读数据库被预检拒绝，以及隔离的 16 MiB tmpfs 耗尽产生真实 ENOSPC：三次失败启动不遗留半成品副本，释放空间后旧 schema 与文件仍可预检。

## 消融与依赖检查 {#ablation}

`make ablation` 对缓存与点击聚合逐项消融并断言计数守恒，[实验记录](../internals/performance#ablation)保留条件、三次结果及限制。协议测试使用 Node 内置 fetch/FormData，无外部 SDK 或新增运行依赖。

2026-10-10 的引用检查覆盖 36 个 Svelte 组件，均有调用，保留现有共用组件。五个直接 Go 模块分别负责 Argon2、HTML/IDNA/代理、终端密码输入、Unicode 规范化和纯 Go SQLite；`go mod tidy -diff` 与 `go mod verify` 用于验证图与校验和。前端运行依赖是本地字体和二维码编码；文档运行依赖还包括 Vue、VitePress 和评论组件 Ecoku。测试/类型检查工具归入开发依赖。删除这些依赖会改变已有能力，因此没有仅为减少数量而移除它们；`go.mod`、`go.sum` 和工作区锁文件未改变。

脚本按实际用途保留：`screenshots.mjs` 生成文档所需固定文件名，`shots.mjs` 覆盖更多交互场景，`fresh-shots.mjs` 验证初始化和空状态，`icons.mjs` 生成图标。截图登录/初始化失败必须退出，不能把登录页误当业务截图。`smoke` 验证正常停机与备份；`upgrade-drill` 验证旧版升级/回滚；Docker 脚本验证权限、绑定目录、重启和磁盘满，三者各有边界。发布脚本通过 `test-release-notes.sh`、`test-publish-docs.sh` 的隔离夹具验证，不会部署站点。

文档检查从源码提取路由、错误码、环境变量、CLI、保留短码、输入长度和发布平台，并用负例测试防止旧事实重新混入。历史 API 归档不参加当前路由集合比较。自然语言和交互仍需结合源码、HTTP 契约与浏览器检查，自动检查不是所有行为的形式化证明。
