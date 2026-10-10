# 导入与导出

<p class="lead">短链接数据完全自主可控：支持导出网址链接，或从其他平台平滑迁入。导入过程安全可靠，不覆盖现有短码，跳过的数据均会明确标注原因。</p>

## 导出数据 {#export}

在后台 设置 → 数据 中选择“导出全部链接”，可导出 JSON 或 CSV 文件。亦可通过 API 调用：[`GET /api/admin/v1/export`](../reference/api#export)（加 `?format=csv` 导出 CSV）。注意：导出仅涵盖短链接，不含文本与分享文件（二进制内容需通过[完整备份](./operations#backup)留存）。

导出的 JSON 数据结构如下（空字段自动省略）：

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

CSV 格式的列头依次为：`slug`、`url`、`title`、`redirect`、`enabled`、`expires_at`、`max_clicks`、`clicks`、`created_at` 和 `tags`。

CSV 导出会为可能被电子表格解释为公式的字段添加单引号前缀（包括以 `=`、`+`、`-`、`@` 或控制字符开头的字段）。重新导入 CSV 时，该前缀会作为原始数据保留；需要无损导出与迁移时请选择 JSON。

JSON 的每条链接可带 `tags: [{"name":"工作","color":"blue"}]`；CSV 的 `tags` 单元格保存同样的 JSON 数组。导入按规范化后的名称重建关联，不复用源实例的标签 ID；目标已有同名标签时沿用其名称与颜色。没有 `tags` 的旧文件仍可导入；Shlink 的 JSON 名称数组（如 `["工作"]`）按蓝色标签导入。超过 5 项或包含非法名称、颜色的记录会报告 `tags_invalid` 并跳过。达到实例标签总数上限时，整次导入失败并回滚。没有关联链接的目录标签不会导出，完整数据库备份会保留它们。

导出文件包含各项配置与累计点击总量，**不包含**每日细分走势、来源排行、已删除历史、API 令牌与管理员密码。该文件专为跨平台迁移设计，不可替代[系统备份](./operations#backup)。

## 导入数据 {#import}

在后台 设置 → 数据 区域拖入或点击选取文件。亦可通过 API 调用：[`POST /api/admin/v1/import`](../reference/api#import)（请求体直传文件二进制流）。

系统自动识别文件内容格式，兼容以下数据源：

| 来源平台 | 格式规范 |
|---|---|
| Sani | 原生导出的 JSON 或 CSV |
| Shlink | Web Client 原样导出的 `short_urls.csv`，或列表接口返回的 JSON（形如 `{"shortUrls": {"data": [...]}}`） |

仅支持 Sani 与 Shlink 格式。Sani JSON 必须包含 `app: "sani"`、`version: 1` 和 `links` 数组；Sani CSV 必须包含 `slug,url` 列。Shlink JSON 接受 `shortUrls.data` 或其中的数据数组，每条记录须含 `shortCode`、`longUrl`。无法识别的包装结构、重复 CSV 列和损坏 CSV 会在写入前整体拒绝；已识别文件中的非法记录仍按下述规则逐行跳过。

下载原生 [CSV 示例](/examples/sani.csv) 或 [JSON 示例](/examples/sani.json)，后台设置页也提供相同文件。其他应用请先对照示例转换格式。

自定义标签色使用六位 HEX（如 `#5872a5`），原有五种命名色仍可导入。

### 字段映射规则

根据列名（或 JSON 字段名）自动适配字段，不区分大小写，空格与下划线等效：

| 映射字段 | 支持的字段名别名 |
|---|---|
| 目标网址（必填） | `url`、`longUrl` |
| 短码 | `slug`、`shortCode` |
| 标题 | `title` |
| 创建时间 | `createdAt`、`created_at`、`dateCreated` |
| 点击量 | `clicks`、`visits`、`visitsCount` |
| 过期时间 | `expiresAt`、`expires_at`、`validUntil` |
| 访问上限 | `maxClicks`、`max_clicks`、`maxVisits` |
| 重定向类型 | `redirect`（301、302、307 或 308） |
| 启用状态 | `enabled`（`true` 或 `false`） |

Shlink 的嵌套字段亦可自动提取，包括 `visitsSummary.total`、`meta.validUntil` 及 `meta.maxVisits`。

Shlink CSV 通过 `shortCode`、`longUrl`、`shortUrl`、`domain` 列识别；其 `tags` 是以 `|` 分隔的标签名称（如 `blog|work`），空值表示无标签，可直接导入，无需预先改为 JSON 数组。每条最多 5 个标签、每个名称最多 24 个 Unicode 码点的限制仍然适用，非法行以 `tags_invalid` 跳过。Sani 自有 CSV 的标签仍使用 JSON 数组，不会把格式错误的 JSON 当作普通标签。

`shortCode` 保留为短码；`domain`、`shortUrl` 不会修改目标实例的域名，导入后的地址使用 Sani 配置的域名。Shlink CSV 没有导出的字段无法恢复：缺少启用状态、重定向类型、过期时间和访问上限时，分别使用启用、302、永不过期和不限次数。标签颜色默认蓝色；历史累计访问量保留，但没有每日和来源明细。导入前检查旧实例是否依赖这些未导出的限制。

时间字段支持 RFC 3339（`2026-09-29T08:00:00Z`）、标准格式（`2026-09-29 08:00:00`、`2026-09-29`）及 Unix 时间戳（秒或毫秒）。未显式标注时区时按 UTC 解析。

### 导入校验规则

- **不覆盖现有短码**：与当前有效短码冲突的条目自动跳过，并列入跳过清单。
- **逐行合规校验**：网址或短码不合规的数据行自动跳过，明确提示行号及原因。
- **缺失短码自动生成**：未提供短码的记录会自动生成一个随机短码（长度比默认规则多 1 位以防碰撞）。
- **标题保护**：文件内若有标题则直接持久化且不再自动覆盖。无标题项导入时不会自动发起网络抓取（避免瞬时向外发出海量请求）；如需获取，可在详情页手动点击“重新获取标题”。
- **历史点击处理**：导入的点击量直接累加至总点击数；因无历史日期与来源细分，不体现在每日走势图表中。
- **时间合法性**：晚于当前时间的创建时间会被自动忽略。
- **过期时间**：按毫秒保存。非空值格式非法、早于 Unix 纪元或超出 UTC 年份 0000–9999 时，该行以 `expires_invalid` 跳过；Unix 秒转毫秒也检查溢出。空值和 `0` 表示永久有效，合法的历史过期时间会保留。请检查跳过清单，修正原文件后再导入。
- **计数上限**：单条链接与全局累计点击数以 `9223372036854775807`（int64 最大值）为上限。超大计数的求和与后续访问不会造成整数溢出；达到上限后仍可访问未设置次数限制的链接。
- **规格限制**：文件上限 32 MB，单次最多导入 100,000 条记录。

导入执行完毕后，界面将反馈成功导入数与跳过行明细，预览前 20 条，并可下载全部跳过记录的 JSON 文件。通过 API 导入时的响应结构如下：

```json
{
  "created": 42,
  "skipped": [
    { "row": 7, "reason": "url_invalid" },
    { "slug": "blog", "reason": "slug_taken" }
  ]
}
```

错误标识 `reason` 详见 [API 错误码](../reference/api#errors)。
