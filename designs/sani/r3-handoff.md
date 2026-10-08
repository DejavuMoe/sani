# R3：标签颜色、创建默认值与交互细节

2026-10-08。评审对象为 `prototype-r3.html`；唯一审批状态在 `_d_meta.json`。本轮只修改设计目录。生产基线为 `fc391bd` / v0.8.0。R1、R2 的已审批资产原样保留。

## 预览

从仓库根启动 `python -m http.server 4311 --bind 127.0.0.1 --directory designs`，打开：

- `/sani/prototype-r3.html?lang=zh&theme=light&chrome=0`：主界面、标签新建/编辑、图标与操作按钮。
- `?scene=r3-settings&lang=zh&theme=light&chrome=0`：创建默认值、网页信息与导入示例。
- `?scene=r3-file-retry&lang=zh&theme=light&chrome=0`：72 MB 演示文件，首次上传模拟失败，随后可重试。
- `?scene=r3-file-limit&lang=zh&theme=light&chrome=0`：文件超过配置上限。
- `?scene=r3-proxy-missing&lang=en&theme=dark&chrome=0`：未配置代理。
- `?scene=tags-edit&lang=zh&theme=light&chrome=0`：编辑已有链接的标签。

替换 `theme=dark`、`lang=en` 可检查暗色与英文；省略 `chrome=0` 显示原有场景切换器。

原型沿用内存数据，刷新即重置。上传只有进度模拟，不传文件；代理状态也是场景数据，没有连接代理。导入只模拟本目录所附原生示例，不能用它验证真实 Shlink 兼容性。真实解析、服务端持久化、安全检查及部署均在审批后的实现阶段。浏览器内的导出包含当前演示短链接，不包含分享内容。真实 CSV 不复制入仓库。

## 视觉与交互决定

保留 920px 单栏、Inter/等宽字体、暖灰背景、现有间距、轻边框与黑色主按钮。新增设置沿用原页面分组和 Switch，不增加导航层级。

1. 标签共用一个颜色编辑器：12 个低饱和预设、系统取色器、HEX/RGB/HSL 输入。接受 `#RGB`、`#RRGGBB`、`rgb(r, g, b)` 和 `hsl(h, s%, l%)`，不接受透明度、任意 CSS 表达式或命名色；保存为六位 HEX。色点使用用户颜色，标签文字保留正文色，浅色底按主题混合，不依赖颜色表达选中状态。旧五个命名色继续兼容。
2. 新建短链/分享、编辑链接都使用同一标签选择器。每个现有标签旁提供编辑入口，编辑名称与颜色；修改影响所有引用它的条目，不产生同名新标签。
3. 原截图的大蓝圈来自 `:focus-within`。减轻整框光晕，保留输入和独立控件的可见键盘焦点；文件拖入、非法输入和鼠标 hover 各有明确状态。导入区域 hover 使用暖灰。
4. 图标选择沿用现有 16px / 1.5px / 圆端点体系，参考 Tabler Outline 的语义清晰度，手绘键盘、复制、外部打开和回车。没有新增图标依赖，也没有直接复制第三方路径。复制/打开按钮使用相同尺寸与次级按钮样式。
5. 不强行让短链、文本、文件内容等高：试验会使窄屏短链输入区出现大量空白。保留自然高度及各自草稿，隐藏面板添加 inert，避免焦点落入后台面板。页宽沿用已有 `scrollbar-gutter: stable`；标签/菜单为浮层。验证横向位移与滚动条，区分合理的内容变高和意外抖动。320px 英文设置页发现原有“关于”区的文件域名撑宽网格；R3 允许该值换行并约束网格最小宽度。

## 导入范围与消融实验

生产当前在 `internal/server/api_misc.go` 使用大量字段别名，并接受 `links/shortUrls/short_urls/data/items/urls` 等包装结构。审批后改为两条明确格式路径：

- Sani：原生 CSV 的 `slug,url` 标识和现有导出列；JSON 的 `app: "sani"`, `version: 1`, `links`。额外列可忽略，不靠模糊别名识别其他产品。
- Shlink：CSV 由 `shortCode,longUrl,shortUrl,domain` 标识，保留 v0.8.0 的 `tags` 管道分隔解析；JSON 保留 `shortUrls.data`、`visitsSummary.total`、`meta.validUntil/maxVisits` 等真实字段。已存在的 Shlink 标准变体先用上游/本地夹具确认，再确定白名单。
- 移除 Sink、YOURLS、Kutt 专属别名/任意包装结构/通用产品兼容承诺；不修改两类格式共同需要的 URL、日期、标签、短码冲突校验。与 Sani 列结构相同的 CSV 可以作为 Sani 格式导入，不可能也不需要辨别哪个软件生成了这些相同字节。

对照组：Sani CSV/JSON、Shlink CSV/JSON 的导入结果在删减前后完全相同。消融组：仅其他产品专属字段/包装的样本应在解析阶段拒绝，数据库记录/标签/计数均不变。补充损坏格式、重复导入、CSV 引号/逗号/换行/BOM、过期时间、非默认域名等边界。不能只删除 UI 文案。

用户先前的 CSV 必须在隔离临时数据库原样再验：82 条记录、10 个标签、38,234 次历史访问；重复导入不改变结果，不请求这些目标网址，不触碰 VPS 数据。这些数字是之前 v0.8.0 验证基线，本轮尚未重新执行该导入。

可下载范例：`src/r3/examples/sani.csv`、`src/r3/examples/sani.json`。使用 example.com、原生字段和旧版也识别的 `blue` 标签色。审批后放入公开文档/下载资源；中英文说明逐一对应代码。

## 文件大小与分片决定

Cloudflare Free/Pro 的单次请求上限为 100 MB；zone 设置还可以调低。官方建议之一就是拆成更小请求。[Cloudflare 413 文档](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/)

建议实现：默认完整文件上限 **99,000,000 bytes**；后台可设置 1–4096 MB。**超过 25,000,000 bytes 自动分片，每片至多 25,000,000 bytes，串行上传**。小文件继续现有单请求接口。需要更大的文件时先提高应用总上限；分片不自动越过总上限。25 MB 是本项目选择的折中值，不是 Cloudflare 规定的推荐值。

`multipart/form-data` 在一个请求内包含多部分，或 HTTP chunked transfer 都仍然是一个请求，不能解决这个上限。应采用应用层会话：建立上传 → 多次独立请求写入偏移 → 校验完成 → 原子发布分享。无需引入 S3、多节点协调或并行上传 SDK。

实现约束：每次请求鉴权和同源检查；会话归属、随机 ID、总大小/临时空间上限、偏移和重复分片校验；流式落盘；仅完整成功后创建可见分享；失败保留已完成片并允许当前页面重试；取消和过期会话清理；进程重启后的残片有明确回收规则。浏览器刷新后续传不在首版范围。代理/API 路由不缓存；Nginx 单请求上限留足 25 MB 分片/小文件表单开销，并验证慢上传超时。真实 Cloudflare 链路需要独立端到端验证，原型不能证明它已经可用。

现有 `SANI_MAX_FILE_MB` 在代码里使用 `<<20`，实际是 MiB：99 MiB = 103,809,024 bytes。实现时不能偷偷改变用户已显式设置的环境变量含义。建议保持现有环境变量的 MiB 兼容语义；未显式配置时的新默认与后台输入使用十进制 MB，并在配置/API 文档明确有效值与来源。显式环境变量作为上限约束，后台不能突破；原型 `r3-env-locked` 展示环境变量约束时的只读状态；实现时按每个字段的实际来源分别锁定。

## 网页信息与隐私代理

当前 `internal/meta/meta.go` 已使用 Go `ProxyFromEnvironment`，但 HTTP_PROXY/HTTPS_PROXY/NO_PROXY 组合可能使部分流量直连，因此不能把它描述成“强制隐藏源站 IP”。[Go Transport](https://pkg.go.dev/net/http#Transport)

建议新增专用 `SANI_META_PROXY`，支持 `http://`、`https://`、`socks5://`，可有/无用户名密码。代理凭据只在服务器配置，后台显示是否已配置；不返回完整地址或密码。配置专用代理后默认用代理，代理连接失败不回退直连，不能被 NO_PROXY 意外绕开。无专用代理时保持现有部署兼容；后台选择关闭/直接连接/使用代理时明确显示有效行为。

- “关闭”阻止标题和图标的外部抓取，不阻止用户手动填写标题；已有本地缓存不需要联网。
- HTTPS 代理为客户端到代理的一跳提供 TLS。普通 HTTP/SOCKS5 自身不加密这一跳；用户名密码是认证，不等于加密。HTTPS 目标的 TLS 是另一层，不能混为一谈。
- 目标站看到代理出口，代理运营方仍可能看到目标和访问元数据；此功能不承诺匿名。
- 保留现有目标协议/内网地址/重定向/大小/超时限制。代理地址可以是管理员配置的内网端点，但这不授权目标任意访问内网。专用强制模式应固定经验证的公网目标地址，在代理 CONNECT/SOCKS5 连接时使用该地址并保留目标 TLS SNI，避免远端重新解析绕过 SSRF 校验；该部分必须做真实 HTTP/HTTPS/SOCKS5 代理夹具测试和独立安全复核。若要远端 DNS 隐私，应先明确受信代理的解析边界，不能直接放宽现有校验。

DuckDuckGo 的 `r.duckduckgo.com` 是避免搜索词出现在 Referrer 的跳转服务，不是网页内容/标题抓取代理。未找到适合本功能的公开通用中继 API，本方案不依赖它。[DuckDuckGo 官方说明](https://duckduckgo.com/duckduckgo-help-pages/results/rduckduckgocom)

## 默认短码与兼容性

后台提供长度 3–32（默认 5）和排除易混淆字符（默认开启）；开启继续使用现有 `23456789abcdefghjkmnpqrstuvwxyz`，关闭使用小写字母和数字。只影响之后自动生成的 URL 短链；已有、手动输入、导入的短码保持原样。分享自动 ID 仍至少 10 位，不因短链设置降为 3 位。服务端继续使用加密随机数和碰撞重试。

设置持久化复用现有 store settings，不发明第二份配置存储。明确 defaults → persisted settings → explicit environment 的优先级；API 返回有效值/来源，必要时禁用后台覆盖。旧名称标签、导出格式、分享隔离域、现有 API 和部署契约不得因视觉改动破坏。

## 审批后的实施范围和验收

| 范围 | 代码/文档入口 | 验收 |
|---|---|---|
| 颜色 | `web/src/lib/tags.ts`, TagPicker/TagBadge/TagFilters, `web/src/tags.css`, `internal/store/tags.go`, `api_tags.go` | 三格式边界、旧色兼容、导出/导入、创建/编辑共享、两主题对比度 |
| 导入收敛 | `internal/server/api_misc.go`, import/tag tests, Settings/i18n, 中英文 usage/API/README | 上述保留/消融矩阵、真实 CSV 隔离导入、失败不写入 |
| 默认值 | `internal/links`, config/store/API, Settings/Composer/share, CLI/配置文档 | 持久化、来源优先级、非法值、分享最短长度、旧短码不变 |
| 代理 | `internal/meta`, cmd/config, compose/env 示例, 配置/部署文档 | 有无认证、TLS、SSRF/重定向、代理失败零直连、秘密不回显 |
| 分片 | ShareComposer/api client、server upload/store 生命周期、API/部署文档 | 边界/重试/重复片/取消/过期/磁盘不足/重启残片/完成原子性/额度 |
| 视觉 | Icon/Button/Creator/Composer/ShareComposer/TagPicker/Menu/Dialog | 桌面/390/320、中英文/深浅色、键盘/触屏、横向几何、焦点和 a11y |

实现完成后必须运行 WSL `make check test e2e smoke docs bench`，仅在 redirect/cache/clicks 变更时需要额外前后性能对照。发布版本需另行确定，本轮不创建 tag、不发布、不部署。先提交设计审批，再做实施和中英文 changelog/文档同步。
