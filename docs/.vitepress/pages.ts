// Every page of the site, in reading order. Both languages are built from this
// one list, so the Chinese and English sidebars can never drift apart; the
// sync check also requires each page to exist in both.

export type Lang = 'zh' | 'en';

export interface PageGroup {
  zh: string;
  en: string;
  pages: { path: string; zh: string; en: string }[];
}

export const groups: PageGroup[] = [
  {
    zh: '开始使用',
    en: 'Getting started',
    pages: [
      { path: 'guide/introduction', zh: '介绍', en: 'Introduction' },
      { path: 'guide/quick-start', zh: '快速开始', en: 'Quick start' },
    ],
  },
  {
    zh: '部署与运维',
    en: 'Deploy and operate',
    pages: [
      { path: 'guide/deploy', zh: '部署', en: 'Deployment' },
      { path: 'guide/operations', zh: '运维', en: 'Operations' },
    ],
  },
  {
    zh: '使用',
    en: 'Using Sani',
    pages: [
      { path: 'guide/usage', zh: '日常使用', en: 'Everyday use' },
      { path: 'guide/statistics', zh: '统计口径', en: 'Statistics' },
      { path: 'guide/import-export', zh: '导入与导出', en: 'Import and export' },
    ],
  },
  {
    zh: '参考',
    en: 'Reference',
    pages: [
      { path: 'reference/configuration', zh: '配置项', en: 'Configuration' },
      { path: 'reference/api', zh: 'HTTP API', en: 'HTTP API' },
      { path: 'reference/cli', zh: '命令行', en: 'Command line' },
    ],
  },
  {
    zh: '原理',
    en: 'Internals',
    pages: [
      { path: 'internals/architecture', zh: '架构', en: 'Architecture' },
      { path: 'internals/performance', zh: '性能', en: 'Performance' },
      { path: 'internals/security', zh: '安全', en: 'Security' },
    ],
  },
  {
    zh: '项目',
    en: 'Project',
    pages: [
      { path: 'project/progress', zh: '进度', en: 'Status' },
      { path: 'project/changelog', zh: '更新日志', en: 'Changelog' },
      { path: 'project/development', zh: '参与开发', en: 'Development' },
    ],
  },
];

export const prefix = (lang: Lang) => (lang === 'zh' ? '/' : '/en/');

/** The group a page belongs to, for the eyebrow above its title. */
export function groupOf(relativePath: string): PageGroup | undefined {
  const path = relativePath.replace(/^en\//, '').replace(/\.md$/, '');
  return groups.find((g) => g.pages.some((p) => p.path === path));
}
