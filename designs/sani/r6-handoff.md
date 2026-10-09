# R6：按类型配置短码长度与稳定的文本预览

2026-10-09。根据用户要求，先迭代原型。R6 基于已批准的 R5，状态为 needs-review；R1–R5 文件保持原样。本轮不实施产品代码，也不更改线上配置。

入口：[创建默认值](http://127.0.0.1:4311/sani/prototype-r6.html?scene=r6-settings&lang=zh&theme=light&chrome=0&focus=defaults)、[文本详情](http://127.0.0.1:4311/sani/prototype-r6.html?scene=r6-text&lang=zh&theme=light&chrome=0)、[代码详情](http://127.0.0.1:4311/sani/prototype-r6.html?scene=r6-code&lang=zh&theme=dark&chrome=0)。移除 `chrome=0` 可使用场景切换面板。

## 已确认的抖动原因

- 现有后台打开文本分享详情后，切换统计范围即可复现：正文临时变成“加载中…”，预览高度从约 90.78px 降至 47.59px，然后恢复。观测仅读取 DOM 几何与内容长度；没有保存真实分享正文或更改业务数据，检查后恢复了原来的 30 天范围。
- `web/src/components/LinkDetail.svelte` 的统计加载调用 `links.upsert({ ...s.link, spark: undefined })`。正文 `$effect` 直接读取 `link.kind`、`link.updatedAt`；链接对象被替换，即使正文版本没有变化，也会使这个 effect 重新运行，并执行 `body = null`。
- `web/src/lib/links.svelte.ts` 的列表刷新同样替换对象；`Dashboard.svelte` 的定时刷新与重新可见也会走这条路径。代码分享与普通文本使用同一个详情组件。
- 原型只演示修复后的交互：正文加载按链接 ID 和内容版本触发，切换统计范围不清空正文；更新同一文本时保留已加载内容，首次加载及失败有明确状态，失败可以重试。生产修复应将 effect 依赖收敛为稳定的基本值，并保留失效请求保护，不能只用固定高度掩盖反复请求。

## 独立长度配置

| 配置 | 新安装默认值 | 范围 | 示例 |
|---|---:|---|---|
| 普通网址 | 5 | 3–32 整数 | `/k7mx9` |
| 文本 / 代码分享 | 10 | 3–32 整数 | `/p/k7mx9p4w2r` |
| 文件分享 | 10 | 3–32 整数 | `/p/k7mx9p4w2r` |

每项有独立的输入、默认值、实时示例、校验和环境锁定状态。分享可设置为 5 位，不再隐藏地执行 `max(10, slugLength)`；低于 10 位时显示简短的可猜测性说明，仍允许保存。长度不包含 `/p/`，已有链接及手动短码不变。

“排除易混淆字符”仍只控制网址短码；文本与文件保留现有的无歧义字符集，并在设置页直接说明。共享一个保存操作，提供忙碌、成功、失败、重试状态；窄屏输入框高度 44px，不使用浏览器默认数字旋钮或校验弹窗。

原型内保存会影响后续创建：已验证网址 32 位、文本 5 位、文件 12 位。数据只存在当前页面内存中，刷新恢复示例。文件场景的上传过程也是模拟，不向服务端上传文件。

## 待实施范围

- 配置建议保留 `slugLength` 表示网址，新增 `textSlugLength`、`fileSlugLength`；对应 GET/PATCH、`configSources`、持久化、重启读取和各自环境优先级都需同步。当前接口尚未支持新增字段。
- 升级应保留既有行为：没有独立分享设置的旧实例，先按旧逻辑计算分享的有效长度 `max(10, legacySlugLength)` 作为迁移值；新增独立设置后不再跟随网址长度。不能把原先使用更长分享短码的实例静默降回 10 位。
- 后端涉及 `internal/server/settings.go`、`api_misc.go`、`api_links.go`、`share.go`，以及 `internal/config` 和命令入口的环境配置。普通上传、分片上传完成、API 创建和导入必须按各自现有语义检查；生成重试与碰撞扩长规则保留。
- 前端涉及 `web/src/views/Settings.svelte`、`web/src/lib/api.ts`、双语 i18n 与 `LinkDetail.svelte`。测试需要覆盖每类长度、边界、环境锁定、持久化、旧实例迁移，以及统计/列表刷新时不重新请求正文、不清空预览、不丢失滚动位置，编辑后仍能刷新正文。
- 双语配置/API/使用文档、README 配置表和 Unreleased changelog 随实施更新。原型不修改这些生产行为说明。

## 原型验证

- 通过 Codex 浏览器运行交互及 DOM 检查，证据 `results.json` 包含 45 项通过记录：独立配置、空值/小数/越界、键盘保存/切换、保存失败与重试、单项环境锁定、三类生成、正文加载失败重试、统计切换保留正文及代码滚动位置、32 位示例的窄屏换行。
- 设置页中英文 × 明暗主题 × 1280/390/320px，12 组 axe WCAG A/AA 检查无违规，未发现页面横向溢出。文本与代码详情各检查 1280px 中文浅色、390px 英文暗色、320px 中文浅色，共 6 组无违规。
- 人工查看了桌面设置、英文暗色窄屏、桌面文本与代码、窄屏代码截图。临时视口已恢复。控制台没有应用错误；沿用原型的 Babel 浏览器转译提示仍存在。
- `linux-task.ps1 -Mode build -Project 'D:\Forgejo\sani' -Command 'make check test'` 成功：Svelte 0 错误/警告、文档同步与类型检查、Go race 测试（缓存命中）、52 项前端单元测试通过。这是现有产品基线检查，不代表新增配置或预览修复已进入产品。
- 原始 DOM 采集、截图、交互结果在本机本轮 visualizations 的 `sani-r6/` 目录。QA 使用单独的 localhost 服务临时加载仓库已有 axe 与 DOM collector；交付的原型不加载 QA 脚本。

本轮没有运行生产 E2E、没有提交、发布或部署；没有验证 Firefox/WebKit。原型修复不等于线上抖动已经消失，实施须在本版本审阅后进行。
