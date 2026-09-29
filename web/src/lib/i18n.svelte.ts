/*
 * Two languages, written natively rather than translated. Keys are grouped
 * by screen. English strings that depend on a count have ".one" / ".other"
 * variants; Chinese needs only one.
 */

const zh = {
  'app.name': 'Sani',
  'app.loading': '正在加载',

  'act.copy': '复制',
  'act.copied': '已复制',
  'act.open': '打开',
  'act.edit': '编辑',
  'act.save': '保存',
  'act.saving': '正在保存…',
  'act.cancel': '取消',
  'act.delete': '删除',
  'act.undo': '撤销',
  'act.close': '关闭',
  'act.retry': '重试',
  'act.back': '返回',
  'act.more': '更多',

  'auth.password': '密码',
  'auth.signIn': '登录',
  'auth.signingIn': '正在登录…',
  'auth.signOut': '退出登录',
  'auth.wrong': '密码不正确',
  'auth.rateLimited': '尝试次数太多了，请 {s} 秒后再试',
  'auth.expired': '登录已过期，请重新登录',
  'setup.title': '设置管理员密码',
  'setup.lead': '这是你的个人短链接服务。先输入启动日志里的设置码，再设置以后登录用的密码。',
  'setup.code': '设置码',
  'setup.codeHint': 'Sani 启动时会把它打印在日志里，例如 {cmd}',
  'setup.codeMissing': '请输入启动日志里的设置码',
  'setup.password': '密码',
  'setup.confirm': '再输入一次',
  'setup.short': '至少需要 8 个字符',
  'setup.mismatch': '两次输入的密码不一致',
  'setup.submit': '开始使用',

  'composer.label': '长链接',
  'composer.placeholder': '粘贴或输入长链接',
  'composer.submit': '缩短',
  'composer.slug': '短码',
  'composer.slugAuto': '自动生成',
  'composer.expiry': '有效期',
  'composer.more': '更多选项',
  'composer.less': '收起选项',
  'composer.title': '标题',
  'composer.titleAuto': '自动获取网页标题',
  'composer.maxClicks': '访问上限',
  'composer.noLimit': '不限',
  'composer.redirect': '跳转方式',
  'composer.pasted': '已粘贴，按 回车 缩短',
  'composer.dropped': '已放入链接，按 回车 缩短',

  'redirect.302': '临时',
  'redirect.301': '永久',
  'redirect.hint': '临时跳转可随时修改目标，并统计每一次访问；永久跳转会被浏览器缓存。',

  'created.copied': '已复制',
  'created.ready': '已创建',
  'created.existing': '这个页面缩短过，已找到原来的短链接',

  'slug.available': '可以使用',
  'slug.taken': '已被占用',
  'slug.reserved': '系统保留',
  'slug.invalid': '只能用字母、数字和 - _ .',
  'slug.tooLong': '最多 64 个字符',
  'slug.renameWarn': '保存后旧短码立即失效',

  'expiry.never': '永久有效',
  'expiry.1h': '1 小时',
  'expiry.1d': '1 天',
  'expiry.7d': '7 天',
  'expiry.30d': '30 天',
  'expiry.custom': '自定义时间…',
  'expiry.until': '至 {date}',

  'err.url_required': '请输入链接',
  'err.url_invalid': '这看起来不是有效的链接',
  'err.url_too_long': '链接太长了',
  'err.url_scheme': '不支持这类链接',
  'err.url_self': '短链接不能指向本站的另一个短链接',
  'err.slug_taken': '这个短码已被占用',
  'err.slug_reserved': '这个短码是系统保留的',
  'err.slug_invalid': '短码只能包含字母、数字和 - _ .',
  'err.slug_too_long': '短码最多 64 个字符',
  'err.expires_past': '过期时间需要晚于现在',
  'err.expires_invalid': '过期时间无效',
  'err.max_clicks_invalid': '请输入一个正整数',
  'err.redirect_invalid': '不支持这种跳转方式',
  'err.name_invalid': '请给令牌起个名字（最多 60 个字符）',
  'err.password_short': '至少需要 8 个字符',
  'err.setup_code': '设置码不对，请对照启动日志再试一次',
  'err.wrong_password': '当前密码不正确',
  'err.base_url_invalid': '请填写完整的地址，例如 https://s.example.com',
  'err.import_unreadable': '无法读取这个文件',
  'err.too_large': '文件太大了（上限 32 MB）',
  'err.network': '连不上服务器，请检查网络',
  'err.internal': '服务出了点问题，请稍后再试',
  'err.not_found': '这个链接已经不存在了',
  'err.unknown': '操作没有成功',

  'summary.links': '链接',
  'summary.clicks': '总点击',
  'summary.today': '今日',
  'summary.chart': '近 30 天每日点击',
  'summary.last30': '近 30 天',

  'list.label': '短链接列表',
  'list.search': '搜索短码、标题或链接',
  'list.col.link': '短链接',
  'list.col.target': '标题与目标',
  'list.col.activity': '近 14 天',
  'list.col.clicks': '点击',
  'list.col.created': '创建',
  'list.sortBy': '排序',
  'sort.created': '最近创建',
  'sort.clicks': '点击最多',
  'sort.visited': '最近访问',
  'list.results': '{n} 条结果',
  'list.emptyTitle': '还没有短链接',
  'list.emptyBody': '在上方粘贴一个长链接，按 {enter}，短链接就会生成并自动复制。',
  'list.emptyPaste': '也可以在页面任意位置直接按 {key} 粘贴。',
  'list.noResults': '没有与“{q}”相关的链接',
  'list.clearSearch': '清除搜索',
  'list.loading': '正在加载…',
  'list.loadError': '列表加载失败',
  'list.spark': '近 14 天共 {n} 次点击',
  'list.copyShort': '复制短链接',

  'status.disabled': '已停用',
  'status.expired': '已过期',
  'status.exhausted': '已达上限',

  'detail.clicks': '点击',
  'detail.today': '今天',
  'detail.lastVisit': '最近访问',
  'detail.never': '暂无',
  'detail.created': '创建于',
  'detail.expires': '有效期',
  'detail.limit': '访问上限',
  'detail.used': '已用 {n}/{max}',
  'detail.redirect': '跳转方式',
  'detail.destination': '目标链接',
  'detail.referrers': '来源',
  'detail.direct': '直接访问',
  'detail.otherSites': '其他来源',
  'detail.noVisits': '还没有访问记录',
  'detail.days': '{n} 天',
  'detail.chart': '每日点击',
  'detail.qr': '二维码',
  'detail.qrLabel': '{url} 的二维码',
  'detail.disable': '停用',
  'detail.enable': '启用',
  'detail.refetch': '重新获取标题',
  'detail.fetching': '正在获取标题…',
  'detail.enabled': '启用',
  'detail.enabledHint': '停用后访问会显示“链接已失效”',
  'detail.deleted': '已删除 {slug}',
  'detail.restored': '已恢复 {slug}',
  'detail.saved': '已保存',
  'detail.turnedOff': '已停用 {slug}',
  'detail.turnedOn': '已启用 {slug}',
  'detail.noTitle': '无标题',

  'chart.clicks': '{n} 次',
  'chart.table': '每日点击数据',
  'chart.date': '日期',

  'settings.title': '设置',
  'settings.appearance': '外观',
  'settings.theme': '主题',
  'theme.system': '跟随系统',
  'theme.light': '浅色',
  'theme.dark': '深色',
  'settings.language': '语言',
  'settings.domain': '短链接域名',
  'settings.domainHint': '生成短链接时使用的地址。留空则使用你当前访问的地址（{origin}）。',
  'settings.domainEnv': '已由环境变量 SANI_BASE_URL 固定为 {url}',
  'settings.domainSaved': '已更新短链接域名',
  'settings.tokens': 'API 令牌',
  'settings.tokensHint': '供脚本、快捷指令和浏览器扩展使用。令牌拥有完整权限，修改密码后依然有效，不再使用时请删除。',
  'settings.tokenName': '令牌名称',
  'settings.tokenNamePlaceholder': '例如：iPhone 快捷指令',
  'settings.tokenCreate': '创建令牌',
  'settings.tokenOnce': '请现在复制保存，它只会显示这一次。',
  'settings.tokensEmpty': '还没有创建令牌',
  'settings.tokenUsed': '{time}使用过',
  'settings.tokenUnused': '从未使用',
  'settings.tokenRevoke': '撤销',
  'settings.tokenConfirm': '确认撤销',
  'settings.tokenRevoked': '已撤销令牌“{name}”',
  'settings.tokenExample': '用法示例',
  'settings.tools': '快捷方式',
  'settings.bookmarklet': '书签小工具',
  'settings.bookmarkletHint': '把按钮拖到浏览器的书签栏。以后在任何网页上点它，就能缩短当前页面。',
  'settings.bookmarkletButton': '缩短此页',
  'settings.bookmarkletDrag': '请把它拖到书签栏，而不是点击',
  'settings.install': '添加到主屏幕',
  'settings.installHint': '在手机浏览器中把 Sani 添加到主屏幕。在 Android 上，之后可以从任意应用的“分享”菜单直接缩短链接。',
  'settings.data': '数据',
  'settings.export': '导出全部链接',
  'settings.exportHint': '包含每条链接的设置与点击总数。',
  'settings.import': '导入链接',
  'settings.importHint': '支持 Sani、Shlink、Sink、YOURLS 导出的 JSON 或 CSV。已存在的短码会被跳过。',
  'settings.importDrop': '拖入文件，或点击选择',
  'settings.importing': '正在导入…',
  'settings.imported': '导入了 {n} 条链接',
  'settings.importSkipped': '跳过 {n} 条：',
  'settings.account': '账户与安全',
  'settings.passwordChange': '修改密码',
  'settings.passwordCurrent': '当前密码',
  'settings.passwordNew': '新密码',
  'settings.passwordEnv': '密码由环境变量 SANI_PASSWORD 管理，无法在这里修改。',
  'settings.passwordChanged': '密码已更新，其他设备已退出登录',
  'settings.sessionsRevoke': '退出其他设备',
  'settings.sessionsRevoked': '其他设备已退出登录',
  'settings.about': '关于',
  'settings.version': '版本',
  'settings.timezone': '统计时区',

  'reason.slug_taken': '短码已存在',
  'reason.url_invalid': '链接无效',
  'reason.url_scheme': '不支持的链接',
  'reason.url_required': '缺少链接',
  'reason.url_too_long': '链接过长',
  'reason.url_self': '指向本站',
  'reason.slug_invalid': '短码无效',
  'reason.slug_reserved': '短码保留',
  'reason.slug_too_long': '短码过长',
  'reason.row': '第 {n} 行',

  'keys.title': '键盘快捷键',
  'keys.new': '新建短链接',
  'keys.search': '搜索',
  'keys.paste': '在任意位置粘贴链接',
  'keys.move': '上下选择',
  'keys.toggle': '展开或收起详情',
  'keys.copy': '复制短链接',
  'keys.edit': '编辑',
  'keys.delete': '删除（可撤销）',
  'keys.escape': '收起 / 清除',
  'keys.help': '显示快捷键',
  'keys.save': '保存修改',

  'menu.label': '菜单',
  'menu.settings': '设置',
  'menu.shortcuts': '快捷键',
  'menu.theme': '主题',
  'menu.language': 'English',

  'new.title': '缩短此页',
  'new.closeWindow': '关闭窗口',
  'new.creating': '正在生成…',
};

type Key = keyof typeof zh;

const en: Record<Key, string> & Record<string, string> = {
  'app.name': 'Sani',
  'app.loading': 'Loading',

  'act.copy': 'Copy',
  'act.copied': 'Copied',
  'act.open': 'Open',
  'act.edit': 'Edit',
  'act.save': 'Save',
  'act.saving': 'Saving…',
  'act.cancel': 'Cancel',
  'act.delete': 'Delete',
  'act.undo': 'Undo',
  'act.close': 'Close',
  'act.retry': 'Retry',
  'act.back': 'Back',
  'act.more': 'More',

  'auth.password': 'Password',
  'auth.signIn': 'Sign in',
  'auth.signingIn': 'Signing in…',
  'auth.signOut': 'Sign out',
  'auth.wrong': 'That password isn’t right',
  'auth.rateLimited': 'Too many attempts. Try again in {s}s',
  'auth.expired': 'Your session ended. Sign in again.',
  'setup.title': 'Set an admin password',
  'setup.lead': 'This is your own link shortener. Enter the setup code from the server log, then choose the password you’ll sign in with.',
  'setup.code': 'Setup code',
  'setup.codeHint': 'Sani prints it to the log when it starts. Try {cmd}',
  'setup.codeMissing': 'Enter the setup code from the server log',
  'setup.password': 'Password',
  'setup.confirm': 'Repeat it',
  'setup.short': 'Use at least 8 characters',
  'setup.mismatch': 'The passwords don’t match',
  'setup.submit': 'Get started',

  'composer.label': 'Long URL',
  'composer.placeholder': 'Paste or type a long URL',
  'composer.submit': 'Shorten',
  'composer.slug': 'Slug',
  'composer.slugAuto': 'automatic',
  'composer.expiry': 'Expires',
  'composer.more': 'More options',
  'composer.less': 'Fewer options',
  'composer.title': 'Title',
  'composer.titleAuto': 'Fetched from the page',
  'composer.maxClicks': 'Visit limit',
  'composer.noLimit': 'None',
  'composer.redirect': 'Redirect',
  'composer.pasted': 'Pasted — press Enter to shorten',
  'composer.dropped': 'Dropped — press Enter to shorten',

  'redirect.302': 'Temporary',
  'redirect.301': 'Permanent',
  'redirect.hint': 'Temporary redirects can be edited later and count every visit. Browsers cache permanent ones.',

  'created.copied': 'Copied',
  'created.ready': 'Created',
  'created.existing': 'You’ve shortened this page before — here’s that link',

  'slug.available': 'Available',
  'slug.taken': 'Taken',
  'slug.reserved': 'Reserved',
  'slug.invalid': 'Letters, numbers and - _ . only',
  'slug.tooLong': '64 characters at most',
  'slug.renameWarn': 'The old slug stops working once you save',

  'expiry.never': 'Never',
  'expiry.1h': '1 hour',
  'expiry.1d': '1 day',
  'expiry.7d': '7 days',
  'expiry.30d': '30 days',
  'expiry.custom': 'Pick a time…',
  'expiry.until': 'Until {date}',

  'err.url_required': 'Enter a URL',
  'err.url_invalid': 'That doesn’t look like a valid URL',
  'err.url_too_long': 'That URL is too long',
  'err.url_scheme': 'This kind of link isn’t allowed',
  'err.url_self': 'A short link can’t point to another short link here',
  'err.slug_taken': 'That slug is taken',
  'err.slug_reserved': 'That slug is reserved',
  'err.slug_invalid': 'Slugs can use letters, numbers and - _ .',
  'err.slug_too_long': 'Slugs are 64 characters at most',
  'err.expires_past': 'Pick a time in the future',
  'err.expires_invalid': 'That date isn’t valid',
  'err.max_clicks_invalid': 'Enter a whole number',
  'err.redirect_invalid': 'That redirect type isn’t supported',
  'err.name_invalid': 'Give the token a name (60 characters at most)',
  'err.password_short': 'Use at least 8 characters',
  'err.setup_code': 'That setup code isn’t right. Check the server log.',
  'err.wrong_password': 'The current password isn’t right',
  'err.base_url_invalid': 'Use a full address such as https://s.example.com',
  'err.import_unreadable': 'That file couldn’t be read',
  'err.too_large': 'That file is too large (32 MB max)',
  'err.network': 'Can’t reach the server. Check your connection.',
  'err.internal': 'Something went wrong on the server. Try again.',
  'err.not_found': 'That link no longer exists',
  'err.unknown': 'That didn’t work',

  'summary.links': 'Links',
  'summary.clicks': 'Clicks',
  'summary.today': 'Today',
  'summary.chart': 'Daily clicks, last 30 days',
  'summary.last30': 'Last 30 days',

  'list.label': 'Short links',
  'list.search': 'Search slugs, titles, URLs',
  'list.col.link': 'Short link',
  'list.col.target': 'Title and destination',
  'list.col.activity': '14 days',
  'list.col.clicks': 'Clicks',
  'list.col.created': 'Created',
  'list.sortBy': 'Sort',
  'sort.created': 'Newest',
  'sort.clicks': 'Most clicked',
  'sort.visited': 'Last visited',
  'list.results.one': '1 result',
  'list.results.other': '{n} results',
  'list.results': '{n} results',
  'list.emptyTitle': 'No links yet',
  'list.emptyBody': 'Paste a long URL above and press {enter}. The short link is created and copied for you.',
  'list.emptyPaste': 'You can also press {key} anywhere on the page.',
  'list.noResults': 'Nothing matches “{q}”',
  'list.clearSearch': 'Clear search',
  'list.loading': 'Loading…',
  'list.loadError': 'The list didn’t load',
  'list.spark.one': '1 click in the last 14 days',
  'list.spark.other': '{n} clicks in the last 14 days',
  'list.spark': '{n} clicks in the last 14 days',
  'list.copyShort': 'Copy short link',

  'status.disabled': 'Off',
  'status.expired': 'Expired',
  'status.exhausted': 'Limit reached',

  'detail.clicks': 'Clicks',
  'detail.today': 'Today',
  'detail.lastVisit': 'Last visit',
  'detail.never': 'None yet',
  'detail.created': 'Created',
  'detail.expires': 'Expires',
  'detail.limit': 'Visit limit',
  'detail.used': '{n} of {max} used',
  'detail.redirect': 'Redirect',
  'detail.destination': 'Destination',
  'detail.referrers': 'Referrers',
  'detail.direct': 'Direct',
  'detail.otherSites': 'Other sites',
  'detail.noVisits': 'No visits yet',
  'detail.days': '{n} days',
  'detail.chart': 'Daily clicks',
  'detail.qr': 'QR code',
  'detail.qrLabel': 'QR code for {url}',
  'detail.disable': 'Turn off',
  'detail.enable': 'Turn on',
  'detail.refetch': 'Refetch title',
  'detail.fetching': 'Fetching title…',
  'detail.enabled': 'On',
  'detail.enabledHint': 'Visitors see “no longer available” while it’s off',
  'detail.deleted': 'Deleted {slug}',
  'detail.restored': 'Restored {slug}',
  'detail.saved': 'Saved',
  'detail.turnedOff': 'Turned off {slug}',
  'detail.turnedOn': 'Turned on {slug}',
  'detail.noTitle': 'Untitled',

  'chart.clicks.one': '1 click',
  'chart.clicks.other': '{n} clicks',
  'chart.clicks': '{n} clicks',
  'chart.table': 'Daily clicks',
  'chart.date': 'Date',

  'settings.title': 'Settings',
  'settings.appearance': 'Appearance',
  'settings.theme': 'Theme',
  'theme.system': 'System',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'settings.language': 'Language',
  'settings.domain': 'Short domain',
  'settings.domainHint': 'The address short links are built from. Leave it empty to use the one you’re visiting ({origin}).',
  'settings.domainEnv': 'Fixed to {url} by SANI_BASE_URL',
  'settings.domainSaved': 'Short domain updated',
  'settings.tokens': 'API tokens',
  'settings.tokensHint': 'For scripts, Shortcuts and browser extensions. A token has full access and outlives password changes, so revoke the ones you no longer use.',
  'settings.tokenName': 'Token name',
  'settings.tokenNamePlaceholder': 'e.g. iPhone Shortcut',
  'settings.tokenCreate': 'Create token',
  'settings.tokenOnce': 'Copy it now. It won’t be shown again.',
  'settings.tokensEmpty': 'No tokens yet',
  'settings.tokenUsed': 'Used {time}',
  'settings.tokenUnused': 'Never used',
  'settings.tokenRevoke': 'Revoke',
  'settings.tokenConfirm': 'Confirm',
  'settings.tokenRevoked': 'Revoked “{name}”',
  'settings.tokenExample': 'Example',
  'settings.tools': 'Shortcuts',
  'settings.bookmarklet': 'Bookmarklet',
  'settings.bookmarkletHint': 'Drag the button to your bookmarks bar. Click it on any page to shorten that page.',
  'settings.bookmarkletButton': 'Shorten this page',
  'settings.bookmarkletDrag': 'Drag it to your bookmarks bar instead',
  'settings.install': 'Add to home screen',
  'settings.installHint': 'Add Sani to your phone’s home screen. On Android you can then shorten links from any app’s Share menu.',
  'settings.data': 'Data',
  'settings.export': 'Export all links',
  'settings.exportHint': 'Every link with its settings and click total.',
  'settings.import': 'Import links',
  'settings.importHint': 'JSON or CSV exported from Sani, Shlink, Sink or YOURLS. Slugs that already exist are skipped.',
  'settings.importDrop': 'Drop a file here, or click to choose',
  'settings.importing': 'Importing…',
  'settings.imported.one': 'Imported 1 link',
  'settings.imported.other': 'Imported {n} links',
  'settings.imported': 'Imported {n} links',
  'settings.importSkipped': 'Skipped {n}:',
  'settings.account': 'Account',
  'settings.passwordChange': 'Change password',
  'settings.passwordCurrent': 'Current password',
  'settings.passwordNew': 'New password',
  'settings.passwordEnv': 'The password is managed by SANI_PASSWORD and can’t be changed here.',
  'settings.passwordChanged': 'Password changed. Other devices were signed out.',
  'settings.sessionsRevoke': 'Sign out other devices',
  'settings.sessionsRevoked': 'Other devices were signed out',
  'settings.about': 'About',
  'settings.version': 'Version',
  'settings.timezone': 'Stats time zone',

  'reason.slug_taken': 'slug exists',
  'reason.url_invalid': 'invalid URL',
  'reason.url_scheme': 'unsupported link',
  'reason.url_required': 'no URL',
  'reason.url_too_long': 'URL too long',
  'reason.url_self': 'points here',
  'reason.slug_invalid': 'invalid slug',
  'reason.slug_reserved': 'reserved slug',
  'reason.slug_too_long': 'slug too long',
  'reason.row': 'row {n}',

  'keys.title': 'Keyboard shortcuts',
  'keys.new': 'New link',
  'keys.search': 'Search',
  'keys.paste': 'Paste a link anywhere',
  'keys.move': 'Move selection',
  'keys.toggle': 'Open or close details',
  'keys.copy': 'Copy short link',
  'keys.edit': 'Edit',
  'keys.delete': 'Delete (undoable)',
  'keys.escape': 'Close / clear',
  'keys.help': 'Show shortcuts',
  'keys.save': 'Save changes',

  'menu.label': 'Menu',
  'menu.settings': 'Settings',
  'menu.shortcuts': 'Shortcuts',
  'menu.theme': 'Theme',
  'menu.language': '中文',

  'new.title': 'Shorten this page',
  'new.closeWindow': 'Close window',
  'new.creating': 'Creating…',
};

export type Lang = 'zh' | 'en';
export type MessageKey = Key;

const dicts: Record<Lang, Record<string, string>> = { zh, en };

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('sani.lang');
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return /^zh/i.test(navigator.language) ? 'zh' : 'en';
}

class I18n {
  lang = $state<Lang>(initialLang());

  set(lang: Lang) {
    this.lang = lang;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    try {
      localStorage.setItem('sani.lang', lang);
    } catch {
      /* storage unavailable */
    }
  }

  get locale() {
    return this.lang === 'zh' ? 'zh-CN' : 'en';
  }
}

export const i18n = new I18n();

function interpolate(s: string, params?: Record<string, string | number>) {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/** Translate a key. A numeric `n` param picks the English plural form. */
export function t(key: Key, params?: Record<string, string | number>): string {
  const dict = dicts[i18n.lang];
  let s = dict[key];
  if (params && typeof params.n === 'number' && i18n.lang === 'en') {
    s = dict[`${key}.${params.n === 1 ? 'one' : 'other'}`] ?? s;
  }
  if (typeof params?.n === 'number') params = { ...params, n: formatNumber(params.n) };
  return interpolate(s ?? key, params);
}

/** Message for an API error code, falling back to a generic one. */
export function errorText(code: string): string {
  const key = `err.${code}` as Key;
  return key in zh ? t(key) : t('err.unknown');
}

const numberFormats = new Map<string, Intl.NumberFormat>();
export function formatNumber(n: number): string {
  const loc = i18n.locale;
  let f = numberFormats.get(loc);
  if (!f) numberFormats.set(loc, (f = new Intl.NumberFormat(loc)));
  return f.format(n);
}

/** Compact counts for narrow columns: 1,234 · 12.3K / 1.2万. */
export function formatCompact(n: number): string {
  if (n < 100_000) return formatNumber(n);
  return new Intl.NumberFormat(i18n.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "3 分钟前" / "3 min ago"; switches to a date after a month. */
export function formatRelative(iso: string | null | undefined, now: number): string {
  if (!iso) return '';
  // Everything shown relatively is in the past; the shared clock can lag a
  // fresh timestamp by up to one tick.
  const diff = Math.min(0, Date.parse(iso) - Math.max(now, Date.now()));
  const abs = -diff;
  if (abs < 45_000) return i18n.lang === 'zh' ? '刚刚' : 'just now';
  const rtf = new Intl.RelativeTimeFormat(i18n.locale, { numeric: 'auto', style: 'short' });
  if (abs < HOUR) return rtf.format(Math.round(diff / MIN), 'minute');
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), 'hour');
  if (abs < 30 * DAY) return rtf.format(Math.round(diff / DAY), 'day');
  return formatDate(iso, now);
}

export function formatDate(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(i18n.locale, {
    year: sameYear ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleString(i18n.locale, {
    year: sameYear ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A calendar day from the stats API ("2026-09-28"), shown with its weekday. */
export function formatDay(date: string, withWeekday = true): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(i18n.locale, {
    month: 'short',
    day: 'numeric',
    weekday: withWeekday ? 'short' : undefined,
  });
}
