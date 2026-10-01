# HTTP API

<p class="lead">管理界面能做的每一件事，都是通过这套 JSON API 完成的。所以界面能做的，脚本也都能做。</p>

## 约定 {#conventions}

- **地址**：所有接口都在 `/api/` 下，请求和响应都是 UTF-8 编码的 JSON。
- **认证**：除了登录和首次设置相关的接口，都需要认证。脚本使用 API 令牌，放在 `Authorization: Bearer sani_…` 或 `X-Api-Key: sani_…` 请求头里；管理界面使用会话 Cookie。令牌在设置 → API 令牌里创建，拥有完整权限。
- **跨站请求**：浏览器从其他网站发来的请求会被拒绝，判断依据是浏览器自动附带的 `Sec-Fetch-Site` 和 `Origin` 请求头。脚本和命令行工具不带这些请求头，不受影响。
- **时间**：RFC 3339 格式的 UTC 时间，比如 `2026-09-28T09:30:00Z`。
- **大小**：请求体最大 1 MB。创建和修改链接的请求最大 8 MB，这样即使 JSON 转义了很多字符，1 MB 上限的文本也放得下；导入接口最大 32 MB；上传文件时，上限是[文件大小上限](./configuration#sani-max-file-mb)再加上 1 MB 的表单开销。
- **缓存**：所有响应都带 `Cache-Control: no-store`。
- **错误**：出错时返回对应的 HTTP 状态码和下面这个结构。`code` 是稳定的，程序应该根据它判断；`message` 是给人看的英文说明，以后可能调整。全部错误码见[错误码](#errors)。

```json
{ "error": { "code": "slug_taken", "message": "this slug is already in use" } }
```

一个完整的请求：

```sh
curl https://s.example.com/api/links \
  -H "Authorization: Bearer $SANI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/launch", "slug": "launch"}'
```

## 接口一览 {#index}

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/links` | [列出链接](#list) |
| `POST` | `/api/links` | [创建链接](#create) |
| `POST` | `/api/links/bulk` | [批量修改链接](#bulk) |
| `GET` | `/api/links/{id}` | [读取一条链接](#get) |
| `PATCH` | `/api/links/{id}` | [修改链接](#update) |
| `DELETE` | `/api/links/{id}` | [删除链接](#delete) |
| `POST` | `/api/links/{id}/restore` | [恢复刚删除的链接](#restore) |
| `POST` | `/api/links/{id}/refresh` | [重新获取标题和图标](#refresh) |
| `GET` | `/api/links/{id}/stats` | [一条链接的统计](#stats) |
| `POST` | `/api/texts` | [分享文本](#create-text) |
| `POST` | `/api/files` | [分享文件](#create-file) |
| `GET` | `/api/links/{id}/text` | [读取分享的文本](#read-text) |
| `GET` | `/api/slugs/{slug}` | [检查短码是否可用](#slug-check) |
| `GET` | `/api/overview` | [全部链接的概览](#overview) |
| `GET` | `/api/favicons/{host}` | [网站图标](#favicons) |
| `GET` | `/api/export` | [导出全部链接](#export) |
| `POST` | `/api/import` | [导入链接](#import) |
| `GET` | `/api/config` | [读取设置](#config) |
| `PATCH` | `/api/config` | [修改短链接域名](#config) |
| `GET` | `/api/tokens` | [列出 API 令牌](#tokens) |
| `POST` | `/api/tokens` | [创建 API 令牌](#tokens) |
| `DELETE` | `/api/tokens/{id}` | [撤销 API 令牌](#tokens) |
| `GET` | `/api/session` | [登录状态](#session) |
| `POST` | `/api/session` | [登录](#session) |
| `DELETE` | `/api/session` | [退出登录](#session) |
| `POST` | `/api/setup` | [首次设置密码](#session) |
| `PUT` | `/api/password` | [修改密码](#password) |
| `POST` | `/api/sessions/revoke` | [让其他设备退出登录](#password) |

## 链接 {#links}

### 链接对象 {#link-object}

```json
{
  "id": 12,
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
| `content` | 文本或文件分享的内容，见[下文](#shares)；短链接为 `null`。 |
| `slug` | 短码，保留创建时的大小写。查找时不区分大小写。 |
| `shortUrl` | 完整的短链接，文本和文件的短码前面多一段 `/p/`。域名的来源见[部署](../guide/deploy#domain)。 |
| `url` | 规范化之后的目标网址。文本和文件为空字符串。 |
| `host` | 目标网址的域名，去掉了 `www.`。`mailto:` 这类没有域名的网址为空字符串。 |
| `title` | 标题，没有时为空字符串。 |
| `meta` | 标题的来源：`pending` 正在获取，`ok` 从网页获取，`failed` 没有获取到，`manual` 由你设置，以后不会被自动覆盖。 |
| `icon` | 是否保存了网站图标，图标从 [`/api/favicons/{host}`](#favicons) 获取。 |
| `redirect` | 跳转使用的状态码：301、302、307 或 308。 |
| `status` | `active` 正常，`disabled` 已停用，`expired` 已过期，`exhausted` 访问次数已用完。 |
| `expiresAt`、`maxClicks` | 过期时间和访问上限，没有设置时为 `null`。 |
| `clicks` | 总点击数，包含还在内存里、尚未写入数据库的点击。 |
| `lastClickAt` | 最近一次计入统计的访问，没有时为 `null`。 |

### 创建链接 {#create}

`POST /api/links`

只有 `url` 是必填的。

| 字段 | 说明 |
|---|---|
| `url` | 目标网址。`example.com/a` 会补全为 `https://example.com/a`，`localhost` 和 IP 地址补全为 `http://`；域名转为小写，空格转为 `%20`；最长 8,192 字节。`javascript:`、`data:`、`file:` 等 13 种危险的网址类型会被拒绝，也不能指向本站的另一条短链接。`mailto:`、`tel:` 这类网址是允许的。 |
| `slug` | 短码，规则见[日常使用](../guide/usage#slugs)。开头的 `/` 会被去掉。不填或为空时自动生成。 |
| `title` | 标题，连续的空白会合并，超过 300 个字符会被截断。不填时在后台自动获取。 |
| `expiresAt` | 过期时间，必须晚于现在。`null` 表示永久有效。 |
| `maxClicks` | 访问上限，非负整数，`0` 或 `null` 表示不限。 |
| `redirect` | `302`（默认）、`301`、`307` 或 `308`。 |
| `enabled` | 默认 `true`。 |
| `reuse` | 设为 `true`，并且没有指定短码、过期时间、访问上限和跳转方式时，如果已经有一条指向同一网址的普通链接（启用、没有过期时间、没有访问上限、302 跳转），就直接返回它，状态码为 `200`，并带上 `"reused": true`。书签小工具和手机分享用的就是它。 |

成功时返回 `201` 和新建的[链接对象](#link-object)。

### 列出链接 {#list}

`GET /api/links`

| 参数 | 说明 |
|---|---|
| `q` | 按短码、标题、目标网址、文件名和文本的第一行搜索。也可以直接传完整的短链接。 |
| `kind` | 只返回这一[类型](#link-object)的链接：`url`、`text` 或 `file`。 |
| `sort` | `created`（默认，最近创建）、`clicks`（点击最多）或 `visited`（最近访问）。 |
| `limit` | 每页数量，1 到 200，默认 50。 |
| `cursor` | 上一页返回的 `next`。 |

```json
{ "items": [ … ], "next": "kx3f2a.c", "total": 128 }
```

- `items` 中的每一项都是[链接对象](#link-object)，另外带有 `spark` 字段：最近 14 天每天的点击数，从早到晚排列。14 天里没有点击的链接没有这个字段。
- `next` 是下一页的游标，最后一页为 `null`。
- `total` 是符合搜索条件的链接总数。

### 读取一条链接 {#get}

`GET /api/links/{id}`

返回[链接对象](#link-object)。

### 修改链接 {#update}

`PATCH /api/links/{id}`

接受创建时除 `reuse` 以外的全部字段，只修改请求里出现的字段：

- `expiresAt` 或 `maxClicks` 传 `null`，表示清除；
- `title` 传空字符串，表示重新自动获取标题；
- 修改 `url` 时，如果原来的标题是自动获取的，会重新获取；
- 修改 `slug` 后，旧短码立即失效；
- 对于文本，`text` 和 `format` 替换它的内容和格式。

文本和文件没有 `url` 和 `redirect`；`text` 和 `format` 只属于文本。把它们发给别的类型的链接，会得到 `kind_mismatch`。文件的内容不能替换，需要的话重新分享一个。修改在下一次访问时就会生效。返回修改后的[链接对象](#link-object)。

### 删除链接 {#delete}

`DELETE /api/links/{id}`

返回 `204`。链接立即停止跳转，但在一小时内可以恢复，之后连同统计一起被彻底清除。删除后，这个短码可以立即分配给新的链接。

### 恢复链接 {#restore}

`POST /api/links/{id}/restore`

撤销删除，返回恢复后的[链接对象](#link-object)。超过一小时，或者短码已经被新链接占用时，返回 `404`。

### 批量修改链接 {#bulk}

`POST /api/links/bulk`

在一个事务里启用、停用、删除或恢复多条链接：

```json
{ "action": "disable", "ids": [12, 15, 31] }
```

- `action` 是 `enable`、`disable`、`delete` 或 `restore` 之一，`ids` 列出 1 到 500 条链接。
- 返回 `{"items": [...]}`：发生了变化的[链接](#link-object)。`delete` 返回删除之前的样子，其他操作返回修改之后的样子。不存在的 id、本来就处在目标状态的链接，以及[已经无法恢复](#restore)的链接都不会出现在里面，所以列表可能比 `ids` 短。
- 删除的链接在一小时内可以恢复，和[单条删除](#delete)一样。

### 重新获取标题和图标 {#refresh}

`POST /api/links/{id}/refresh`

重新获取目标网页的标题和网站图标，等获取完成后返回[链接对象](#link-object)，可能需要几秒钟。你自己设置的标题会保留。文本和文件没有网页可以获取，会得到 `kind_mismatch`。

### 统计 {#stats}

`GET /api/links/{id}/stats`

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

`GET /api/slugs/{slug}`

检查短码能不能用：

```json
{ "available": false, "reason": "slug_taken" }
```

`reason` 可能是 `slug_taken`、`slug_reserved`、`slug_invalid` 或 `slug_too_long`，可用时没有这个字段。

## 文本和文件 {#shares}

分享是一种不跳转、而是展示内容的链接：访问者在 `/p/{slug}` 打开它，原始内容从[文件域名](./configuration#sani-files-url)提供。分享和短链接共用同一套短码，`gh` 不能既是短链接又是分享。它们同样有 `title`、`enabled`、`expiresAt` 和 `maxClicks`，同样有[统计](#stats)；列表、删除、恢复和批量接口对它们一视同仁。分享没有列表可以翻，短码就是唯一的保护，所以自动生成的短码至少 10 位。

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

`POST /api/texts`

```json
{ "text": "server {\n    listen 443 ssl;\n}\n", "format": "code", "slug": "nginx-conf" }
```

`text` 必填，最多 1 MB 的 UTF-8 文本，不能只有空白，换行等内容按原样保存。`format` 默认 `plain`。`slug`、`title`、`expiresAt`、`maxClicks` 和 `enabled` 与[创建链接](#create)相同。成功时返回 `201` 和新建的[链接对象](#link-object)。

### 分享文件 {#create-file}

`POST /api/files`

请求体是 `multipart/form-data`：一个 `file` 部分，以及可选的 `slug`、`title`、`expiresAt`、`maxClicks` 和 `enabled` 字段，值是文本，含义与[创建链接](#create)相同：

```sh
curl https://s.example.com/api/files \
  -H "Authorization: Bearer $SANI_TOKEN" \
  -F file=@report.pdf -F maxClicks=10
```

- 文件不能为空，大小上限由 [`SANI_MAX_FILE_MB`](./configuration#sani-max-file-mb) 决定。文件边接收边写入磁盘，不会整个放进内存。
- 保留文件名，但去掉路径、控制字符和看不见的文字方向标记。
- 分享文件需要文件域名，没有设置时返回 `409 files_disabled`。

成功时返回 `201` 和新建的[链接对象](#link-object)。

### 读取分享的文本 {#read-text}

`GET /api/links/{id}/text`

返回 `{"text": "…"}`，即完整的文本内容，列表里不包含它。读取不计入访问。不是文本的链接返回 `404`。

## 概览 {#overview}

`GET /api/overview`

参数 `days` 与[统计](#stats)相同。

```json
{ "links": 128, "clicks": 6920, "today": 37, "days": [{ "date": "2026-08-31", "count": 212 }, …] }
```

## 网站图标 {#favicons}

`GET /api/favicons/{host}`

返回图标文件本身，没有图标时返回 `404`。`{host}` 就是[链接对象](#link-object)里的 `host`。图标来自第三方网站，所以返回时带有沙箱化的内容安全策略，即使是 SVG 也无法执行脚本。

## 导入与导出 {#import-export}

### 导出 {#export}

`GET /api/export`

以附件形式返回全部链接的 JSON，文件格式见[导入与导出](../guide/import-export#export)。加上 `?format=csv` 返回 CSV。

### 导入 {#import}

`POST /api/import`

请求体是文件本身，最大 32 MB，最多 100,000 条链接。支持的格式和规则见[导入与导出](../guide/import-export#import)。

```sh
curl https://s.example.com/api/import \
  -H "Authorization: Bearer $SANI_TOKEN" \
  --data-binary @shlink-export.json
```

```json
{ "created": 42, "skipped": [{ "row": 7, "reason": "url_invalid" }, { "slug": "blog", "reason": "slug_taken" }] }
```

`skipped` 中的 `row` 是文件里的第几条记录，从 1 开始；因为短码已被占用而跳过的，只有 `slug`。

## 设置 {#config}

`GET /api/config`

```json
{
  "version": "v0.3.0",
  "baseUrl": "https://s.example.com",
  "baseUrlSource": "env",
  "requestOrigin": "https://s.example.com",
  "slugLength": 5,
  "fetchMeta": true,
  "forwardQuery": true,
  "passwordFromEnv": false,
  "timezone": "Asia/Shanghai",
  "filesUrl": "https://f.example.com",
  "maxFileSize": 67108864,
  "maxTextSize": 1048576
}
```

`baseUrlSource` 表示短链接域名的来源：`env` 来自 `SANI_BASE_URL`，`setting` 来自设置页，`request` 来自当前请求的地址。`filesUrl` 是[文件域名](./configuration#sani-files-url)，没有设置时为 `null`；`maxFileSize` 和 `maxTextSize` 是文件和文本的大小上限，单位是字节。

`PATCH /api/config`

修改设置页里的短链接域名：

```json
{ "baseUrl": "https://s.example.com" }
```

传 `null` 或空字符串表示清除。短链接域名不能和文件域名相同。设置了 `SANI_BASE_URL` 时返回 `409`。成功时返回修改后的设置。

## API 令牌 {#tokens}

`GET /api/tokens`

返回 `{"items": [...]}`，即令牌列表，每一项形如 `{"id": 3, "name": "iPhone 快捷指令", "hint": "sani_Ab3d", "createdAt": "…", "usedAt": "…"}`。`hint` 是令牌的开头几个字符，方便辨认；`usedAt` 是最近一次使用的时间，精确到分钟，没用过时为 `null`。

`POST /api/tokens`

请求体为 `{"name": "iPhone 快捷指令"}`，名称 1 到 60 个字符。返回 `201`，响应里的 `token` 字段是令牌本身，**只在这时返回一次**。Sani 只保存它的哈希。

`DELETE /api/tokens/{id}`

撤销令牌，返回 `204`。

## 登录与会话 {#session}

这几个接口供管理界面使用，不需要认证。

`GET /api/session`

返回 `{"authenticated": false, "needsSetup": true}`：当前是否已登录，以及是否还没有设置密码。

`POST /api/setup`

首次设置密码，请求体为 `{"code": "k7m2-p9x4-hq3d", "password": "…"}`。`code` 是[启动日志里的设置码](../guide/deploy#first-password)，不区分大小写，空格和短横线会被忽略。成功后直接登录，返回 `{"authenticated": true}`。已经有密码时返回 `409`。

`POST /api/session`

登录，请求体为 `{"password": "…"}`。成功后设置会话 Cookie，返回 `{"authenticated": true}`。

`DELETE /api/session`

退出登录，返回 `204`。

登录和首次设置按客户端地址限流：15 分钟内失败 8 次后，在这 15 分钟结束前的请求都会返回 `429`，`Retry-After` 响应头和响应体里的 `retryAfter` 字段给出还要等待的秒数。

会话 Cookie 名为 `sani_session`，带有 `HttpOnly` 和 `SameSite=Strict`，只发送给 `/api/` 下的地址，有效期 30 天，使用时自动续期。

## 密码 {#password}

`PUT /api/password`

修改密码，请求体为 `{"current": "…", "password": "…"}`。返回 `204`，其他设备上的会话全部失效。密码由 `SANI_PASSWORD` 管理时返回 `409`。

`POST /api/sessions/revoke`

让当前会话以外的所有会话失效，返回 `204`。

## 跳转 {#redirects}

这些路径不在 `/api/` 下，也不需要认证。

`GET /{slug}`

- 按链接设置的状态码跳转，`Location` 响应头是目标网址。非 ASCII 的域名会转换为 Punycode，其他非 ASCII 字符按百分号编码。
- 临时跳转（302、307）带 `Cache-Control: private, max-age=0`，每次访问都会经过 Sani；永久跳转（301、308）带 `Cache-Control: public, max-age=86400`，浏览器最多缓存一天。
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
- 每次获取都计为一次访问，`curl` 和 `wget` 也算；续传、爬虫、链接预览和 `HEAD` 请求不算。达到访问上限的链接返回 `410`。
- 已经有 32 个下载在进行时，新的下载返回 `503` 和 `Retry-After`，不计入访问。

`GET /healthz`

返回 `200` 和 `ok`，用于健康检查。

## 错误码 {#errors}

| 错误码 | 状态码 | 含义 |
|---|---|---|
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
| `expires_invalid` | 400 | `expiresAt` 不是 RFC 3339 格式的时间 |
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
| `password_short` | 400 | 密码少于 8 个字符 |
| `password_long` | 400 | 密码超过 1,024 字节 |
| `import_unreadable` | 400 | 导入的文件无法解析 |
| `import_too_many` | 400 | 一次导入超过 100,000 条 |
| `wrong_password` | 400, 401 | 登录时密码错误为 401；修改密码时当前密码错误为 400 |
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
| `file_too_large` | 413 | 文件超过 `SANI_MAX_FILE_MB` 设置的上限 |
| `rate_limited` | 429 | 失败次数太多，按 `Retry-After` 等待后再试 |
| `internal` | 500 | 服务端出错，详情见服务器日志 |
