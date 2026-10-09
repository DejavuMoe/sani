Object.assign(FIX.config, { slugLength: 5, textSlugLength: 10, fileSlugLength: 10 });
const R6_TEXT = '周五分享会\n\n下午三点在会议室见。请提前整理本周的进展、遇到的问题和下周安排。每人预留五分钟，讨论结束后把结论补充到团队文档。\n\n远程同事可以通过会议链接参加，相关材料会在会后统一归档。';
const r6Source = FIX.links.find(link => link.kind === 'text');
FIX.links.unshift({ ...r6Source, id: 9001, slug: 'k7mx9p4w2r', shortUrl: 'https://s.example.com/p/k7mx9p4w2r', title: '周五分享会', clicks: 0, enabled: true, expiresAt: null, maxClicks: null, status: 'active', tags: [], content: { ...r6Source.content, format: 'plain', lines: 5, size: new TextEncoder().encode(R6_TEXT).length, preview: '周五分享会', rawUrl: 'https://files.example.com/k7mx9p4w2r' } });
FIX.texts[9001] = R6_TEXT;
const R6_CODE = 'services:\n  app:\n    image: example/app:1.0.0\n    ports:\n      - "127.0.0.1:8080:8080"\n    environment:\n      APP_BASE_URL: "https://s.example.com"\n' + Array.from({ length: 28 }, (_, n) => `      EXAMPLE_SETTING_${n + 1}: "sample-${n + 1}"`).join('\n') + '\n    command: ["serve", "--description", "Weekly planning notes, project schedules, meeting summaries, reference documents and shared resources for everyone on the team."]';
FIX.links.unshift({ ...FIX.links[0], id: 9002, slug: 'm4rq8v2x7p', shortUrl: 'https://s.example.com/p/m4rq8v2x7p', title: 'compose.yaml', content: { ...FIX.links[0].content, format: 'code', lines: R6_CODE.split('\n').length, size: new TextEncoder().encode(R6_CODE).length, preview: 'services:', rawUrl: 'https://files.example.com/m4rq8v2x7p' } });
FIX.texts[9002] = R6_CODE;
for (const link of FIX.links.filter(link => link.id === 9001 || link.id === 9002)) {
  link.spark = Array(14).fill(0);
  link.lastClickAt = null;
}
Object.assign(SCENES, {
  'r6-settings': { group: 'R6', route: 'settings', config: { metadataDraft: R5_BASE } },
  'r6-settings-locked': { group: 'R6', route: 'settings', config: { metadataDraft: R5_BASE, configSources: { textSlugLength: 'env' } } },
  'r6-settings-retry': { group: 'R6', route: 'settings', config: { metadataDraft: R5_BASE, defaultsSaveFails: true } },
  'r6-text': { group: 'R6', store: { expandedId: 9001, kind: 'text' } },
  'r6-code': { group: 'R6', store: { expandedId: 9002, kind: 'text' } },
  'r6-text-loading': { group: 'R6', store: { expandedId: 9001, kind: 'text' } },
  'r6-text-error': { group: 'R6', store: { expandedId: 9001, kind: 'text' } },
  'r6-file-create': { group: 'R6', config: { fileSlugLength: 12 }, dashboard: { mode: 'file', composer: { file: 'sample' } } },
});
