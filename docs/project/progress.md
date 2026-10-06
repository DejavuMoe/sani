<script setup>
import { data as status } from '../.vitepress/data/status.data'
</script>

# 进度

<p class="lead">本文档对应 {{ status.latestVersion }}，各版本变化见更新日志。这一页说明已实现的能力、验证入口和仍需完成的工作。</p>

## 现状 {#current}

| 部分 | 状态 | 包括 |
|---|---|---|
| 跳转与统计 | <span class="sn-status done">已完成</span> | 内存缓存、点击聚合、爬虫和预览过滤、有效期、访问上限 |
| 管理界面 | <span class="sn-status done">已完成</span> | 中英文、深浅主题、键盘操作、批量操作、二维码、书签小工具、手机分享菜单 |
| 文本和文件 | <span class="sn-status done">已完成</span> | `/p/` 下的纯文本和代码，从单独域名下载的文件，v0.3.0 起 |
| HTTP API | <span class="sn-status done">已完成</span> | 全部功能都有接口，API 令牌 |
| 导入与导出 | <span class="sn-status done">已完成</span> | Sani、Shlink、Sink 和各种 CSV |
| 部署 | <span class="sn-status done">已完成</span> | 基于 `scratch` 的 Docker 镜像，systemd、Caddy 和 nginx 示例 |
| 运维 | <span class="sn-status done">已完成</span> | 在线数据库备份、停机后的数据库与文件配套备份、重设密码、健康检查 |
| 文档 | <span class="sn-status done">已完成</span> | 本站：中英双语，构建时与源码核对 |
| 发布 | <span class="sn-status done">已完成</span> | 打标签即发布：GHCR 上的多平台镜像，Linux、macOS、Windows 和 FreeBSD 的二进制文件，附校验和与构建来源证明 |
| 持续集成 | <span class="sn-status done">已完成</span> | 每次提交都运行检查和测试（Linux、macOS、Windows）、端到端测试、axe 检查、漏洞扫描，并试构建镜像和全部二进制文件 |
| 文档站上线 | <span class="sn-status done">已完成</span> | 中英文文档已上线：[sani.zsh.moe](https://sani.zsh.moe) |

## v0.4.0 实施与验证 {#acceptance}

以下五批实现纳入 v0.4.0，验证入口如下；远程检查结果见 [CI](https://github.com/DejavuMoe/sani/actions/workflows/ci.yml) 与 [CodeQL](https://github.com/DejavuMoe/sani/actions/workflows/codeql.yml)。

| 批次 | 实现内容 | 验收入口 |
|---|---|---|
| 1 · 计数正确性 | Range 与条件响应、共享额度、不可重用 ID、刷盘一致性 | `counting_test.go`、迁移与并发测试 |
| 2 · 备份与文档 | 配套停机备份、恢复与哈希校验、统计和持久性口径、统一版本 | `TestStoppedBackup`、文档语义核对 |
| 3 · 故障恢复 | 重试来源上限、外部锁等待上限 1 秒、停机与最终刷盘失败 | Go 竞态测试、锁与停机回归 |
| 4 · 容量与自动检查 | 三档容量数据、列表查询精简、依赖审计、CI 容量检查 | `make capacity`、`make bench load`、依赖审计 |
| 5 · 文档与兼容收尾 | 双语更新日志与升级步骤、1.0 验收边界、文档构建和无障碍 | `make check test e2e docs`、两站 axe |

## 构建时核对 {#checks}

每次构建文档之前，都会把文档与源码逐项比对，任何一项对不上，构建就会失败。所以你在这里看到的，就是这一版文档实际通过的检查。

<SyncStatus part="checks" />

## 项目规模 {#size}

<SyncStatus part="stats" />

## 工具链 {#toolchain}

版本固定在 `mise.toml`、`go.mod` 和 `pnpm-workspace.yaml` 中：

<SyncStatus part="versions" />

## 接下来 {#next}

1. **听取反馈**：Sani 已经公开发布，接下来以修复问题、打磨细节为主。有问题欢迎在 [GitHub](https://github.com/DejavuMoe/sani/issues) 上反馈。
2. **为 1.0 定型**：稳定对外 API、配置和升级路径，数据库内部结构仍可迁移。发布前完成兼容清单和恢复演练；具体边界见[版本与兼容](./versioning)。

还在考虑、没有决定的功能：

- **按标签整理链接**：链接多了之后方便分组查找，但要找到不增加复杂度的做法。
- **Markdown**：把用 Markdown 写的文本渲染成排版后的样子；目前只有纯文本和代码两种格式。

## 不做什么 {#non-goals}

Sani 的定位是一个人用的、简单的短链接服务。下面这些功能会让它变成另一种东西，所以不在计划里：

- 多用户、团队和权限管理；
- 访客追踪：地理位置、设备、浏览器、UTM 汇总；
- 按设备、地区或比例把访问者分流到不同的地址；
- 跳转前的中间页和广告；
- 访问者上传，以及分享内容的端到端加密；
- 依赖 PostgreSQL、Redis 这类外部服务。
