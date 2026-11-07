<script setup>
import { data as status } from '../.vitepress/data/status.data'
</script>

# 项目状态

<p class="lead">最近发布版本为 {{ status.latestVersion }}。Sani 已进入 1.x 稳定维护阶段，本页说明已有能力、适用范围与后续计划；各版本变更见<a href="./changelog">更新日志</a>。</p>

## 功能现状 {#current}

| 核心模块 | 交付状态 | 覆盖特性 |
|---|---|---|
| 跳转与统计 | <span class="sn-status done">已完成</span> | 内存分片缓存、点击批量聚合、爬虫与预取过滤、有效期、访问配额 |
| 管理界面 | <span class="sn-status done">已完成</span> | 中英双语、深浅主题、键盘快捷键、批量操作、二维码、书签小脚本、PWA 分享菜单 |
| 标签管理 | <span class="sn-status done">已完成</span> | 短链接、文本与文件的彩色标签，创建与编辑时分配，按标签或未标记筛选，JSON/CSV 迁移（v0.5.0 起） |
| 文本与文件分享 | <span class="sn-status done">已完成</span> | `/p/` 路由下的纯文本与代码展示、独立文件域名安全下载（v0.3.0 起） |
| 访问密码 | <span class="sn-status done">已完成</span> | 链接、文本与文件的密码保护，访客验证、错误限流及密码导入导出（v1.0.0 起） |
| HTTP API | <span class="sn-status done">已完成</span> | 核心能力全量覆盖、API 令牌长效认证 |
| 导入与导出 | <span class="sn-status done">已完成</span> | 导入 Sani、Shlink CSV/JSON；导出网址链接为 Sani JSON 或 CSV |
| 部署生态 | <span class="sn-status done">已完成</span> | 基于 `scratch` 的极简 Docker 镜像，systemd、Caddy 与 nginx 生产配置 |
| 系统运维 | <span class="sn-status done">已完成</span> | 在线数据库快照、停机冷备及文件配套恢复、密码重置、健康度探针 |
| 双语文档 | <span class="sn-status done">已完成</span> | 中英双语站点，构建期核对配置、接口等已纳入检查的源码规则 |
| 发布流水线 | <span class="sn-status done">已完成</span> | Tag 触发自动发布：GHCR 多平台镜像，多操作系统与架构二进制，附校验和与构建来源 Attestation |
| 持续集成（CI） | <span class="sn-status done">已完成</span> | Linux/macOS/Windows Go 测试、全部发布平台交叉编译、E2E、axe 无障碍核查和已知漏洞扫描 |
| 线上文档站点 | <span class="sn-status done">已完成</span> | 官方中英双语文档已部署：[sani.zsh.moe](https://sani.zsh.moe) |

## 适用范围 {#production}

Sani 面向**单管理员、单个服务进程、本地持久化数据目录**的自托管部署。前置代理负责 HTTPS，文件分享使用独立主机名；备份、磁盘余量、日志监控和升级恢复由部署者负责。多个进程共享数据库时，内存缓存与访问额度不会同步，因此不支持通过多副本实现高可用。短码是分享地址，不是访客身份认证；点击统计也不承诺断电时零丢失。

部署后请按[运维](../guide/operations)验证 HTTPS、反代信任、两个域名、卷权限、备份恢复和监控。`/healthz` 是存活探针，不代表数据库可写或完整功能健康。v1.0.0 起执行[1.x 兼容承诺](./versioning#stable)。

## 构建期一致性校验 {#checks}

每次编译文档站点前，脚本会核对已纳入规则的配置、接口、错误码及参数；发现偏差时会阻断构建。其余说明文字仍需人工核对。

<SyncStatus part="checks" />

## 代码与规模统计 {#size}

<SyncStatus part="stats" />

## 工具链版本锁定 {#toolchain}

工具链版本受控于 `mise.toml`、`go.mod` 与 `pnpm-workspace.yaml`：

<SyncStatus part="versions" />

## 后续演进规划 {#next}

1. **收集社区反馈**：Sani 已完成核心能力建设，后续重点进行稳定维护与体验打磨。欢迎在 [GitHub Issues](https://github.com/DejavuMoe/sani/issues) 提交建议。
2. **维护 1.x 兼容性**：后续发布保持已文档化的 HTTP API、环境变量与升级契约兼容；数据库内部表结构可通过迁移演进。不兼容变更按[版本与兼容](./versioning)安排主版本升级。

待评估功能（视复杂度而定）：

- **Markdown 内容渲染**：支持在文本分享页面安全渲染 Markdown（当前仅支持纯文本与代码）。

## 明确不做的事（Non-Goals） {#non-goals}

Sani 的核心定位是轻量、面向个人的自托管短链接服务。以下特性会显著增加系统复杂度并偏离轻量定位，明确不属于项目设计目标：

- 多租户、用户团队划分与细粒度 RBAC 权限系统；
- 侵入式访客追踪（地理位置、设备指纹、浏览器版本、UTM 链路报表）；
- 复杂分流引擎（按地域、客户端或流量比例路由）；
- 跳转前置中间页、强制等待与广告注入；
- 开放访客上传及端到端加密分发；
- 强绑定 PostgreSQL、Redis 等重型外部中间件。
