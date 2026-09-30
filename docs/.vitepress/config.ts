import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, type DefaultTheme } from 'vitepress';
import { readableTokens } from './contrast';
import { saniMarkdown } from './markdown';
import { groups, prefix, type Lang } from './pages';

const repo = 'https://github.com/DejavuMoe/sani';

// Pages show when they last changed, but only where there is Git history to
// ask: the Linux build mirror has none.
const git = existsSync(new URL('../../.git', import.meta.url));

// The version in the nav is the newest entry of the changelog, so the two
// cannot disagree.
const changelog = readFileSync(new URL('../project/changelog.md', import.meta.url), 'utf8');
const version = /^## (v\d+\.\d+\.\d+)/m.exec(changelog)?.[1] ?? 'dev';

function sidebar(lang: Lang): DefaultTheme.SidebarItem[] {
  return groups.map((g) => ({
    text: g[lang],
    items: g.pages.map((p) => ({ text: p[lang], link: prefix(lang) + p.path })),
  }));
}

function nav(lang: Lang): DefaultTheme.NavItem[] {
  const p = prefix(lang);
  const zh = lang === 'zh';
  return [
    { text: zh ? '指南' : 'Guide', link: `${p}guide/introduction`, activeMatch: `^${p}guide/` },
    { text: zh ? '参考' : 'Reference', link: `${p}reference/configuration`, activeMatch: `^${p}reference/` },
    { text: zh ? '原理' : 'Internals', link: `${p}internals/architecture`, activeMatch: `^${p}internals/` },
    { text: zh ? '进度' : 'Status', link: `${p}project/progress`, activeMatch: `^${p}project/` },
    {
      text: version,
      items: [
        { text: zh ? '更新日志' : 'Changelog', link: `${p}project/changelog` },
        { text: zh ? '参与开发' : 'Development', link: `${p}project/development` },
      ],
    },
  ];
}

const zhTheme: DefaultTheme.Config = {
  nav: nav('zh'),
  sidebar: sidebar('zh'),
  outline: { level: [2, 3], label: '本页内容' },
  docFooter: { prev: '上一页', next: '下一页' },
  editLink: { pattern: `${repo}/edit/main/docs/:path`, text: '在 GitHub 上修改此页' },
  lastUpdated: { text: '最后更新', formatOptions: { dateStyle: 'medium' } },
  darkModeSwitchLabel: '外观',
  lightModeSwitchTitle: '切换到浅色',
  darkModeSwitchTitle: '切换到深色',
  sidebarMenuLabel: '目录',
  returnToTopLabel: '回到顶部',
  langMenuLabel: '切换语言',
  skipToContentLabel: '跳到正文',
  externalLinkIcon: true,
  notFound: {
    title: '这个页面不存在',
    quote: '链接可能已经过时，或者地址输错了。',
    linkLabel: '回到首页',
    linkText: '回到首页',
    code: '404',
  },
};

const enTheme: DefaultTheme.Config = {
  nav: nav('en'),
  sidebar: sidebar('en'),
  outline: { level: [2, 3], label: 'On this page' },
  editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
  lastUpdated: { text: 'Last updated', formatOptions: { dateStyle: 'medium' } },
  externalLinkIcon: true,
  notFound: {
    title: 'This page doesn’t exist',
    quote: 'The link may be out of date, or the address mistyped.',
    linkLabel: 'Back to the home page',
    linkText: 'Back to the home page',
    code: '404',
  },
};

export default defineConfig({
  title: 'Sani',
  cleanUrls: true,
  lastUpdated: git,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#f7f7f5' }],
    ['meta', { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#111110' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Sani' }],
  ],

  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      description: '一个小而快、可以自己部署的短链接服务：一个二进制文件、一个 SQLite 数据库。',
      themeConfig: zhTheme,
    },
    en: {
      label: 'English',
      lang: 'en',
      link: '/en/',
      description: 'A small, fast link shortener you host yourself: one binary, one SQLite file.',
      themeConfig: enTheme,
    },
  },

  themeConfig: {
    logo: { light: '/logo-light.svg', dark: '/logo-dark.svg', alt: '' },
    siteTitle: 'sani',
    socialLinks: [{ icon: 'github', link: repo }],
    search: {
      provider: 'local',
      options: {
        miniSearch: {
          options: {
            // Chinese has no spaces between words; split it the way the
            // browser does. Serialized into the page, so self-contained.
            tokenize: (text: string) => {
              if (typeof Intl === 'object' && 'Segmenter' in Intl) {
                const words: string[] = [];
                for (const s of new Intl.Segmenter('zh', { granularity: 'word' }).segment(text)) {
                  if (s.isWordLike) words.push(s.segment);
                }
                return words;
              }
              return text.split(/[\n\r\p{Z}\p{P}]+/u);
            },
          },
        },
        locales: {
          root: {
            translations: {
              button: { buttonText: '搜索', buttonAriaLabel: '搜索文档' },
              modal: {
                displayDetails: '显示详细列表',
                resetButtonTitle: '清除',
                backButtonTitle: '关闭搜索',
                noResultsText: '没有找到相关内容',
                footer: {
                  selectText: '打开',
                  selectKeyAriaLabel: '回车',
                  navigateText: '选择',
                  navigateUpKeyAriaLabel: '上',
                  navigateDownKeyAriaLabel: '下',
                  closeText: '关闭',
                  closeKeyAriaLabel: 'Esc',
                },
              },
            },
          },
        },
      },
    },
  },

  markdown: {
    theme: { light: 'vitesse-light', dark: 'vitesse-dark' },
    codeTransformers: [readableTokens()],
    image: { lazyLoading: true },
    config: (md) => md.use(saniMarkdown),
  },

  vite: {
    // The deploy page reads compose.yaml and deploy/* from the repository.
    server: { fs: { allow: ['..'] } },
  },
});
