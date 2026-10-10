# HTTP API

<p class="lead">版本化的 s.ee 兼容接口与独立的 Sani 管理接口。兼容声明以明确的测试范围为准。</p>

## s.ee 兼容范围 {#see}

::: warning 版本范围
本页描述 Unreleased API 重构。v0.9.4 尚未包含这些路由和 schema 6，使用该版本时请查阅[对应版本的 API 文档](https://github.com/DejavuMoe/sani/blob/v0.9.4/docs/reference/api.md)。只有包含本次重构的构建才能按新版接口运行，升级前必须完成所要求的备份。
:::

对外接口使用 `/api/v1`，Sani 后台与扩展能力使用 `/api/admin/v1`。旧管理路由已移除，旧令牌与会话继续有效。网址 `/{slug}`、分享页 `/p/{slug}`、文件源 `/{slug}/{filename}` 与文本原文 `/{slug}` 保持不变。升级方法见[运维](../guide/operations#upgrade)。

**兼容配置：`sani-see-v1-2026-10-10`，仅覆盖本页列出的 15 个操作及其限定行为。** `make compat` 直接向真实本地服务发送 HTTP 请求验证契约，不依赖或接入 s.ee SDK；HTTP 边界和故障场景由 `go test ./internal/server ./internal/store ./cmd/sani` 覆盖。不宣称兼容所有 s.ee 功能或未来 SDK。

| 调研源码（仅供核对协议，不是依赖） | 版本 / 提交 |
|---|---|
| [Go](https://github.com/sdotee/sdk.go/tree/55538e26b495be6f321492724bb70d808ed32703) | `v1.3.2-0.20260815141744-55538e26b495` (source `Version = 1.5.0`, not a published v1.5.0 tag) |
| [TypeScript](https://github.com/sdotee/sdk.ts/tree/a3b39dc3895d61127b0222f07812e4225d457f10) | npm `see-sdk@1.2.0`, `a3b39dc3895d61127b0222f07812e4225d457f10` |

### 契约依据与差异

核对日期为 2026-10-10。依据为 [s.ee API 目录](https://s.ee/docs/developers/api/)、各操作文档及上述固定 SDK 源码。没有使用 s.ee 账号进行线上探测；仓库内的测试响应是 Sani 的预期输出，不是上游线上录制样本。

- [入门页](https://s.ee/docs/developers/)写 Bearer，两份 SDK 都发送原始 `Authorization`。本实例接受原始令牌、Bearer、`X-Api-Key`；多处凭据冲突或为空时拒绝，错误令牌绝不退回 Cookie。兼容接口不接受 Cookie。
- [生成示例](https://s.ee/docs/api/CreateShortUrl/)中的 `code: 0`、`string` 和 `example.com` 是示例占位；[SM.MS 文档](https://s.ee/docs/developers/smms-compatibility/)展示数字 `200`。Sani 明确使用数字 `200`，文件删除使用字符串 `"200"`；这项本地契约经过直接 HTTP 响应断言，不等同于确认上游所有线上成功码。
- [标签文档](https://s.ee/docs/api/GetTags/)展示多层嵌套，Go/TS 类型读取 `data.tags`。Sani 使用 `data.tags`；更新响应返回实际资源的短码与地址，删除返回 `data: null`，文件删除无 `data`。
- 创建域名的“必填/默认值”、文本标题的“必填/omitempty”、PUT 的“必填/部分修改”互相不一致。本实例创建时允许省略域名及标题；PUT 保留省略字段、允许空标题、拒绝空目标/空文本；所有 JSON `null`、重复字段、未知字段与尾随 JSON 均拒绝。只验证修改的字段，旧记录不会因新建限制被清洗。
- TS Simple Mode 把 `tag_ids` 序列化为逗号分隔，Sani 支持这一形式；不接受数组括号或重复查询参数。

- 调研时发现 TS SDK 默认发送 JSON Content-Type；这是客户端实现细节，Sani 不接入该 SDK。上传测试直接使用标准 FormData，发送带 boundary 的 multipart 请求。

### 所有兼容端点共用的边界

JSON 字段含非法 UTF-8 字节时返回 400，不会静默替换后保存；合法的 `�` 字符仍可原样保存。短码定位的更新和永久删除在写事务内重新核验身份：若已被并发改名为不同短码，返回 404 并保留内容与统计。文件删除按稳定密钥定位，可在改名后继续使用。

须先配置 `SANI_BASE_URL` 或后台的基础域名；未配置返回 `503 domain_unconfigured`。允许域名只有该配置的主机名（包含非默认端口），忽略大小写，不接受 URL、任意 Host、`s.ee` 占位域名或文件源域名。创建可省略，更新/删除/统计必须传入。仍为一个全局、大小写不敏感的短码空间，不支持跨域同名短码，也不回填虚构的历史域名。

JSON 使用 `application/json`，上限 8 MiB；上传使用 multipart。时间输入 `expire_at` 是 Unix **秒**，`0` 表示不设到期，非零须在未来且不超过 `253402300799`；数据库继续保存毫秒。目标上限 2,000 个 Unicode 字符，同时受 Sani 8,192 字节安全限制；标题上限 255 字符；短码继续采用 Sani 的字符集和 64 字符上限。文本保持 1 MiB UTF-8 字节上限；只支持 `plain_text` 和 `source_code`（Sani 的等宽代码显示，不承诺语法着色）。标签最多五个既有 ID。上传继续受实例单文件上限约束。

`password`、`expiration_redirect_url`、`text_type: "markdown"`、`is_private: 1` 和其他未知参数明确返回 `400`，不会创建看似受保护的公开资源。`/usage`、私有下载、`/links`、`/texts`、`/token/check`、TUS、Bio、二维码等范围外路径返回 `501`；不伪造配额或用量。

成功响应：`{"code":200,"message":"success","data":...}`。错误用实际 HTTP 4xx/5xx，数字 `code` 等于 HTTP 状态，`error` 为 Sani 的稳定诊断标识，`message` 为说明，`success:false`。文件删除的 `code` 类型固定为字符串。所有兼容响应不缓存；HEAD 返回 405，尤其不会执行 GET 创建或删除。跨站浏览器请求被拒绝。反向代理必须对 Simple Mode 的 `signature` 查询和文件删除路径做脱敏；Sani 自身不记录这些凭据。

| Method | Path | Profile |
|---|---|---|
| `POST` | `/api/v1/shorten` | [sani-see-v1-2026-10-10](#see) |
| `GET` | `/api/v1/shorten` | [sani-see-v1-2026-10-10](#see) |
| `PUT` | `/api/v1/shorten` | [sani-see-v1-2026-10-10](#see) |
| `DELETE` | `/api/v1/shorten` | [sani-see-v1-2026-10-10](#see) |
| `GET` | `/api/v1/domains` | [sani-see-v1-2026-10-10](#see) |
| `GET` | `/api/v1/link/visit-stat` | [sani-see-v1-2026-10-10](#see) |
| `POST` | `/api/v1/text` | [sani-see-v1-2026-10-10](#see) |
| `PUT` | `/api/v1/text` | [sani-see-v1-2026-10-10](#see) |
| `DELETE` | `/api/v1/text` | [sani-see-v1-2026-10-10](#see) |
| `GET` | `/api/v1/text/domains` | [sani-see-v1-2026-10-10](#see) |
| `POST` | `/api/v1/file/upload` | [sani-see-v1-2026-10-10](#see) |
| `GET` | `/api/v1/files` | [sani-see-v1-2026-10-10](#see) |
| `GET` | `/api/v1/file/delete/{hash}` | [sani-see-v1-2026-10-10](#see) |
| `GET` | `/api/v1/file/domains` | [sani-see-v1-2026-10-10](#see) |
| `GET` | `/api/v1/tags` | [sani-see-v1-2026-10-10](#see) |

`POST /api/v1/shorten`

创建短链。必填 `target_url`；可选 `domain/custom_slug/title/expire_at/tag_ids`。返回实际 `slug/custom_slug/short_url`，新建成功 HTTP 200。

`GET /api/v1/shorten`

Simple Mode：必填 `url`，令牌可用 `signature`；可选 `domain/custom_slug/title/expire_at/tag_ids/json`。默认纯文本短网址，`json=true` 返回创建响应。失败仍为 JSON。

`PUT /api/v1/shorten`

通过必填 `domain/slug` 定位网址；可选 `target_url/title`，至少修改一个字段。返回实际短码和地址；更新立即失效缓存。

`DELETE /api/v1/shorten`

必填 `domain/slug`，仅删除网址。永久删除记录及统计，释放短码，不可通过后台恢复；旧公开地址失效。

`GET /api/v1/domains`

返回 `data.domains` 字符串数组，只有实例主域名。

`GET /api/v1/link/visit-stat`

必填 `domain/slug`，可选 `period=daily|monthly|totally`（默认累计）。返回 `data.visit_count`；daily 为实例时区今天，monthly 为自然月；日/月查询刷盘失败即报错。

`POST /api/v1/text`

必填 `content`；可选 `domain/custom_slug/title/expire_at/tag_ids/text_type`。默认普通文本，返回 `/p/{slug}` 真实分享地址。

`PUT /api/v1/text`

必填 `domain/slug`；可选 `content/title`，至少一个。省略内容时保留原始字节；不会把网址或文件当文本修改。

`DELETE /api/v1/text`

必填 `domain/slug`，永久删除文本及统计；不可恢复。

`GET /api/v1/text/domains`

返回文本分享可用主域名，结构为 `data.domains`。

`POST /api/v1/file/upload`

上传一个 `file` 或别名 `smfile`，可选 `domain/custom_slug/is_private`（仅 `0`）。流式接收，任何后置非法表单字段也会清理临时文件且不保存记录。返回 `file_id/filename/size/mime_type/created_at/url/page/path/storename/hash/delete/upload_status/width/height`。`url` 为文件源下载地址，`page` 为主域分享页；`hash` 为稳定随机删除密钥，绝非 SHA-256；删除 URL 仍需令牌。`created_at` 为秒，`upload_status=1`，未解析图像尺寸时 `width/height=0`，不承诺图像尺寸兼容。

`GET /api/v1/files`

可选 `page`（1–1000000，默认 1），每页固定 30 条，按创建时间及 ID 降序。`data` 是与上传相同结构的数组，带 `success:true`；空页是 `[]`。包含后台和旧版上传的文件。

`GET /api/v1/file/delete/{hash}`

以删除密钥定位且仍需令牌，永久删除文件记录与统计，现有文件回收器异步清理字节。返回 `{"code":"200","message":"success","success":true}`；无 `data`。

`GET /api/v1/file/domains`

返回文件分享的主域名；不是文件源域名。未配置文件源时返回空数组。

`GET /api/v1/tags`

返回 `data.tags` 数组，每项只有 `id/name`；颜色、数量和标签编辑在管理 API。

## 管理接口约定 {#conventions}

- **统一前缀**：管理 API 使用 `/api/admin/v1`。默认 JSON；文件上传、CSV 导出、图标等例外见各端点。
- **身份认证**：会话状态、登录和首次初始化按下文公开契约处理，其余管理操作需鉴权。自动化调用使用 API 令牌，在请求头中传入 `Authorization: Bearer sani_…` 或 `X-Api-Key: sani_…`；管理前端使用会话 Cookie。令牌可在后台 设置 → API 令牌 中生成，具备完全管理权限。
- **跨站防护**：浏览器发起的跨站请求会被自动拦截（通过检查浏览器附带的 `Sec-Fetch-Site` 与 `Origin` 头）。脚本与命令行工具不发送此类浏览器标头，不受影响。
- **时间格式**：统一采用 RFC 3339 格式的 UTC 时间戳，如 `2026-09-28T09:30:00Z`。
- **请求体积限制**：常规 JSON 请求体上限 1 MB。文本创建与链接更新接口上限 8 MiB（确保可容纳经过大量转义的 1 MB 纯文本）；导入接口上限 32 MB；文件上传上限为 [单文件上限](./configuration#sani-max-file-mb) 额外附加 1 MB 表单开销。
- **缓存策略**：JSON 响应返回 `Cache-Control: no-store`。
- **错误响应格式**：出现异常时返回对应 HTTP 状态码与结构化错误体。其中 `code` 为机器可读的持久标识，程序逻辑应以此为准；`message` 为人类可读说明。完整码表见[错误码](#errors)。

```json
{ "error": { "code": "slug_taken", "message": "this slug is already in use" } }
```

示例请求：

```sh
curl https://s.example.com/api/admin/v1/links \
  -H "Authorization: Bearer $SANI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/launch", "slug": "launch"}'
```

## 接口一览 {#index}

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/admin/v1/links` | [列出链接](#list) |
| `PATCH` | `/api/admin/v1/tags/{id}` | [修改标签](#tags) |
| `DELETE` | `/api/admin/v1/tags/{id}` | [删除标签](#tags) |
| `POST` | `/api/admin/v1/uploads` | [建立分片上传](#chunk-upload) |
| `PUT` | `/api/admin/v1/uploads/{id}` | [写入分片](#chunk-upload) |
| `POST` | `/api/admin/v1/uploads/{id}/complete` | [完成上传](#chunk-upload) |
| `DELETE` | `/api/admin/v1/uploads/{id}` | [取消上传](#chunk-upload) |
| `GET` | `/api/admin/v1/tags` | [标签目录与数量](#tags) |
| `POST` | `/api/admin/v1/tags` | [创建或取得标签](#tags) |
| `POST` | `/api/admin/v1/links` | [创建链接](#create) |
| `POST` | `/api/admin/v1/links/bulk` | [批量修改链接](#bulk) |
| `GET` | `/api/admin/v1/links/{id}` | [读取一条链接](#get) |
| `PATCH` | `/api/admin/v1/links/{id}` | [修改链接](#update) |
| `DELETE` | `/api/admin/v1/links/{id}` | [删除链接](#delete) |
| `POST` | `/api/admin/v1/links/{id}/restore` | [恢复刚删除的链接](#restore) |
| `POST` | `/api/admin/v1/links/{id}/refresh` | [重新获取标题和图标](#refresh) |
| `GET` | `/api/admin/v1/links/{id}/stats` | [一条链接的统计](#stats) |
| `POST` | `/api/admin/v1/texts` | [分享文本](#create-text) |
| `POST` | `/api/admin/v1/files` | [分享文件](#create-file) |
| `GET` | `/api/admin/v1/links/{id}/text` | [读取分享的文本](#read-text) |
| `GET` | `/api/admin/v1/slugs/{slug}` | [检查短码是否可用](#slug-check) |
| `GET` | `/api/admin/v1/overview` | [全部链接的概览](#overview) |
| `GET` | `/api/admin/v1/favicons/{host}` | [网站图标](#favicons) |
| `GET` | `/api/admin/v1/export` | [导出全部链接](#export) |
| `POST` | `/api/admin/v1/import` | [导入链接](#import) |
| `GET` | `/api/admin/v1/config` | [读取设置](#config) |
| `PATCH` | `/api/admin/v1/config` | [修改域名与创建设置](#config) |
| `POST` | `/api/admin/v1/config/metadata/test` | [测试代理连接](#metadata-test) |
| `GET` | `/api/admin/v1/tokens` | [列出 API 令牌](#tokens) |
| `POST` | `/api/admin/v1/tokens` | [创建 API 令牌](#tokens) |
| `DELETE` | `/api/admin/v1/tokens/{id}` | [撤销 API 令牌](#tokens) |
| `GET` | `/api/admin/v1/session` | [登录状态](#session) |
| `POST` | `/api/admin/v1/session` | [登录](#session) |
| `DELETE` | `/api/admin/v1/session` | [退出登录](#session) |
| `POST` | `/api/admin/v1/setup` | [首次设置密码](#session) |
| `PUT` | `/api/admin/v1/password` | [修改密码](#password) |
| `POST` | `/api/admin/v1/sessions/revoke` | [让其他设备退出登录](#password) |

## 链接 {#links}

### 标签 {#tags}

`GET /api/admin/v1/tags`

返回 `{"items":[{"id":1,"name":"工作","color":"blue","count":3}],"total":8,"untagged":2}`。`count` 是使用该标签的未删除链接数（包含文本、文件和已停用链接）；`total` 与 `untagged` 分别是全部和未标记链接数，不受列表搜索、类型或标签筛选影响。零引用标签仍保留。

`POST /api/admin/v1/tags`

请求 `{"name":"工作","color":"blue"}`，返回 `200` 和标签对象。名称去除首尾空白并做 NFC 规范化，限定 1–24 个 Unicode 码点，不允许控制字符；按小写名称去重。同名请求返回已有标签，不改变原名称与颜色。`color` 可省略，默认为 `blue`；可选 `blue`、`green`、`amber`、`rose`、`neutral` 或六位 HEX（如 `#5872a5`）。请求体上限 4 KB，每个实例最多 1,000 个标签。

标签只在鉴权后的管理 API 与界面中展示，访客分享页不包含标签。


`PATCH /api/admin/v1/tags/{id}`

传入 `name` 与 `color` 修改现有标签，返回 `200` 和更新后的标签对象；所有关联保留同一 ID。规范化后的同名冲突返回 `409 tag_taken`，不存在的 ID 返回 `404`。创建与修改均接受旧命名色或六位 HEX（如 `#5872a5`），规范化为小写。后台会把 HEX3、RGB、HSL 转为 HEX6；API 不接受任意 CSS。

`DELETE /api/admin/v1/tags/{id}`

在一个事务中永久删除标签及其全部关联（包括软删除内容的关联），保留链接、文本、文件和其他标签，并单调递增关联内容的 `updatedAt`。成功返回 `204`，无响应体；不存在的标签返回 `404 not_found`。确认前显示的关联数是快照，删除作用于提交时的全部关联。需要与其他写接口相同的鉴权与跨来源保护。

### 链接对象 {#link-object}

```json
{
  "id": 12,
  "tags": [1],
  "kind": "url",
  "content": null,
  "slug": "gh",
  "shortUrl": "https://s.example.com/gh",
  "url": "https://github.com/DejavuMoe/sani",
  "host": "github.com",
  "title": "DejavuMoe/sani",
  "meta": "ok",
  "icon": true,
  "redirect": 302,
  "enabled": true,
  "status": "active",
  "expiresAt": null,
  "maxClicks": null,
  "clicks": 2507,
  "lastClickAt": "2026-09-28T16:02:11.402Z",
  "createdAt": "2026-08-01T14:19:03.118Z",
  "updatedAt": "2026-08-01T14:19:03.118Z"
}
```

| 字段 | 说明 |
|---|---|
| `kind` | `url` 是短链接，`text` 和 `file` 是[分享](#shares)。 |
| `tags` | 按选择顺序排列的标签 ID 数组；未标记时为 `[]`。名称与颜色从 [标签目录](#tags) 读取。 |
| `content` | 文本或文件分享的内容，见[下文](#shares)；短链接为 `null`。 |
| `slug` | 短码，保留创建时的大小写。查找时不区分大小写。 |
| `shortUrl` | 完整的短链接，文本和文件的短码前面多一段 `/p/`。域名的来源见[部署](../guide/deploy#domain)。 |
| `url` | 规范化之后的目标网址。文本和文件为空字符串。 |
| `host` | 目标网址的域名，去掉了 `www.`。`mailto:` 这类没有域名的网址为空字符串。 |
| `title` | 标题，没有时为空字符串。 |
| `meta` | 标题的来源：`pending` 正在获取，`ok` 从网页获取，`failed` 没有获取到，`manual` 由你设置，以后不会被自动覆盖。 |
| `icon` | 是否保存了网站图标，图标从 [`/api/admin/v1/favicons/{host}`](#favicons) 获取。 |
| `redirect` | 跳转使用的状态码：301、302、307 或 308。 |
| `status` | `active` 正常，`disabled` 已停用，`expired` 已过期，`exhausted` 访问次数已用完。 |
| `expiresAt`、`maxClicks` | 过期时间和访问上限，没有设置时为 `null`。 |
| `clicks` | 总点击数，包含还在内存里、尚未写入数据库的点击。 |
| `lastClickAt` | 最近一次计入统计的访问，没有时为 `null`。 |

### 创建链接 {#create}

`POST /api/admin/v1/links`

只有 `url` 是必填的。

可选 `tags` 接受最多 5 个不同的、已存在的正整数标签 ID。省略时无标签；创建标签需先调用 `POST /api/admin/v1/tags`。指定 `tags`（包括 `[]`）时不使用 `reuse`，避免忽略标签设置。文本与文件分享也支持标签。

| 字段 | 说明 |
|---|---|
| `url` | 目标网址。`example.com/a` 会补全为 `https://example.com/a`，`localhost` 和 IP 地址补全为 `http://`；域名转为小写，空格转为 `%20`；最长 8,192 字节。`javascript:`、`data:`、`file:` 等 13 种危险的网址类型会被拒绝，也不能指向本站的另一条短链接。`mailto:`、`tel:` 这类网址是允许的。 |
| `slug` | 短码，规则见[日常使用](../guide/usage#slugs)。开头的 `/` 会被去掉。不填或为空时自动生成。 |
| `title` | 标题，连续的空白会合并，超过 300 个字符会被截断。不填时在后台自动获取。 |
| `expiresAt` | RFC 3339 过期时间，必须晚于现在，转换到 UTC 后年份在 0000–9999 内，按毫秒保存。`null` 表示永久有效。 |
| `maxClicks` | 访问上限，非负整数，`0` 或 `null` 表示不限。 |
| `redirect` | `302`（默认）、`301`、`307` 或 `308`。 |
| `enabled` | 默认 `true`。 |
| `reuse` | 设为 `true`，并且没有指定短码、过期时间、访问上限、跳转方式和标签时，如果已经有一条指向同一网址的普通链接（启用、没有过期时间、没有访问上限、302 跳转），就直接返回它，状态码为 `200`，并带上 `"reused": true`。书签小工具和手机分享用的就是它。 |

成功时返回 `201` 和新建的[链接对象](#link-object)。

### 列出链接 {#list}

`GET /api/admin/v1/links`

| 参数 | 说明 |
|---|---|
| `q` | 按短码、标题、目标网址、文件名和文本的第一行搜索。也可以直接传完整的短链接。 |
| `kind` | 只返回这一[类型](#link-object)的链接：`url`、`text` 或 `file`。 |
| `sort` | `created`（默认，最近创建）、`clicks`（点击最多）或 `visited`（最近访问）。 |
| `limit` | 每页数量，1 到 200，默认 50。 |
| `cursor` | 上一页返回的 `next`。 |
| `tag` | 一个标签 ID，或 `untagged`（未标记）；省略时不限标签。与搜索及类型筛选取交集，`total` 和游标分页均基于筛选结果。 |

```json
{ "items": [ … ], "next": "kx3f2a.c", "total": 128 }
```

- `items` 中的每一项都是[链接对象](#link-object)，另外带有 `spark` 字段：最近 14 天每天的点击数，从早到晚排列。14 天里没有点击的链接没有这个字段。
- `next` 是下一页的游标，最后一页为 `null`。
- `total` 是符合搜索条件的链接总数。

### 读取一条链接 {#get}

`GET /api/admin/v1/links/{id}`

返回[链接对象](#link-object)。

### 修改链接 {#update}

`tags` 省略时保留已有标签；传 `[]` 清空；传 ID 数组整体替换。`null`、重复、不存在的 ID 或超过 5 项会报错，整次修改回滚。

`PATCH /api/admin/v1/links/{id}`

接受创建时除 `reuse` 以外的全部字段，只修改请求里出现的字段：

- `expiresAt` 或 `maxClicks` 传 `null`，表示清除；
- `title` 传空字符串，表示重新自动获取标题；
- 修改 `url` 时，如果原来的标题是自动获取的，会重新获取；
- 修改 `slug` 后，旧短码立即失效；
- 对于文本，`text` 和 `format` 替换它的内容和格式。

自动标题是否需要清空，以写事务中的最新记录为准；更新网址或刷新元数据不会覆盖并发保存的手工标题。显式传入空标题仍表示重新选择自动获取（受 `SANI_FETCH_META` 控制）。

文本和文件没有 `url` 和 `redirect`；`text` 和 `format` 只属于文本。把它们发给别的类型的链接，会得到 `kind_mismatch`。文件的内容不能替换，需要的话重新分享一个。修改在下一次访问时就会生效。返回修改后的[链接对象](#link-object)。

### 删除链接 {#delete}

`DELETE /api/admin/v1/links/{id}`

返回 `204`。到达源站的新请求立即停止跳转。删除超过一小时的记录由后台连同统计一起清除；实际清理前仍可恢复。删除后短码可立即分配给新链接，这会提前移除旧记录。分享文件异步回收，详见[清理周期](../guide/operations#share-cleanup)。

### 恢复链接 {#restore}

`POST /api/admin/v1/links/{id}/restore`

撤销删除，返回恢复后的[链接对象](#link-object)。记录已经被后台清除，或者短码已经被新链接占用时，返回 `404`。恢复不会重置有效期或访问计数。

### 批量修改链接 {#bulk}

`POST /api/admin/v1/links/bulk`

在一个事务里启用、停用、删除或恢复多条链接：

```json
{ "action": "disable", "ids": [12, 15, 31] }
```

- `action` 是 `enable`、`disable`、`delete` 或 `restore` 之一，`ids` 列出 1 到 500 条链接。
- 返回 `{"items": [...]}`：发生了变化的[链接](#link-object)。`delete` 返回删除之前的样子，其他操作返回修改之后的样子。不存在的 id、本来就处在目标状态的链接，以及[已经无法恢复](#restore)的链接都不会出现在里面，所以列表可能比 `ids` 短。
- 删除的链接在记录被清理或短码被复用前可以恢复，和[单条删除](#delete)一样。

### 重新获取标题和图标 {#refresh}

`POST /api/admin/v1/links/{id}/refresh`

重新获取目标网页的标题和网站图标，等获取完成后返回[链接对象](#link-object)，可能需要几秒钟。你自己设置的标题会保留。文本和文件没有网页可以获取，会得到 `kind_mismatch`。

### 统计 {#stats}

`GET /api/admin/v1/links/{id}/stats`

参数 `days` 是统计的天数，1 到 366，默认 30。

```json
{
  "link": { … },
  "days": [{ "date": "2026-09-01", "count": 41 }, …],
  "referrers": [{ "host": "", "count": 1053 }, { "host": "t.co", "count": 451 }],
  "referrersTotal": 2507
}
```

- `days` 从早到晚排列，最后一天是今天，按服务器时区划分。
- `referrers` 是点击最多的 8 个来源网站。`""` 表示直接访问，`"*"` 表示超出 200 个来源之后的其他来源。
- `referrersTotal` 是记录了来源的点击总数。

口径说明见[统计口径](../guide/statistics)。

### 检查短码 {#slug-check}

`GET /api/admin/v1/slugs/{slug}`

检查短码能不能用：

```json
{ "available": false, "reason": "slug_taken" }
```

`reason` 可能是 `slug_taken`、`slug_reserved`、`slug_invalid` 或 `slug_too_long`，可用时没有这个字段。

## 文本和文件 {#shares}

分享是一种不跳转、而是展示内容的链接：访问者在 `/p/{slug}` 打开它，原始内容从[文件域名](./configuration#sani-files-url)提供。分享和短链接共用短码命名空间，`gh` 不能既是短链接又是分享。它们同样有 `title`、`enabled`、`expiresAt` 和 `maxClicks`，同样有[统计](#stats)；列表、删除、恢复和批量接口对它们一视同仁。自动生成的文本／代码和文件分享短码分别使用 [`textSlugLength`、`fileSlugLength`](#config)，新安装均默认 10 位，可独立设为 3–32 位，不含 `/p/`。分享始终排除易混淆字符，不受网址长度或 `excludeConfusable` 影响；生成重试与碰撞扩长规则不变。低于 10 位仍会按设置生成，较短的短码更容易被猜中，知道地址的人即可访问。手动指定的短码沿用原有规则。

分享的 `content`：

```json
{
  "format": "code",
  "preview": "server {",
  "lines": 11,
  "size": 286,
  "rawUrl": "https://f.example.com/nginx-conf"
}
```

```json
{
  "name": "设计评审 v3.pdf",
  "type": "application/pdf",
  "sha256": "67b21479e9f0cda26f49fe72be530b79adb35d2040cb207f61f0cc7bd2847f6e",
  "size": 597,
  "rawUrl": "https://f.example.com/tn5ya24hh6/%E8%AE%BE%E8%AE%A1%E8%AF%84%E5%AE%A1%20v3.pdf"
}
```

| 字段 | 说明 |
|---|---|
| `format` | 文本：`plain` 按普通文字排版，`code` 等宽显示并带行号。 |
| `preview` | 文本：第一个非空行，最多 120 个字符。 |
| `lines` | 文本：行数。 |
| `name`、`type` | 文件：文件名和媒体类型。类型按扩展名判断，没有扩展名时看文件开头的内容。 |
| `sha256` | 文件：内容的 SHA-256，十六进制。 |
| `size` | 大小，单位是字节。 |
| `rawUrl` | 文件域名上的原始内容，没有文件域名时为 `null`。打开它计为一次访问。 |

### 分享文本 {#create-text}

`POST /api/admin/v1/texts`

```json
{ "text": "server {\n    listen 443 ssl;\n}\n", "format": "code", "slug": "nginx-conf" }
```

`text` 必填，最多 1 MB 的 UTF-8 文本，不能只有空白，换行等内容按原样保存。`format` 默认 `plain`。`slug`、`title`、`expiresAt`、`maxClicks` 和 `enabled` 与[创建链接](#create)相同。成功时返回 `201` 和新建的[链接对象](#link-object)。

### 分享文件 {#create-file}

可选 multipart 字段 `tags` 使用 JSON 数组字符串，如 `[1,2]`；与 JSON 创建接口使用相同的标签校验。无效标签导致上传失败时会清理已接收的文件。

`POST /api/admin/v1/files`

请求体是 `multipart/form-data`：一个 `file` 部分，以及可选的 `slug`、`title`、`expiresAt`、`maxClicks` 和 `enabled` 字段，值是文本，含义与[创建链接](#create)相同：

```sh
curl https://s.example.com/api/admin/v1/files \
  -H "Authorization: Bearer $SANI_TOKEN" \
  -F file=@report.pdf -F maxClicks=10
```

- 文件不能为空，大小上限由后台设置或显式 [`SANI_MAX_FILE_MB`](./configuration#sani-max-file-mb) 决定。文件边接收边写入磁盘，不会整个放进内存。
- 保留文件名，但去掉路径、控制字符和看不见的文字方向标记。
- 分享文件需要文件域名，没有设置时返回 `409 files_disabled`。

成功时返回 `201` 和新建的[链接对象](#link-object)。

### 读取分享的文本 {#read-text}

`GET /api/admin/v1/links/{id}/text`

返回 `{"text": "…"}`，即完整的文本内容，列表里不包含它。读取不计入访问。不是文本的链接返回 `404`。

## 概览 {#overview}

`GET /api/admin/v1/overview`

参数 `days` 与[统计](#stats)相同。

```json
{ "links": 128, "clicks": 6920, "today": 37, "days": [{ "date": "2026-08-31", "count": 212 }, …] }
```

## 网站图标 {#favicons}

`GET /api/admin/v1/favicons/{host}`

返回图标文件本身，没有图标时返回 `404`。`{host}` 就是[链接对象](#link-object)里的 `host`。图标来自第三方网站，所以返回时带有沙箱化的内容安全策略，即使是 SVG 也无法执行脚本。

## 导入与导出 {#import-export}

### 导出 {#export}

`GET /api/admin/v1/export`

以附件形式返回全部未删除的网址链接及其标签的 Sani JSON，不包含文本或文件分享；文件格式见[导入与导出](../guide/import-export#export)。加上 `?format=csv` 返回 CSV。

CSV 对可能触发电子表格公式的字段添加单引号前缀；重新导入会保留前缀。JSON 保留原始字段，适合无损迁移。

### 导入 {#import}

`POST /api/admin/v1/import`

请求体是文件本身，最大 32 MB，最多 100,000 条链接。支持的格式和规则见[导入与导出](../guide/import-export#import)。

```sh
curl https://s.example.com/api/admin/v1/import \
  -H "Authorization: Bearer $SANI_TOKEN" \
  --data-binary @shlink-export.json
```

```json
{ "created": 42, "skipped": [{ "row": 7, "reason": "url_invalid" }, { "slug": "blog", "reason": "slug_taken" }] }
```

`skipped` 中的 `row` 是文件里的第几条记录，从 1 开始；因为短码已被占用而跳过的，只有 `slug`。

过期时间可以是受支持的日期字符串或 Unix 秒/毫秒时间戳，按毫秒保存。非空值若格式非法、早于 Unix 纪元、超出 UTC 年份 0000–9999 或在单位换算时溢出，该行以 `expires_invalid` 跳过。空值和 `0` 表示永久有效；合法的历史过期时间会保留。

### 分片上传 {#chunk-upload}

四个端点均需鉴权并接受相同的同源校验。后台对超过 25,000,000 字节的文件使用此流程；较小文件继续调用 `POST /api/admin/v1/files`。

`POST /api/admin/v1/uploads`

发送 JSON `{ "name":"archive.zip", "size":72000000, "slug":"archive" }`，可选链接字段 `title`、`tags`、`expiresAt`、`maxClicks`、`enabled`。请求体限制 16 KiB。返回 `201` 和 `{ "id":"…", "offset":0, "chunkSize":25000000, "expiresAt":"…" }`。完整文件大小不得超过当前 `maxFileSize`。会话绑定具体登录会话或令牌凭据，不使用可复用的令牌数字 ID。

`PUT /api/admin/v1/uploads/{id}`

请求体为原始分片字节，`Content-Length` 为 1–25,000,000，`Upload-Offset` 等于上次确认的偏移。返回 `200` 和 `{ "offset":25000000 }`。按顺序上传；仅最近一个分片可重试，且长度与 SHA-256 必须相同。偏移或重复分片内容不符返回 `409 upload_offset`；传输失败或不完整不会推进偏移。文件流式写盘，不整体缓存在内存。

`POST /api/admin/v1/uploads/{id}/complete`

全部字节确认后发送空请求体完成上传。服务端核验文件长度、计算 SHA-256 并原子发布分享。返回 `201` 和链接对象；完成回执尚保留时再次调用返回 `200` 和同一链接。未完成返回 `409 upload_incomplete`，完成前没有可见分享。校验或存储错误在存储条件允许时保留待完成上传供重试。

`DELETE /api/admin/v1/uploads/{id}`

取消待完成上传、删除临时字节并返回 `204`；删除已完成回执不会删除分享。其他凭据、过期或不存在的会话返回 `404 upload_not_found`，并发操作返回 `409 upload_busy`。

限制：每实例 8 个活动会话，每份凭据 2 个，总预留完整文件空间 8 GiB；超限返回 `429 upload_limit`。最近完成回执最多 32 个，必要时淘汰最早完成项。会话闲置一小时失效，由每分钟维护清理；启动时清理遗留分片。支持当前页面重试，不支持刷新或重启后的续传。取消请求丢失时由过期清理回收。只有完整分享参与常规备份和保留规则。

## 设置 {#config}

`GET /api/admin/v1/config`

```json
{
  "version": "v0.9.4",
  "baseUrl": "https://s.example.com",
  "baseUrlSource": "env",
  "requestOrigin": "https://s.example.com",
  "slugLength": 5,
  "textSlugLength": 10,
  "fileSlugLength": 10,
  "fetchMeta": true,
  "forwardQuery": true,
  "passwordFromEnv": false,
  "timezone": "Asia/Shanghai",
  "filesUrl": "https://f.example.com",
  "maxFileSize": 99000000,
  "excludeConfusable": true,
  "metaMode": "direct",
  "metaProxyConfigured": false,
  "metaProxy": null,
  "configSources": {"slugLength":"default","textSlugLength":"default","fileSlugLength":"default","excludeConfusable":"default","maxFileSize":"default","metaMode":"default","metaProxy":"default"},
  "uploadChunkSize": 25000000,
  "maxTextSize": 1048576
}
```

`baseUrlSource` 表示短链接域名的来源：`env` 来自 `SANI_BASE_URL`，`setting` 来自设置页，`request` 来自当前请求的地址。`filesUrl` 是[文件域名](./configuration#sani-files-url)，没有设置时为 `null`；`maxFileSize` 和 `maxTextSize` 是文件和文本的大小上限，单位是字节。

三个长度字段返回各类型当前生效的自动短码长度，均为 3–32 的整数：

| 字段 | 用途 | 新安装默认值 | 优先且锁定该字段的环境变量 |
|---|---|---|---|
| `slugLength` | 网址 | `5` | `SANI_SLUG_LENGTH` |
| `textSlugLength` | 文本／代码分享 | `10` | `SANI_TEXT_SLUG_LENGTH` |
| `fileSlugLength` | 文件分享（普通及分片上传） | `10` | `SANI_FILE_SLUG_LENGTH` |

三项独立持久化，重启后保留。`configSources` 包含上述三项及 `excludeConfusable`、`maxFileSize`、`metaMode`、`metaProxy`，逐字段返回 `default`（内置默认）、`settings`（数据库保存值）或 `env`（显式环境变量）。优先级依次升高，锁定一个字段不影响其他长度字段。

旧实例首次升级时，将缺少独立设置的分享长度按 `max(10, 旧版有效网址短码长度)` 初始化并保存；例如旧值为 12 时两类分享保留 12 位。之后修改网址长度不会改变分享长度，各自环境变量仍优先。迁移保存值的来源为 `settings`，被显式环境变量覆盖时为 `env`；移除覆盖后恢复已保存值，不重新跟随网址长度。长度不含 `/p/`，只影响后续自动生成；已有短码和手动指定的短码不变。

`PATCH /api/admin/v1/config`

修改设置页里的短链接域名：

```json
{ "baseUrl": "https://s.example.com" }
```

传 `null` 或空字符串表示清除。短链接域名不能和文件域名相同。设置了 `SANI_BASE_URL` 时返回 `409`。成功时返回修改后的设置。

创建设置也可修改：`slugLength`、`textSlugLength`、`fileSlugLength`（各为 3–32 的整数）、`excludeConfusable`（布尔值）、`maxFileSize`（以字节表示的整数十进制 MB，范围 1,000,000–4,096,000,000，须为 1,000,000 的倍数）、`metaMode`（`off`、`direct`、`proxy`）。省略或为 `null` 的创建字段不变。所有提交字段连同基础域名统一校验并原子保存。修改环境变量锁定项返回 `409 config_env`，非法值返回 `400 config_invalid`。代理模式需要已保存的代理或 `SANI_META_PROXY`，否则返回 `409 proxy_missing`。旧部署沿用的系统代理显示为 `metaMode: "environment"`，该值不可写入。`fetchMeta` 表示当前是否有可用抓取器；关闭抓取后刷新不会联网，也不清空已有元数据。请求体限制 4 KiB。

例如将网址设为 5 位、文本／代码设为 5 位、文件设为 12 位：

```json
{ "slugLength": 5, "textSlugLength": 5, "fileSlugLength": 12 }
```

分享没有隐藏的 10 位下限，低于 10 位的提示不阻止保存。`excludeConfusable` 只控制网址；分享始终使用无歧义字符集。

未配置时 `metaProxy` 为 `null`；否则 GET 返回 `{scheme, host, port, auth, username, passwordSet}`，不返回密码。`metaProxyConfigured` 同时表示是否存在专用代理。PATCH 接受完整代理对象和可选的 `password`：

```json
{
  "metaMode": "proxy",
  "metaProxy": {"scheme":"https","host":"proxy.example.com","port":443,"auth":false,"username":""}
}
```

协议限 `http`、`https`、`socks5`；主机填写域名或不带方括号的 IP，端口为 1–65535，`auth` 控制认证。启用认证需要用户名和密码，各不超过 255 个 UTF-8 字节；用户名不能包含冒号或换行。密码省略或为 null 时，仅在协议、主机、端口和用户名都不变时保留旧密码；更换这些字段需重新输入密码（`400 proxy_password_required`）。显式空密码表示移除，认证仍开启时会被拒绝；使用 `auth:false` 可清除已保存的用户名与密码。省略或为 null 的 `metaProxy` 不修改代理。`SANI_META_PROXY` 覆盖后台设置；显式 `SANI_FETCH_META` 也锁定代理编辑。GET 和错误响应均不返回密码。存储与传输边界见[代理配置](./configuration#sani-meta-proxy)。

## 测试网页信息代理 {#metadata-test}

`POST /api/admin/v1/config/metadata/test`

需已登录会话或 API 令牌，并遵循与其他写操作相同的跨站保护。请求体 `{"metaProxy": {...}}` 沿用上述 PATCH 字段及密码保留规则，限制 4 KiB。只测试当前表单，不保存设置，也不替换生效中的抓取器。通过相同的公网 IP 校验及代理传输访问固定 HTTPS 目标 `https://example.com` 并获取标题，失败不直连。总截止时间 12 秒，传输层可能更早超时；每个实例同时最多一个测试，两次启动至少间隔 5 秒（`429 rate_limited`，`Retry-After: 5`）。请求取消或服务关闭会取消测试。

成功返回 `200 {"ok":true}`；连接或标题获取失败返回 `502 proxy_test_failed`，不包含传输细节或凭据。字段非法返回 `400 config_invalid`（或 `proxy_password_required`）；模式或代理由环境变量锁定时返回 `409 config_env`。响应使用 `Cache-Control: no-store`。

## API 令牌 {#tokens}

`GET /api/admin/v1/tokens`

返回 `{"items": [...]}`，即令牌列表，每一项形如 `{"id": 3, "name": "iPhone 快捷指令", "hint": "sani_Ab3d", "createdAt": "…", "usedAt": "…"}`。`hint` 是令牌的开头几个字符，方便辨认；`usedAt` 是最近一次使用的时间，精确到分钟，没用过时为 `null`。

`POST /api/admin/v1/tokens`

请求体为 `{"name": "iPhone 快捷指令"}`，名称 1 到 60 个字符。返回 `201`，响应里的 `token` 字段是令牌本身，**只在这时返回一次**。Sani 只保存它的哈希。

`DELETE /api/admin/v1/tokens/{id}`

撤销令牌，返回 `204`。

## 登录与会话 {#session}

这几个接口供管理界面使用，不需要认证。

`GET /api/admin/v1/session`

返回 `{"authenticated": false, "needsSetup": true}`：当前是否已登录，以及是否还没有设置密码。

`POST /api/admin/v1/setup`

首次设置密码，请求体为 `{"code": "k7m2-p9x4-hq3d", "password": "…"}`。`code` 是[启动日志里的设置码](../guide/deploy#first-password)，不区分大小写，空格和短横线会被忽略。成功后直接登录，返回 `{"authenticated": true}`。已经有密码时返回 `409`。

`POST /api/admin/v1/session`

登录，请求体为 `{"password": "…"}`。成功后设置会话 Cookie，返回 `{"authenticated": true}`。

首次设置或登录过程中若密码已被另一次修改替换，会话签发返回 `401 wrong_password`，需使用当前密码重新登录。

`DELETE /api/admin/v1/session`

退出登录，返回 `204`。

登录和首次设置按客户端地址限流：15 分钟内失败 8 次后，在这 15 分钟结束前的请求都会返回 `429`，`Retry-After` 响应头和响应体里的 `retryAfter` 字段给出还要等待的秒数。

会话 Cookie 名为 `sani_session`，带有 `HttpOnly` 和 `SameSite=Strict`，只发送给 `/api/` 下的地址，有效期 30 天，使用时自动续期。

## 密码 {#password}

首次设置与更换密码要求至少 8 个 Unicode 码点、最多 1,024 个 UTF-8 字节，与环境变量及 CLI 限制一致。

`PUT /api/admin/v1/password`

修改密码，请求体为 `{"current": "…", "password": "…"}`。返回 `204`，其他设备上的会话全部失效。密码由 `SANI_PASSWORD` 管理时返回 `409`。

密码替换与会话撤销在同一事务中完成；撤销失败时密码也不会改变。并发改密已使 `current` 失效时返回 `400 wrong_password`。

`POST /api/admin/v1/sessions/revoke`

让当前会话以外的所有会话失效，返回 `204`。

## 跳转 {#redirects}

这些路径不在 `/api/` 下，也不需要认证。

`GET /{slug}`

- 按链接设置的状态码跳转，`Location` 响应头是目标网址。非 ASCII 的域名会转换为 Punycode，其他非 ASCII 字符按百分号编码。
- 设置有效期或访问上限的跳转（301、302、307、308）带 `Cache-Control: no-store`。未设置这两项限制时，临时跳转（302、307）带 `Cache-Control: private, max-age=0`；永久跳转（301、308）带 `Cache-Control: public, max-age=86400`，允许浏览器缓存一天，期间计数和修改无法影响未回源的请求。参见 [CDN 缓存配置](../guide/deploy#cdn-cache)。
- 短码不存在时返回 `404`，链接停用、过期或访问次数用完时返回 `410`，都是按访问者语言显示的简单 HTML 页面。
- 只接受 `GET` 和 `HEAD`，其他方法返回 `405`。
- 文本和文件在这个路径下返回 `404`，它们在 `/p/` 下。

`GET /p/{slug}`

- 显示文本（经过转义，按访问者语言显示界面）的页面，或者介绍文件、带下载按钮的页面。`404` 和 `410` 与跳转相同。
- 打开文本页面计为一次访问；文件页面不计，下载才计。
- 页面里唯一的脚本是复制按钮，内容安全策略按哈希放行它。

文件域名上：

- `GET /{slug}` 把文本作为 `text/plain` 返回，把文件作为附件返回；`GET /{slug}/{name}` 一律作为下载，文本的文件名是 `{slug}.txt`。文件支持 `Range` 请求，`ETag` 是它的 SHA-256。
- 所有响应都在沙箱里，不能被其他网站嵌入或放进框架，也不会被缓存和收录。`robots.txt` 拒绝所有爬虫，其他路径一律 `404`。
- 成功开始返回内容的 `200`/`206` GET 请求每次计一次，所有 Range 请求（包括续传）以及 `curl`、`wget` 都一样；爬虫、链接预览、预取、`HEAD`、`304`/`412`/`416` 和读取失败不计数。达到访问上限返回 `410`，网络中断不退次数。
- 已经有 32 个下载在进行时，新的下载返回 `503` 和 `Retry-After`，不计入访问。

`GET /healthz`

返回 `200` 和 `ok`，用于健康检查。

## 错误码 {#errors}

| 错误码 | 状态码 | 含义 |
|---|---|---|
| `unsupported_parameter` | 400 | 参数不在兼容范围，未执行写入。 |
| `invalid_parameter` | 400 | 参数类型、空值、范围或查询参数不合法。 |
| `domain_invalid` | 400 | 域名与实例主域名不符。 |
| `domain_unconfigured` | 503 | 请先配置实例基础域名。 |
| `content_type` | 415 | 兼容 JSON 请求须使用 application/json。 |
| `unsupported_endpoint` | 501 | 接口不在兼容范围。 |
| `bad_json` | 400 | 请求体不是合法的 JSON 对象 |
| `cursor_invalid` | 400 | 分页游标无效 |
| `url_required` | 400 | 缺少目标网址 |
| `url_invalid` | 400 | 目标网址无效 |
| `url_too_long` | 400 | 目标网址超过 8,192 字节 |
| `url_scheme` | 400 | 不允许的网址类型，比如 `javascript:` |
| `url_self` | 400 | 目标网址是本站的一条短链接 |
| `slug_invalid` | 400 | 短码包含不支持的字符，或者修改时传了空短码 |
| `slug_too_long` | 400 | 短码超过 64 个字符 |
| `slug_reserved` | 400 | 短码被系统保留 |
| `expires_invalid` | 400 | `expiresAt` 格式非法或超出 UTC 支持范围；导入时作为跳过原因返回 |
| `expires_past` | 400 | `expiresAt` 早于当前时间 |
| `max_clicks_invalid` | 400 | `maxClicks` 不是 0 到 10¹² 之间的整数 |
| `redirect_invalid` | 400 | `redirect` 不是 301、302、307 或 308 |
| `text_required` | 400 | 缺少文本，或者文本只有空白 |
| `format_invalid` | 400 | `format` 不是 `plain` 或 `code` |
| `kind_mismatch` | 400 | 字段不适用于这种链接，比如给文本传 `url`，或者对分享重新获取标题 |
| `file_required` | 400 | 上传里没有 `file` 部分，或者文件是空的 |
| `upload_invalid` | 400 | 上传不是格式正确的 `multipart/form-data`、包含多个文件，或者某个字段超过 4 KB |
| `bulk_invalid` | 400 | 批量修改的 `action` 不认识，或者 `ids` 不是 1 到 500 条 |
| `base_url_invalid` | 400 | 域名格式不对，应该形如 `https://s.example.com` |
| `name_invalid` | 400 | 令牌名称为空，或者超过 60 个字符 |
| `password_short` | 400 | 密码少于 8 个 Unicode 码点 |
| `password_long` | 400 | 密码超过 1,024 字节 |
| `import_unreadable` | 400 | 导入的文件无法解析 |
| `import_too_many` | 400 | 一次导入超过 100,000 条 |
| `wrong_password` | 400, 401 | 登录密码错误或首次设置、登录过程中密码已被替换为 401；修改密码时当前密码错误或已被替换为 400 |
| `unauthorized` | 401 | 没有登录，也没有提供有效的令牌 |
| `cross_origin` | 403 | 浏览器从其他网站发来的请求 |
| `setup_code` | 403 | 设置码错误 |
| `not_found` | 404 | 链接、令牌或接口不存在，或者删除的链接已经无法恢复 |
| `slug_taken` | 409 | 短码已被占用 |
| `already_setup` | 409 | 已经设置过密码 |
| `needs_setup` | 409 | 还没有设置密码，无法登录 |
| `password_env` | 409 | 密码由 `SANI_PASSWORD` 管理，不能通过 API 修改 |
| `base_url_env` | 409 | 短链接域名由 `SANI_BASE_URL` 固定，不能通过 API 修改 |
| `files_disabled` | 409 | 没有设置文件域名，不能分享文件 |
| `too_large` | 413 | 请求体超过[上限](#conventions)，比如导入的文件超过 32 MB |
| `text_too_large` | 413 | 文本超过 1 MB |
| `config_env` | 409 | 设置由环境变量固定 |
| `config_invalid` | 400 | 创建默认值不合法 |
| `proxy_missing` | 409 | 未配置专用代理 |
| `proxy_password_required` | 400 | 更换代理或账号后需重新输入密码 |
| `proxy_test_failed` | 502 | 无法通过代理获取测试页面 |
| `tag_taken` | 409 | 标签名称已存在 |
| `upload_limit` | 429 | 待完成上传超过额度 |
| `upload_not_found` | 404 | 上传会话不可用或过期 |
| `upload_busy` | 409 | 上传正在进行其他操作 |
| `upload_offset` | 409 | 偏移或重复分片内容不符 |
| `upload_incomplete` | 409 | 文件尚未上传完整 |
| `file_too_large` | 413 | 文件超过当前有效配置上限 |
| `rate_limited` | 429 | 失败次数太多，按 `Retry-After` 等待后再试 |
| `internal` | 500 | 服务端出错，详情见服务器日志 |
| `tags_invalid` | 400 | 标签名称、颜色、ID 数组或筛选参数不合法 |
| `tag_limit` | 409 | 标签目录已达到 1,000 个；使用已有标签 |
