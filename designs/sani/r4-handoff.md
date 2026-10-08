# R4：后台连接配置与自绘控件

> 后续评审要求修改控件对齐和布局，并移除 Jina。R4 保留为历史记录，不用于实施；最新提案见 [R5](r5-handoff.md)。

2026-10-09。基线为 v0.9.0 / `e58de510923155978820a3cb8580836acc58d0d5`。评审入口 `prototype-r4.html`，状态以 `_d_meta.json` 为准。R1–R3 及其审批记录原样保留。本轮没有修改生产应用、发布流程或线上实例。

## 文档站版本调查

只读核对结果：

- GitHub `master`：`e58de510923155978820a3cb8580836acc58d0d5`（v0.9.0）。
- Forgejo `origin/master`：`fc391bd1d996b18f2ecf7ad792555786d3b44446`（v0.8.0），通过 `git ls-remote origin refs/heads/master` 读取。
- `.woodpecker/docs.yml` 仅在 `master` 的 push 事件构建并发布文档，发布目录为 `/var/www/sani.zsh.moe`。GitHub 的 CI Docs job 运行构建及检查，没有调用生产发布步骤。
- `docs/.vitepress/config.ts` 从 `latestVersion()` 取导航版本；该函数读取中文 changelog 的第一个版本标题。当前源码为 v0.9.0，没有残留硬编码 v0.8.0 导航。
- 公网 `https://sani.zsh.moe/project/changelog?check=20261009-r4` 返回 HTTP 200、`CF-Cache-Status: DYNAMIC`，无 Age，Last-Modified 为 `Thu, 08 Oct 2026 14:45:30 GMT`。返回 HTML 有 v0.8.0，没有 v0.9.0。

结论：文档部署源尚未同步 v0.9.0，GitHub 发布成功没有推动 Forgejo 的文档部署链路；当前响应不支持“Cloudflare 缓存旧版”的解释。未读取 Woodpecker 运行日志或源站当前软链接，不能声称它们已验证。

后续纠正应把已验证的 v0.9.0 提交快进同步至 Forgejo master，检查 Woodpecker 的 build-docs / publish-docs，再验证中英文公网导航、changelog、配置及部署页。无需重打 v0.9.0 标签，也不应为此关闭全站缓存。本轮请求是调查和原型，没有推送或触发生产部署。

## 评审入口

从仓库根运行：

```powershell
python -m http.server 4311 --bind 127.0.0.1 --directory designs
```

打开 `http://127.0.0.1:4311/sani/prototype-r4.html?scene=r4-settings&lang=zh&theme=light&chrome=0`。

场景可替换为 `r4-relay`、`r4-socks`、`r4-empty`、`r4-retry`、`r4-off`、`r4-direct`、`r4-env-locked`。`lang=en` 和 `theme=dark` 切换语言与主题。去掉 `chrome=0` 可打开自绘 Tweaks 菜单切换场景。返回主界面后，可打开标签编辑器及有效期 → 自定义，检查颜色滑条和日期面板。

原型为内存演示，刷新恢复夹具，不持久化密钥、不连接代理、不导入真实数据。测试按钮模拟 900 ms 等待；`r4-retry` 第一次失败、重试成功。界面里的成功状态不代表真实代理测试。公开中继的可行性另行以 example.com 做过一次只读 API 请求。

## 连接方式

沿用设置页面的 920px 单栏、分组、浅边框、暖灰背景与已有 Menu / Segmented / Switch 组件，不引入 UI 库。

1. **自动获取网页信息**：独立开关；关闭后不发起新的标题或图标抓取，仍可手动输入标题。
2. **连接方式**：自绘菜单，直接连接 / 中继或代理。保留已有直连部署的行为，不替用户启用第三方服务。
3. **中继或代理内部三选一**：中继、HTTP(S)、SOCKS5 为同一单选组，同一时刻只使用一种。切换时保留未保存表单草稿；只有保存才改变生效配置。
4. **HTTP(S)**：主机、端口、“加密连接到代理（HTTPS）”开关及可选用户名密码；关闭认证即免密码。HTTPS 必须校验代理证书，不提供忽略证书错误选项。
5. **SOCKS5**：主机、端口及可选认证。明确 SOCKS5 本身不加密到代理这一跳；用户名密码不等于加密。
6. **中继**：提议首版只接一个已核实的 Jina Reader，获取标题；API key 可选。图标保持本地字母回退，不另接 DuckDuckGo、Google 或目标站图标接口。这样不会为了图标而静默直连，也不会把同一网址额外发给另一个服务商。
7. **测试与保存独立**：测试当前草稿，成功/失败不自动保存；保存不依赖第三方当时在线。空主机、非法端口或不完整认证显示行内错误。连接失败永不自动回退直连。
8. **凭据**：只显示已保存状态，支持替换、取消替换、移除；空替换保留旧值；新输入可显隐。移除是草稿操作，保存后才生效。后台不得取回已保存的完整密码/API key。

现有显式环境变量优先级保持，受环境变量锁定时展示有效设置和锁定原因。未设置专用环境变量的部署应完全通过后台完成。现有 HTTP_PROXY/HTTPS_PROXY 环境模式需要在迁移中保留真实来源，不能错误显示为纯直连；应增加对应只读来源夹具，不能猜测 NO_PROXY 的实际路由。

## 中继事实与隐私边界

- DuckDuckGo 官方说明，`r.duckduckgo.com` 用于搜索结果跳转时保护 referrer，不是通用网页内容中继：[官方说明](https://duckduckgo.com/duckduckgo-help-pages/results/rduckduckgocom)。
- DuckDuckGo 确有代取网站图标的功能，但不提供这里需要的网页标题抓取：[图标说明](https://duckduckgo.com/duckduckgo-help-pages/privacy/favicons)。不把“能代理图标”扩展成“能代理完整网页”。
- Jina Reader 官方文档提供 URL 读取、JSON title/url/content、可选认证及 DNT 请求选项：[Reader API](https://jina.ai/reader/)。本轮向 `https://r.jina.ai/https://example.com` 发起一次 `Accept: application/json`、`DNT: 1` 请求，观察到 HTTP 200 和 title 字段；没有发送用户真实链接或凭据。
- 中继会收到完整目标 URL 及调用方网络信息。不能把它称为匿名服务，也不能以发送 DNT 请求头承诺第三方一定不记录。受访问策略、额度、费用与服务可用性影响；不把一次成功写成 SLA。
- 未来实现固定官方 HTTPS 中继端点，拒绝任意端点拼接；限制目标协议/公网地址、响应体、耗时、重定向、并发与测试频率；只解析 title 为纯文本，不渲染返回 HTML。中继响应中的 URL、图标、资源地址都不能触发额外直连。目标网址含敏感查询参数时，中继仍会收到它们；必须由用户主动选择此模式。

## 自绘控件与生产排查清单

“任何可见应用控件和展开状态不得使用浏览器默认样式”已写入 `AGENTS.md` 与 `constraints.md`。该规则不等于禁用语义 HTML；系统文件选择器和权限框不属于应用可绘制区域，应用入口仍需自绘。

| 现有入口 | 观察到的问题 | R4 或实施要求 |
|---|---|---|
| Settings `metadata-mode` | 原生 select 展开后是系统面板 | R4 用 Menu，三种代理方式用 Segmented；键盘选项、Escape 回焦与移动端一起验收 |
| ColorEditor | 原生 color 打开系统取色器 | R4 保留 12 预设及 HEX/RGB/HSL，使用自绘 RGB 滑条和颜色预览 |
| ExpiryPicker | datetime-local 打开系统日历 | R4 应用内月历与日期/时间文本输入，严格格式/未来时间校验，保留快捷有效期 |
| 默认长度、文件上限等数字字段 | 系统数字步进箭头 | R4 统一抑制默认箭头；实施时覆盖所有数字字段及溢出/范围校验 |
| AppHeader 与列表/标签/分享按钮 | 原生 title tooltip | R4 顶栏示范应用 tooltip（hover/focus、Escape、可悬停）；实施时复用至截断标签、计数、SHA256 与其他入口，信息不能简单删除 |
| 登录、域名等表单 | required/type 可能触发浏览器校验气泡 | 实施时逐个检查并改为现有行内错误和 aria-describedby，保持服务端校验 |

R4 复用旧版完整工作台作为上下文；除本轮改动的设置、颜色、有效期和顶栏外，旧列表上的 title tooltip 等仍属于实施清单，不应因出现在原型中再次视为获准保留。不能仅验证本次新增表单，就宣称全产品已消除原生样式。

日期面板采用自然展开高度；选项菜单为浮层。代理方式面板有最小高度减少短内容切换跳动，认证字段出现仍自然增高；不固定整个页面高度。全局 scrollbar-gutter 保持，验证横向几何不变。

## 审批后的实施边界

- `Settings.svelte` / i18n / api types：在后台编辑连接配置，写入与读取明确区分，凭据只写及状态只读；复用现有配置优先级，不将环境凭据回填浏览器。
- `internal/server/settings.go` / store：复用持久设置，原子保存活动方式，重新启动后恢复；无效更新不覆盖现有配置。输入校验、同源防护、鉴权、响应 no-store 与日志脱敏覆盖连接测试接口；测试只使用固定公开目标并有频率/并发限制。
- `internal/meta`：保留 HTTP/HTTPS/SOCKS5 已有 SSRF、DNS 固定与 TLS SNI 检查，配置更新安全替换客户端；失败不直连。Jina 作为独立受限标题来源，不能把远端解析能力当成对现有安全边界的放宽授权。
- 凭据持久化沿用实例受限数据存储；不得宣称当前 SQLite 或备份天然加密。访问数据目录/备份的人可能取得配置中的凭据，日志/API 不能输出它们。
- 自绘控件在创建、编辑、设置等所有调用处统一替换；补充截图展开状态、中英文明暗主题、桌面/触屏、键盘、axe 与实际浏览器验收。
- API、配置、迁移与中英文文档跟随最终实现同步；新增能力尚未实现前，不写进当前版本的功能承诺。
- 应用发布、Forgejo 文档发布、CDN 公网内容分别验证。已发布 v0.9.0 标签保持不动。

## 验证记录

- 通过 `linux-task.ps1 -Mode build` 在 Debian 的项目镜像运行本轮临时 Playwright 脚本，Chromium **52 个场景通过**；最后修正窄屏标签浮层与日期网格后，**16 个相关场景重验通过**。脚本、截图和结果 JSON 保留在本次会话的本地产物目录，没有加入生产测试集合。
- 设置区域覆盖中英文 × 明暗主题 × 1280/390/320 宽度；真实操作下拉展开/关闭、Escape 回焦、Home/End/方向键选择、三种方式互斥与横向几何。其他场景覆盖空字段、端口校验、凭据保存/替换/移除、首次连接失败和重试、关闭/直连/环境变量锁定。没有浏览器运行错误；受检区域 axe 无违规。Babel 的开发模式提示是原型依赖已知提醒，不会进入产品。
- 颜色和日期在中英文 390px 进行操作验证：HSL 输入后 RGB 滑条正确更新，搜索文本不被改写；日历与文本字段位于面板内，非法时间阻止应用。顶部自绘 tooltip 经键盘聚焦显示、Escape 关闭。用 Codex 内置浏览器另行检查了设置下拉的实际展开截图和标签面板。
- 渲染 DOM 收集得到 R4 **651 个唯一字符串**并逐项归类；合并历史后内容检查通过（1208 个条目）。26 个提示是保留的 DOM 数字/场景标识，已按用途核对，不是用户可见设计说明。
- `validate_workflow.py contract`、`sources`、`design-scope --allow-agents` 与 `git diff --check` 通过。通用 `structure` 检查硬编码要求 `docs/product/constraints.md`，本仓库既有约束位于 `designs/sani/constraints.md`；人工确认映射及全部必需记录存在，没有为通过模板检查复制一份约束或改动技能。
- 未运行生产 `make check test e2e`：本轮没有修改应用代码。未验证 Firefox/WebKit、真实移动设备、真实代理认证、配置持久化、中继端到端集成或线上文档发布；这些是审批后实现的验收项目。
