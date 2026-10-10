import type { HeadConfig, PageData } from 'vitepress';

export const siteUrl = 'https://sani.zsh.moe';
export const productDescription = {
  zh: 'Sani 是面向个人的自托管短链接、文本与文件分享服务。单个 Go 二进制内嵌管理界面，使用 SQLite 和本地文件存储，提供标签、链接有效期与访问次数限制和聚合点击统计。',
  en: 'Sani is a self-hosted URL shortener with text and file sharing for one administrator. One Go binary, SQLite and local files, with tags, link controls and aggregated click statistics.',
};

// Keep summaries specific to the documented page; the site-wide product
// description is only the home page's summary.
const descriptions: Record<string, { zh: string; en: string }> = {
  'guide/introduction': {
    zh: '了解 Sani 的短链接、文本与文件分享能力，以及单管理员、聚合统计和单实例部署的适用范围与设计取舍。',
    en: 'Explore Sani’s URL shortening, text and file sharing, and the limits of its single-admin, single-instance design and aggregated statistics.',
  },
  'guide/quick-start': {
    zh: '使用 Docker 或二进制文件在本地启动 Sani，通过设置码初始化管理员密码，并创建第一条短链接。',
    en: 'Run Sani locally with Docker or a binary, initialize the administrator password with the setup code, and create your first short link.',
  },
  'guide/deploy': {
    zh: '部署 Sani：生成 Docker Compose、systemd、Caddy 或 nginx 配置，设置 HTTPS、短链接域名与独立文件域名，并校验发布制品。',
    en: 'Deploy Sani with Docker Compose or systemd, configure HTTPS with Caddy or nginx, set a separate files domain, and verify release artifacts.',
  },
  'guide/operations': {
    zh: '维护 Sani 实例：区分数据库在线备份与完整停机备份，演练恢复和升级回退，管理密码、日志、健康检查与统计持久性。',
    en: 'Operate Sani: online database and complete stopped-service backups, restore and rollback, password resets, logs, health checks and click durability.',
  },
  'guide/usage': {
    zh: '使用 Sani 管理短链接、标签、文本和文件：自定义短码、过期与访问限制、批量操作、键盘快捷键、书签工具及手机分享。',
    en: 'Manage Sani links, tags, texts and files with custom slugs, expiry and visit limits, bulk actions, keyboard shortcuts, bookmarklets and phone sharing.',
  },
  'guide/statistics': {
    zh: '了解 Sani 点击统计口径：过滤规则、文件下载计数、每日趋势、来源网站、永久跳转缓存，以及异步刷盘与持久性限制。',
    en: 'Understand Sani click statistics: filtering, download counting, daily trends, referrers, permanent redirect caching and asynchronous persistence limits.',
  },
  'guide/import-export': {
    zh: '导入和导出 Sani 网址链接及标签：JSON、CSV 与其他短链接服务的字段映射、校验限制，以及导出与完整备份的区别。',
    en: 'Import and export Sani URL links and tags using JSON, CSV and other shortener formats. Learn field mappings, validation and why exports are not backups.',
  },
  'reference/configuration': {
    zh: 'Sani 环境变量参考：网络与存储、管理员凭据、代理信任、缓存、元数据抓取、文件域名、上传限制、日志和时区。',
    en: 'Sani environment variable reference for networking, storage, credentials, trusted proxies, caching, metadata, file sharing, logging and time zones.',
  },
  'reference/api-archive': {
    zh: 'Sani v0.9.4 及之前的 HTTP API 历史参考，升级后请使用新版 API。',
    en: 'Historical HTTP API reference for Sani v0.9.4 and earlier. Use the current API after upgrading.',
  },
  'reference/api': {
    zh: 'Sani HTTP API 参考：会话与令牌认证、短链接、标签、文本、文件、统计、设置、导入导出、请求限制与错误码。',
    en: 'Sani HTTP API reference: sessions and tokens, links, tags, texts, files, statistics, settings, imports and exports, request limits and error codes.',
  },
  'reference/cli': {
    zh: 'Sani 命令行参考：serve 启动服务、passwd 重置密码、backup 导出数据库、preflight 迁移预检、healthcheck 检查存活状态和 version 查看版本。',
    en: 'Sani command-line reference for serve, passwd, backup, preflight, healthcheck and version, including database-only backups and password reset behavior.',
  },
  'internals/architecture': {
    zh: '了解 Sani 的 Go 服务、路由、分片缓存、点击聚合、SQLite WAL 与迁移、后台任务和内嵌 Svelte 管理界面。',
    en: 'Understand Sani’s Go server, routing, sharded cache, click aggregation, SQLite WAL and migrations, background tasks and embedded Svelte admin app.',
  },
  'internals/performance': {
    zh: '查看 Sani 跳转负载测试、点击计数核对、微基准与容量测试的方法、测量环境和复现命令；测量结果不代表 SLA。',
    en: 'Review Sani redirect load tests, count consistency, microbenchmarks and capacity measurements, with environments and reproduction commands rather than an SLA.',
  },
  'internals/security': {
    zh: '了解 Sani 的设置码、密码与会话、CSRF 和 CSP、防 SSRF、独立文件域名、输入配额、安全边界及漏洞报告渠道。',
    en: 'Review Sani’s setup code, passwords and sessions, CSRF and CSP, SSRF defenses, files-domain isolation, input limits and vulnerability reporting.',
  },
  'project/progress': {
    zh: '查看 Sani 的已实现功能、验收入口、文档与源码一致性检查、工具链版本、后续计划和明确不包含的能力。',
    en: 'Track Sani’s implemented features, acceptance checks, documentation and source consistency, toolchain versions, planned work and non-goals.',
  },
  'project/changelog': {
    zh: 'Sani 更新日志：已发布版本与未发布变更、修复、功能、不兼容调整及数据库升级说明。',
    en: 'Sani changelog covering released and unreleased features, fixes, breaking changes and database upgrade instructions.',
  },
  'project/versioning': {
    zh: '了解 Sani 的语义化版本规则、0.x 兼容边界、API 与数据格式承诺、弃用策略和 1.0 发布验收条件。',
    en: 'Understand Sani’s semantic versioning, 0.x compatibility limits, API and data format promises, deprecation policy and acceptance gates for 1.0.',
  },
  'project/development': {
    zh: '参与 Sani 开发：工具链、项目结构、构建与测试命令、架构不变量、双语文档、截图和持续集成发布流程。',
    en: 'Contribute to Sani: toolchains, repository layout, build and test commands, architecture invariants, bilingual docs, screenshots and CI release workflow.',
  },
};

export function pageSeo(page: Pick<PageData, 'relativePath' | 'title' | 'titleTemplate'>): { description: string; head: HeadConfig[] } {
  const en = page.relativePath.startsWith('en/');
  const path = page.relativePath.replace(/^en\//, '').replace(/\.md$/, '');
  if (path === '404') return { description: '', head: [['meta', { name: 'robots', content: 'noindex, follow' }]] };
  const lang = en ? 'en' : 'zh';
  const description = (path === 'index' ? productDescription : descriptions[path])?.[lang];
  if (!description) throw new Error(`Missing SEO description: ${page.relativePath}`);
  const route = path === 'index' ? '' : path;
  const zhUrl = `${siteUrl}/${route}`;
  const enUrl = `${siteUrl}/en/${route}`;
  const url = en ? enUrl : zhUrl;
  // Match VitePress's titleTemplate handling, including disabled suffixes.
  const template = page.titleTemplate;
  const suffix = template === false || template === 'Sani' ? '' : ` | ${typeof template === 'string' ? template : 'Sani'}`;
  const title = typeof template === 'string' && template.includes(':title')
    ? template.replaceAll(':title', page.title)
    : page.title === suffix.slice(3) ? page.title : page.title + suffix;
  const image = `${siteUrl}/screenshots/dashboard-light-${lang}.png`;
  const imageAlt = en ? 'Sani admin dashboard with short links and click statistics' : 'Sani 管理界面：短链接列表与点击统计';
  return {
    description,
    head: [
      ['link', { rel: 'canonical', href: url }],
      ...[['zh-CN', zhUrl], ['en', enUrl], ['x-default', zhUrl]].map(([hreflang, href]): HeadConfig => ['link', { rel: 'alternate', hreflang, href }]),
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:locale', content: en ? 'en_US' : 'zh_CN' }],
      ['meta', { property: 'og:locale:alternate', content: en ? 'zh_CN' : 'en_US' }],
      ['meta', { property: 'og:image', content: image }],
      ['meta', { property: 'og:image:alt', content: imageAlt }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
      ['meta', { name: 'twitter:image', content: image }],
      ['meta', { name: 'twitter:image:alt', content: imageAlt }],
      ['script', { type: 'application/ld+json' }, JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: title,
        description,
        url,
        inLanguage: en ? 'en' : 'zh-CN',
        isPartOf: { '@type': 'WebSite', name: 'Sani', url: siteUrl + '/' },
      }).replace(/</g, '\\u003c')],
    ],
  };
}
