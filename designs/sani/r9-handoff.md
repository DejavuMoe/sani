# R9 — 成组控件几何与视觉一致性

状态：approved，用户于 2026-10-10 批准 R9 并授权实施、推送 master 和按规范发布 v0.9.4。R8 因控件高度漏检标记为 changes-requested。R1–R7 批准历史保留。

基线：`c2c4f2b`。入口：[审批页](http://127.0.0.1:4311/sani/review-r9.html)、[管理标签原型](http://127.0.0.1:4311/sani/prototype-r9.html?scene=r7-tags&lang=zh&theme=light&chrome=0)。继承 R8 功能、术语和字体修订；新增共享 CSS，不增加功能或依赖。

## 根因与规则

R8 管理搜索输入的 19.5px 行高、上下各 8px padding 和 2px 边框将外框撑到 37.5px；旁边 Segmented sm 的内部按钮 24px，加 4px 容器 padding，外框只有 28px。align-items:center 只会居中，不保证同高。列表搜索也曾是 34px，而筛选按钮为 32px；文本创建行的选项为 28px，分享按钮为 34px。历史响应式规则分别写 44、36、28，后载入的规则覆盖了触控尺寸。

R9 用外框尺寸建立三种场景：紧凑工具栏 32px，标准表单 36px，菜单操作行至少 38px；<=640px 或 pointer:coarse 时，这些组统一为 44px。Segmented 外框跟随所属组，内部按钮始终扣除上下共 4px padding。搜索输入去除撑高的纵向 padding。外框圆角 8px、内层和菜单行 6px；搜索和同组切换标签 13px，窄屏输入 16px，避免输入自动缩放。

多行正文、主网址输入、开关、被动状态标签及日历网格各有语义，保留原形态。被动标签不能决定菜单行高；可移除的已选标签则与旁边添加按钮等高。日期保留既有内联编辑方式，展开时创建行顶部对齐，不让其他选项停在日历中间。

## 实施映射

| 场景 | 原型规则 | 生产落点 |
|---|---|---|
| 标签管理搜索 / 范围切换 | 标准表单外框；选择按钮扣除容器 padding | TagManager.svelte、Segmented.svelte、tags.css |
| 标签选择 / 已选 / 管理 / 完成 | 菜单行与触发动作分档，已选标签和添加等高 | TagPicker.svelte、TagFilters.svelte、tags.css |
| 名称 / 颜色预览 / 颜色值 | 字段 36/44；预览正方形同高 | TagEditor、ColorEditor 相关组件与 tags.css |
| 创建行和列表工具栏 | 同排短码 / 选项 / 分享；搜索 / 类型 / 排序 / 多选统一 32/44 | Composer、TextComposer、FileComposer、SlugField、LinkList |
| 日期展开 | 同排选项顶部对齐，日期 / 时间同高 | ExpiryPicker、DateEditor、创建区域 |
| 编辑与详情 | 单行字段和字段型 Segmented 同档；动作同档 | LinkEditor、LinkDetail、Button |
| 设置 | 域名 / 保存、令牌 / 创建；代理地址 / 端口 / 密码状态一致 | Settings、MetadataSettings 等现有组件 |
| 首次设置 / 登录 | 字段与提交同档 | Setup、Login |

生产应将尺寸放入现有 tokens 和共享组件的 size 约定，再清理冲突规则；不要把历史 R3–R9 的 CSS 覆盖链原样搬入生产。DOM 类名以实施时真实源码为准。API、数据库、业务规则和 R7 功能不变。

## 实际验证

证据：`review-r9/*.json`、对应 PNG、`before.json` 和修改前后同视口截图。`tools/r9-qa.js` 在实际 DOM 上测量成组控件外框及并排边缘；同列滚动内容不误判为同排。`tools/r9-check.mjs` 对测量算法做正反例检查，再核对保存结果中的目标档位、组内误差 <=1px、分段内边距、axe 与页面溢出。不是只检查 CSS 声明。

覆盖管理、筛选、编辑及重名禁用、标签选择、类型菜单、文本 / 文件创建、日期展开、内容编辑、详情、代理已保存 / 替换、锁定默认值、读取失败 / 重试恢复、首次设置及关于长值。视口 1194×804、768×900、390×844、320×740；中英文、明暗主题采用代表组合，不声称全部组合穷举。

已操作鼠标范围筛选和搜索、键盘 ArrowRight 切换范围、Escape 关闭并返回管理入口、标签精确 Enter、类型菜单方向键和 Enter、代理替换及错误重试。截图检查包含展开状态。重名错误下保存禁用；错误 / 禁用 / 焦点不改变尺寸。

R8 术语和关于字体继续继承；R9 DOM 文案重新采集与分类，未新增产品文案。开发工具无浏览器错误。无生产源码改动，因此未运行生产 `make check test e2e`；实施后必须通过这些 WSL 检查，并复测最终 Svelte DOM。未执行真实 Safari / Firefox 或真机触摸键盘检查。

本轮检查结果：28 个保存状态、20 类控件组合、189 次组实例测量通过；axe 0 违规、无页面横向溢出。731 个 DOM 字符串已分类，25 个已核对的 dom-metadata 提示（场景、主题、条目 ID 等）；无未分类字符串。`node designs/sani/tools/r9-check.mjs`、design-scope、sources、draft contract、content audit 和 `git diff --check` 通过。

## 生产实施与验证（2026-10-10）

批准提交：`5958500`。已将 R9 尺寸收敛到 app.css tokens、Button 和 Segmented；调用方沿用原有组件，不引入原型运行时。创建区域实际使用 Composer 与 ShareComposer（文本/文件共用）。R8 的管理入口、分类/分享地址/访问术语、关于信息字体随 R9 实施；统计英文复数及批量内容通知也统一口径。英文关于标签与数值保留 12px 间距，避免 Stats time zone 紧贴 Local。

生产证据在 `implementation-r9/`。真实桌面 1194px 下管理搜索与分段外框均为 36px、顶部相同；390px 下均为 44px。版本、时区、文件域名都是 IBM Plex Mono 13px。检查了展开管理、标签编辑/颜色、类型菜单、创建工具栏、设置与关于；中英文、明暗、320/390/1280px 的截图已对照 R9，内容和列表长度来自隔离测试数据。

WSL `make check test` 通过（Go race、57 项 Vitest、Svelte 0 errors/0 warnings）；`make e2e` 79 项通过；`make smoke` 通过；`make docs` 通过（36 页 SEO）。收尾列间距和共享 CSS 去重后重新运行 check/test/build 及 r7.spec.ts 全部 10 项，均通过。`web/scripts/a11y.mjs` 的旧标签编辑入口和 Files 分类选择器同步到当前交互，双语双主题全部 84 个状态无 axe 违规。E2E 同时验证边界宽度、鼠标/模拟触屏、展开控件、键盘返回焦点、错误重试和数据保留。

最终 Svelte DOM 重新采集：562 个唯一字符串完成分类，13 条 dom-metadata 标记逐项核对为条目 ID/字段元数据，无未分类文案。API 和数据库未因 R9 修改。未执行 Safari/Firefox、iOS/Android 真机、系统高对比度验收；未改动生产实例。发布与远端 CI 以具体版本流水线为准。


发布前截图复核补充：旧的窄屏 nth-child 规则曾误隐藏空目录／少量标签时的“管理标签”或“更多标签”。现仅隐藏带 aria-pressed 的标签筛选项，并在 320/390px、0–5 个标签目录中验证两个入口可见、键盘打开与焦点返回。最终候选 `make check test e2e smoke docs VERSION=v0.9.4` 全部通过，E2E 总数为 80。文档的 16 张实际界面截图重新生成。
