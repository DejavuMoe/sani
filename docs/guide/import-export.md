# 导入与导出

<p class="lead">短链接数据完全自主可控：支持一键完整导出，或从其他平台平滑迁入。导入过程安全可靠，不覆盖现有短码，跳过的数据均会明确标注原因。</p>

## 导出数据 {#export}

在后台 设置 → 数据 中选择“导出全部链接”，可导出 JSON 或 CSV 文件。亦可通过 API 调用：[`GET /api/export`](../reference/api#export)（加 `?format=csv` 导出 CSV）。注意：导出仅涵盖短链接，不含文本与分享文件（二进制内容需通过[完整备份](./operations#backup)留存）。

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

JSON 的每条链接可带 `tags: [{"name":"工作","color":"blue"}]`；CSV 的 `tags` 单元格保存同样的 JSON 数组。导入按规范化后的名称重建关联，不复用源实例的标签 ID；目标已有同名标签时沿用其名称与颜色。没有 `tags` 的旧文件仍可导入；其他服务的 JSON 名称数组（如 `["工作"]`）按蓝色标签导入。超过 5 项或包含非法名称、颜色的记录会报告 `tags_invalid` 并跳过。达到实例标签总数上限时，整次导入失败并回滚。没有关联链接的目录标签不会导出，完整数据库备份会保留它们。

导出文件包含各项配置与累计点击总量，**不包含**每日细分走势、来源排行、已删除历史、API 令牌与管理员密码。该文件专为跨平台迁移设计，不可替代[系统备份](./operations#backup)。

## 导入数据 {#import}

在后台 设置 → 数据 区域拖入或点击选取文件。亦可通过 API 调用：[`POST /api/import`](../reference/api#import)（请求体直传文件二进制流）。

系统自动识别文件内容格式，兼容以下数据源：

| 来源平台 | 格式规范 |
|---|---|
| Sani | 原生导出的 JSON 或 CSV |
| Shlink | 列表接口返回的 JSON（形如 `{"shortUrls": {"data": [...]}}`） |
| Sink | 导出的 JSON（形如 `{"links": [...]}`） |
| YOURLS、Kutt 等 | 带表头的 CSV（包含目标网址列） |
| 通用结构 | 标准 JSON 对象数组，或包含 `links`、`data`、`items`、`urls` 键的对象 |

### 字段映射规则

根据列名（或 JSON 字段名）自动适配字段，不区分大小写，空格与下划线等效：

| 映射字段 | 支持的字段名别名 |
|---|---|
| 目标网址（必填） | `url`、`longUrl`、`long_url`、`target`、`destination`、`original_url`、`link` |
| 短码 | `slug`、`shortCode`、`short_code`、`code`、`keyword`、`key`、`alias`、`address`、`custom_slug` |
| 标题 | `title`、`name`、`description` |
| 创建时间 | `createdAt`、`created_at`、`dateCreated`、`date_created`、`timestamp`、`created` |
| 点击量 | `clicks`、`visits`、`visitsCount`、`visits_count`、`visit_count`、`count` |
| 过期时间 | `expiresAt`、`expires_at`、`validUntil`、`valid_until`、`expiration`、`expires` |
| 访问上限 | `maxClicks`、`max_clicks`、`maxVisits`、`max_visits` |
| 重定向类型 | `redirect`（301、302、307 或 308） |
| 启用状态 | `enabled`（`true` 或 `false`） |

Shlink 的嵌套字段亦可自动提取，包括 `visitsSummary.total`、`meta.validUntil` 及 `meta.maxVisits`。

时间字段支持 RFC 3339（`2026-09-29T08:00:00Z`）、标准格式（`2026-09-29 08:00:00`、`2026-09-29`）及 Unix 时间戳（秒或毫秒）。未显式标注时区时按 UTC 解析。

### 导入校验规则

- **不覆盖现有短码**：与当前有效短码冲突的条目自动跳过，并列入跳过清单。
- **逐行合规校验**：网址或短码不合规的数据行自动跳过，明确提示行号及原因。
- **缺失短码自动生成**：未提供短码的记录会自动生成一个随机短码（长度比默认规则多 1 位以防碰撞）。
- **标题保护**：文件内若有标题则直接持久化且不再自动覆盖。无标题项导入时不会自动发起网络抓取（避免瞬时向外发出海量请求）；如需获取，可在详情页手动点击“重新获取标题”。
- **历史点击处理**：导入的点击量直接累加至总点击数；因无历史日期与来源细分，不体现在每日走势图表中。
- **时间合法性**：晚于当前时间的创建时间会被自动忽略。
- **规格限制**：文件上限 32 MB，单次最多导入 100,000 条记录。

导入执行完毕后，界面将反馈成功导入数与跳过行明细。通过 API 导入时的响应结构如下：

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
