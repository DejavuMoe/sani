# R8 — 管理入口、术语与信息排版一致性

状态：**changes-requested / 需要修改**。用户指出管理搜索与切换器高度不一致；后续修订见 `r9-handoff.md`。R7 已批准并实施；本轮新增的 R8 尚未批准或实施。

基线：`c9bc16d`。入口：[审批页](http://127.0.0.1:4311/sani/review-r8.html)、[完整原型](http://127.0.0.1:4311/sani/prototype-r8.html?scene=r8-dashboard&lang=zh&theme=light&chrome=0)。只修改 `designs/sani/`；R1–R7 文件保持原样，现有 R7 交互通过共享脚本继承。

## 事实与设计决定

| 范围 | 当前源码证据 | R8 设计决定与实施映射 |
|---|---|---|
| 标签选择器管理入口 | `web/src/components/TagPicker.svelte`, `web/src/tags.css` 的 `.tag-manage-link`：独立蓝色文字，上边框直接落在按钮上 | 分隔容器内放一行中性图标按钮。内边距 7×8、菜单外边距 6、桌面高度至少 38、窄屏 44。沿用 Sani text-2、surface-2、surface-3、radius-sm；保留可见焦点。 |
| 工具栏管理入口 | `TagFilters.svelte` 复用蓝色 `.tag-manage-link` | 复用相邻工具动作的尺寸、颜色和悬停反馈；相同 sliders 图标；桌面居右，窄屏随行排列。 |
| 完成与搜索 | `tags.css` 的 `.tag-done` 强调色；原型全局 focus-visible 与搜索组焦点重叠 | 完成用中性色；搜索保留组级焦点指示，去掉重复的输入框轮廓。实现时检查生产是否实际存在重复，避免无依据覆盖。 |
| 三类内容名称 | `i18n.svelte.ts`: `create.*`, `filter.*`, `settings.urlLength/textLength/fileLength`；`Settings.svelte` 默认值行 | 统一为链接、文本、文件 / Links, Text, Files。纯文本 / 代码是内容格式，仍保留。 |
| 共用分享地址 | `list.col.link`, `list.copyShort`, `keys.copy` 共用于三类内容 | 分享地址 / Share URL；复制分享地址 / Copy share URL。覆盖可见列头、按钮 accessible name、快捷键说明。 |
| 访问计数 | `list.col.clicks`, `sort.clicks`, `list.spark`, `detail.clicks`, `detail.chart`, `chart.table`, `settings.exportHint` | 界面统一访问 / Visits，排序为访问最多。API 字段、SQLite 字段、统计口径不变。英文单复数、图表隐藏数据表也同步。文本详情的浏览、文件详情的下载仍保留专属含义。 |
| 首次空列表、类型空态 | `list.emptyTitle/Body/Paste`, `list.noneUrl/Text/File` | 首次使用引导选择三种内容；网址粘贴说明限定在创建链接时。类型空态匹配分类名称。 |
| 域名设置 | `settings.domain/Hint/Saved`；短链接、文本和文件的分享地址使用共同 base URL | 分享域名，明确覆盖三类分享地址。关于中的文件域名仍是原始文本/文件来源，不与分享域名混同。 |
| 默认值说明 | `settings.lengthHint` 对三类内容生效，却写“已有链接不变” | 改为“已有内容不变”。默认值、输入范围、保存和环境变量锁定不变。 |
| 首次设置 | `setup.lead` 把产品描述成仅短链接服务 | 直接说明设置码与密码任务。 |
| N 快捷键说明 | `Dashboard.svelte` 与 `Creator.svelte` 的 focus 按当前创建类型聚焦 | 使用“聚焦创建区域 / Focus creation form”，不能继续描述为只新建短链接。 |
| 关于信息字体 | `Settings.svelte` 中版本和 filesUrl 有 mono，timezone 没有 | 三种机器值统一 IBM Plex Mono、13px、相同基线。生产给 timezone 增加语义 class，不照搬原型 nth-child 选择器。未启用是状态，继续正文。 |
| 长值布局 | 关于使用横向 dt/dd，原 dt 固定宽度 | grid 固定标签列 + minmax(0,1fr) 值列；标签可换行，值 overflow-wrap:anywhere。320px 下验证英文时区标签、长时区和域名。 |
| 备份说明链接 | `.backup-help a` 单独使用 accent，与导入 CSV/JSON 示例不一致 | 中性色、下划线、外部打开提示，保留 focus-visible。生产保持现有备份帮助所在位置。 |

原型复用的 R7 设置有独立备份说明节，生产 R7 则放在“数据”节内；这是已有结构差异，R8 只审批链接表现，不要求搬动生产内容。

## 语义边界

- “短链接不能指向本站另一个短链接”等 URL 专属错误、复用已有短链接的反馈继续保留；“缩短”仍准确描述 URL 操作。
- 统计统一说“访问”，不等同于独立访客。文本原始页与文件下载的计数说明继续复用 R7。
- URL 导出只包含网址链接，不能更名为“导出全部内容”。导出说明中的计数名称与列表统一。
- `Local` 保留真实配置标识，不把它猜测成具体时区。长时区场景只使用合成 fixture。
- 内容标题、文件名和标签属于用户数据；包含“短链接”的示例文章标题不做产品术语替换。

## 状态与交互合同

- 入口 idle / hover / pressed / focus-visible；有无已选标签；窄屏至少 44px 的菜单操作。
- 标签搜索、精确 Enter、全选数量、管理进入与关闭焦点返回不改变 R7 逻辑。
- 管理编辑、删除确认、错误和重试继续使用 R7；本轮不扩大功能或后端接口。
- 类型菜单展开、鼠标选择、方向键、Enter、Escape 使用现有 Menu。
- 关于：正常 Local、长时区、长域名、文件未启用；中英、明暗、桌面及 390/320px。
- 所有 mock 修改仅在内存中，刷新恢复。审批页是设计说明，产品 DOM 不添加设计 rationale。

## 验证与实施要求

本轮浏览器检查及截图见 `review-r8/`。通过实际打开菜单检查，不以闭合状态截图替代。

已操作：标签精确 Enter；Tab → 管理 → Enter → Escape → 原入口；鼠标打开管理；类型鼠标切换与 ArrowUp / Enter；中文浅色、英文暗色；390px 标签菜单；320px 类型菜单和长值。关于三项实际计算字体与字号相同，长值无重叠、无横向溢出。无新增第三方 UI 依赖。

自动检查：保存的 axe WCAG 2 A/AA、2.1 AA 与页面溢出结果；JS/JSX 语法、本地依赖、分类词汇覆盖；设计范围、来源、合同与 DOM 文案清单。

实施后需要 `make check test e2e`（WSL runner），补充语义 i18n 回归与展开菜单/窄屏检查；中英 changelog 和必要用户文档同步。原型不证明生产回归、真实 Safari/Firefox 或真机触摸键盘已经通过。

本次结果：17 个保存的浏览器状态均为 axe 0 违规、页面无横向溢出；665 个 DOM 字符串已分类。文案审计保留 24 个 dom-metadata 提示（主题、场景和条目 ID 等），无未分类或禁止来源。`node designs/sani/tools/r8-check.mjs`、design-scope、sources、draft contract 和 `git diff --check` 通过。检查工具等待字体和有限时长入场动画结束，避免用动画中间帧判定文字对比度。
