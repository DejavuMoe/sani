# 导入与导出

<p class="lead">链接是你的：可以随时全部导出，也可以从其他短链接服务搬过来。导入不会覆盖任何已有的短码，没能导入的每一行都会告诉你原因。</p>

## 导出 {#export}

在设置 → 数据里选择“导出全部链接”，可以得到 JSON 或 CSV 文件。也可以用 API：[`GET /api/export`](../reference/api#export)，加上 `?format=csv` 得到 CSV。导出只包含短链接，不包含分享的文本和文件；它们要靠[备份](./operations#backup)保存。

JSON 文件的结构如下，没有值的字段会省略：

```json
{
  "app": "sani",
  "version": 1,
  "exportedAt": "2026-09-29T08:00:00Z",
  "links": [
    {
      "slug": "gh",
      "url": "https://github.com/DejavuMoe/sani",
      "title": "DejavuMoe/sani",
      "redirect": 302,
      "enabled": true,
      "expiresAt": "2026-12-31T16:00:00Z",
      "maxClicks": 1000,
      "clicks": 2507,
      "createdAt": "2026-08-01T14:19:03.118Z"
    }
  ]
}
```

CSV 文件的列依次是 `slug`、`url`、`title`、`redirect`、`enabled`、`expires_at`、`max_clicks`、`clicks` 和 `created_at`。

导出文件包含每条链接的设置和总点击数，**不包含**每日统计、来源网站、已删除的链接、API 令牌和密码。它适合迁移链接，不能代替[备份](./operations#backup)。

## 导入 {#import}

在设置 → 数据里把文件拖进“导入链接”区域，或者点击选择文件。也可以用 API：[`POST /api/import`](../reference/api#import)，请求体就是文件本身。

Sani 根据文件内容判断格式，能识别这些文件：

| 来源 | 格式 |
|---|---|
| Sani | 自己导出的 JSON 或 CSV |
| Shlink | 短链接列表接口返回的 JSON：`{"shortUrls": {"data": [...]}}` |
| Sink | 导出的 JSON：`{"links": [...]}` |
| YOURLS、Kutt 等 | 带表头的 CSV，其中一列是目标网址 |
| 其他 | 由对象组成的 JSON 数组，或者把这样的数组放在 `links`、`data`、`items`、`urls` 字段里的 JSON 对象 |

### 字段对照

Sani 按列名（或 JSON 字段名）识别每个字段。列名不区分大小写，空格等同于下划线。

| 字段 | 可以使用的列名 |
|---|---|
| 目标网址（必需） | `url`、`longUrl`、`long_url`、`target`、`destination`、`original_url`、`link` |
| 短码 | `slug`、`shortCode`、`short_code`、`code`、`keyword`、`key`、`alias`、`address`、`custom_slug` |
| 标题 | `title`、`name`、`description` |
| 创建时间 | `createdAt`、`created_at`、`dateCreated`、`date_created`、`timestamp`、`created` |
| 点击数 | `clicks`、`visits`、`visitsCount`、`visits_count`、`visit_count`、`count` |
| 过期时间 | `expiresAt`、`expires_at`、`validUntil`、`valid_until`、`expiration`、`expires` |
| 访问上限 | `maxClicks`、`max_clicks`、`maxVisits`、`max_visits` |
| 跳转方式 | `redirect`（301、302、307 或 308） |
| 是否启用 | `enabled`（`true` 或 `false`） |

Shlink 把一些数据放在嵌套的对象里，`visitsSummary.total`、`meta.validUntil` 和 `meta.maxVisits` 也会被识别。

时间可以是 RFC 3339（`2026-09-29T08:00:00Z`）、`2026-09-29 08:00:00`、`2026-09-29`，或者 Unix 时间戳（秒或毫秒）。没有写时区的时间按 UTC 处理。

### 导入规则

- **不覆盖**：短码已经被占用的行会跳过，并列在结果里。
- **逐行检查**：网址或短码不合规的行会跳过，结果里注明行号和原因。
- **没有短码的行**：自动生成一个，比平时的长度多一位。
- **标题**：文件里有标题就用它，以后不会被自动覆盖。没有标题的链接不会自动去抓取，免得一次导入就向几千个网站发请求；需要的话，在详情里点“重新获取标题”。
- **点击数**：导入的点击数计入总点击，但没有每日分布和来源信息，所以不会出现在每日图表里。
- **创建时间**：晚于当前时间的创建时间会被忽略。
- **限制**：文件不超过 32 MB，一次最多导入 100,000 条链接。

导入完成后，会显示成功导入的数量和跳过的行。通过 API 导入时，返回的结果是这样的：

```json
{
  "created": 42,
  "skipped": [
    { "row": 7, "reason": "url_invalid" },
    { "slug": "blog", "reason": "slug_taken" }
  ]
}
```

`reason` 的含义见 [API 错误码](../reference/api#errors)。
