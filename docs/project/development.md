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
| `make bench` | 核心跳转、缓存查找与点击累加基准性能测试 |
| `make load` | 高并发轰炸压测（自动校验重定向与落库计数绝对一致） |
| `make capacity` | 阶梯容量压测（1千/1万/10万级），输出结构化 JSON |
| `make build` | 编译前端资产并注入，输出二进制 `./bin/sani` |
| `make dist` | 打包全平台多架构发布压缩包及 `SHA256SUMS`（输出至 `dist/`） |
| `make docker` | 构建静态 Docker 镜像 |
| `make docs-dev` | 启动文档本地预览服务器（`127.0.0.1:5174`） |
| `make docs` | 构建静态文档站点（输出至 `docs/.vitepress/dist`） |

提交代码前务必通过 `make check test`；涉及管理界面改动必须执行 `make e2e`。本地测试服务严禁对外暴露，一律限定绑定 `127.0.0.1`。

## 架构核心原则（不变量）

- **跳转路径零 DB 交互**：缓存命中时绝不触碰 SQLite，更不等待磁盘 I/O。修改 `redirect.go`、`cache` 或 `clicks` 前后必须运行 `make bench` 评估延迟基线。
- **坚守纯 Go 零 cgo 依赖**：SQLite 采用 `modernc.org/sqlite`，确保全静态链接并支持 `scratch` 裸容器运行。
- **坚守安全防护边界**：爬虫抓取层预解析与 Dial 拨号双重防 SSRF、危险 URL 协议过滤、首登日志设置码机制、会话 Cookie 严防跨站（Strict + /api/ 限域）、CSRF 拦截与后台强 CSP 策略。
- **外部输入严格施加容量边界**：任何以客户端输入为 Key 的映射结构必须配置显式容量上限。
- **UI 文案双语同源**：文案统一维护于 `web/src/lib/i18n.svelte.ts`。中文表达地道自然，拒绝生硬机器直译。
- **坚决不引入重量级 UI 与图标依赖**：图标采用 `Icon.svelte` 矢量手绘；下拉框使用原生 Popover API，弹窗使用原生 `<dialog>`。
- **无障碍（A11y）合规**：双主题满足 WCAG AA 文本对比度要求，全功能支持键盘访问，axe 扫描零违规（管理端 `pnpm --dir web a11y`，文档站 `pnpm --dir docs a11y`）。
- **统一 API 错误协议**：所有异常统一响应 `{"error": {"code": "…", "message": "…"}}`，前端基于 `code` 路由至对应多语言文案。

## 文档同步维护

文档站位于 `docs/`，可通过 `make docs-dev` 实时预览改动。

- **页面对齐**：侧边栏路由登记于 `docs/.vitepress/pages.ts`。中文源文件位于 `docs/`，英文置于 `docs/en/`，目录层级严格一致。
- **强类型源码比对**：构建前执行 `node docs/.vitepress/sync/check.ts`，强一致性校验涵盖配置项、接口、错误码及命令行参数。比对规则与状态见[进度清单](./progress#checks)。
- **无障碍检测**：先构建 `pnpm --dir docs build`，通过 `pnpm --dir docs preview` 启动预览，随后执行 `pnpm --dir docs a11y` 进行全页全主题 axe 审计。
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
- 构建文档站，对每一页做 axe 检查；
- 为每个发布平台试构建镜像，启动它，等健康检查通过；
- 构建全部二进制文件的压缩包；
- 用 `govulncheck`、工作区 `pnpm audit --audit-level=moderate` 和两个受跟踪设计工具的 npm audit 检查已知漏洞。每周一还会自动运行一次，不用等到有新提交。

[CodeQL](https://github.com/DejavuMoe/sani/actions/workflows/codeql.yml) 在推送、拉取请求和每周定时任务中扫描 Go、JavaScript/TypeScript、Python 与 GitHub Actions。Go 使用项目固定的工具链构建，其余语言直接分析源码。

发布一个新版本：

1. 把两份更新日志里的“未发布”一节改成新版本，标题是 `## v0.2.0` 这样的格式，并在下一行写上日期；
2. 提交并推送，等 CI 通过；
3. 打标签并推送：

   ```sh
   git tag -a v0.2.0 -m v0.2.0
   git push origin v0.2.0
   ```

发布流程会先确认英文更新日志里有这个版本的条目（没有就停下），再运行一遍检查和测试，然后构建各平台的压缩包和 `SHA256SUMS`、推送多平台镜像（附 SBOM），为两者生成构建来源证明，最后创建 GitHub Release，说明取自更新日志。`v0.2.0-rc.1` 这样的标签会标记为预发布，不会更新镜像的 `latest`。

在本地可以用 `make web dist VERSION=v0.2.0` 得到和发布时相同的压缩包。同一个提交构建两次，结果逐字节相同。
