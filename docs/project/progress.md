<script setup>
import { data as status } from '../.vitepress/data/status.data'
</script>

# 研发进度

<p class="lead">最近发布版本为 {{ status.latestVersion }}，尚未发布的修改列在更新日志顶部。本页列出已实现能力、生产验收入口与后续范围；功能已实现不等于某个部署已通过验收。</p>

## 功能现状 {#current}

| 核心模块 | 交付状态 | 覆盖特性 |
|---|---|---|
| 跳转与统计 | <span class="sn-status done">已完成</span> | 内存分片缓存、点击批量聚合、爬虫与预取过滤、有效期、访问配额 |
| 管理界面 | <span class="sn-status done">已完成</span> | 中英双语、深浅主题、键盘快捷键、批量操作、二维码、书签小脚本、PWA 分享菜单 |
| 标签管理 | <span class="sn-status done">已完成</span> | 短链接、文本与文件的彩色标签，创建与编辑时分配，按标签或未标记筛选，JSON/CSV 迁移（v0.5.0 起） |
| 文本与文件分享 | <span class="sn-status done">已完成</span> | `/p/` 路由下的纯文本与代码展示、独立文件域名安全下载（v0.3.0 起） |
| HTTP API | <span class="sn-status done">已完成</span> | 核心能力全量覆盖、API 令牌长效认证 |
| 导入与导出 | <span class="sn-status done">已完成</span> | 导入 Sani、Shlink CSV/JSON；导出网址链接为 Sani JSON 或 CSV |
| 部署生态 | <span class="sn-status done">已完成</span> | 基于 `scratch` 的极简 Docker 镜像，systemd、Caddy 与 nginx 生产配置 |
| 系统运维 | <span class="sn-status done">已完成</span> | 在线数据库快照、停机冷备及文件配套恢复、密码重置、健康度探针 |
| 双语文档 | <span class="sn-status done">已完成</span> | 中英双语站点，构建期与源码规则强一致性核对 |
| 发布流水线 | <span class="sn-status done">已完成</span> | Tag 触发自动发布：GHCR 多平台镜像，多操作系统与架构二进制，附校验和与构建来源 Attestation |
| 持续集成（CI） | <span class="sn-status done">已完成</span> | Linux/macOS/Windows Go 测试、全部发布平台交叉编译、E2E、axe 无障碍核查和已知漏洞扫描；结果以具体提交的流水线为准 |
| 线上文档站点 | <span class="sn-status done">已完成</span> | 官方中英双语文档已部署：[sani.zsh.moe](https://sani.zsh.moe) |

## 生产验收范围 {#production}

Sani 面向**单管理员、单个服务进程、本地持久化数据目录**的自托管部署。前置代理负责 HTTPS，文件分享使用独立主机名；备份、磁盘余量、日志监控和升级恢复由部署者负责。多个进程共享数据库时，内存缓存与访问额度不会同步，因此不支持通过多副本实现高可用。短码是分享地址，不是访客身份认证；点击统计也不承诺断电时零丢失。

每个准备发布的候选提交都应通过以下检查。历史版本的绿灯不能替代当前提交的结果。

| 验收层 | 检查入口 | 通过条件 |
|---|---|---|
| 代码与功能 | `make check test e2e` | 静态检查、Go 竞态、前端单测及实际浏览器操作通过 |
| 真实进程与恢复 | `make smoke` | 构建产物启动、正常停机、CLI 数据库备份与配套文件恢复通过；计数、凭据、标签、文本与文件哈希保留 |
| 存储演进与故障 | `internal/store/*_test.go`、`cmd/sani/main_test.go` | 历史 schema 迁移、失败回滚、锁等待、停机超时与刷盘失败有回归验证 |
| 容量与计数 | `make bench load capacity` | 记录测量环境；负载请求和点击一致，无未解释的性能退化 |
| 页面可用性 | `pnpm --dir web a11y`、`pnpm --dir docs a11y` | 管理端主要页面及全部文档页面的中英双语、深浅主题 axe 检查通过 |
| 文档与 SEO | `make docs`、文档输出与发布脚本检查 | 源码与双语说明对齐，页面描述、canonical、语言替代链接及站点地图对应实际页面 |
| 分发与供应链 | 当前提交的 CI、CodeQL 及 Release 工作流 | 跨平台测试、归档、容器、依赖扫描通过；正式制品另核对版本、校验和与来源证明 |

上述检查完成后，还需在目标部署上按[运维](../guide/operations)验证 HTTPS、反代信任、两个域名、卷权限、备份恢复和监控。`/healthz` 是存活探针，不代表数据库可写或完整功能健康。1.0 的兼容承诺需单独满足[版本与兼容](./versioning#before-1)，不由完成一轮本地检查自动触发。

## v0.9.3 短码与界面修复验收入口 {#r6-acceptance}

已实施批准的 R6，原型与产品同步修复。以下回归覆盖独立短码配置、稳定预览和响应式控件；触屏检查使用浏览器模拟，尚不代表 iOS/Android 真机及 Firefox/WebKit 验收。

| 能力 | 验收入口 |
|---|---|
| 三类长度、3–32 边界、环境锁定、旧设置初始化与重启持久化 | `internal/config/slug_lengths_test.go`、`internal/server/slug_lengths_test.go`、`cmd/sani/slug_lengths_test.go` |
| 实际生成、统计刷新保留正文与滚动位置、失败重试及编辑后刷新 | `web/e2e/r6.spec.ts` |
| 721/720、641/640、502/390/320px 控件尺寸，中英文、明暗、鼠标/触屏、展开状态与无障碍 | `web/e2e/metadata.spec.ts` |

## v0.5.0 标签管理验收入口 {#tags-acceptance}

| 能力 | 验收入口 |
|---|---|
| schema 4 迁移、关联事务、备份恢复与筛选分页 | `internal/store/tags_test.go` |
| 鉴权、文件上传清理、跨实例标签导入导出 | `internal/server/tags_test.go` |
| 创建与编辑、筛选、失败重试、移动端弹层、迟到响应保护 | `web/e2e/app.spec.ts` |

## v0.4.0 关键实施与验收入口 {#acceptance}

以下五批次特性均已纳入 v0.4.0 并落地，验收入口如下；远端流水线状态可查阅 [CI](https://github.com/DejavuMoe/sani/actions/workflows/ci.yml) 与 [CodeQL](https://github.com/DejavuMoe/sani/actions/workflows/codeql.yml)。

| 实施批次 | 交付内容 | 验收入口 |
|---|---|---|
| 1 · 计数正确性 | Range 与条件响应、共享额度、不可复用 ID、刷盘一致性 | `counting_test.go`、表结构迁移与并发测试 |
| 2 · 备份与文档 | 配套停机备份、恢复与哈希校验、统计和持久性口径、统一版本 | `TestStoppedBackup`、文档语义自动化核对 |
| 3 · 故障恢复 | 重试来源上限、外部锁等待上限 1 秒、停机与最终刷盘失败 | Go 竞态测试、锁与停机回归测试 |
| 4 · 容量与自动检查 | 三档容量数据、列表查询精简、依赖审计、CI 容量检查 | `make capacity`、`make bench load`、依赖审计 |
| 5 · 文档与兼容收尾 | 双语更新日志与升级步骤、1.0 验收边界、文档构建和无障碍 | `make check test e2e docs`、axe 全站无障碍核验 |

## 构建期一致性校验 {#checks}

每次编译文档站点前，脚本会自动将文档中的配置、接口、错误码及参数与代码进行双向断言比对；任何偏差均会立刻阻断构建。

<SyncStatus part="checks" />

## 代码与规模统计 {#size}

<SyncStatus part="stats" />

## 工具链版本锁定 {#toolchain}

工具链版本受控于 `mise.toml`、`go.mod` 与 `pnpm-workspace.yaml`：

<SyncStatus part="versions" />

## 后续演进规划 {#next}

1. **收集社区反馈**：Sani 已完成核心能力建设，后续重点进行稳定维护与体验打磨。欢迎在 [GitHub Issues](https://github.com/DejavuMoe/sani/issues) 提交建议。
2. **面向 1.0 版本定型**：冻结对外 HTTP API、环境变量规范与升级契约（数据库内部表结构仍保留迁移弹性）。发布前完成跨版本兼容测试与灾难恢复演练；演化准则参见[版本与兼容](./versioning)。

待评估功能（视复杂度而定）：

- **Markdown 内容渲染**：支持在文本分享页面安全渲染 Markdown（当前仅支持纯文本与代码）。

## 明确不做的事（Non-Goals） {#non-goals}

Sani 的核心定位是极简、自托管的个人短链接服务。以下特性会显著增加系统复杂度并偏离轻量定位，明确不在规划中：

- 多租户、用户团队划分与细粒度 RBAC 权限系统；
- 侵入式访客追踪（地理位置、设备指纹、浏览器版本、UTM 链路报表）；
- 复杂分流引擎（按地域、客户端或流量比例路由）；
- 跳转前置中间页、强制等待与广告注入；
- 开放访客上传及端到端加密分发；
- 强绑定 PostgreSQL、Redis 等重型外部中间件。
