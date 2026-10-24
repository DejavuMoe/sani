/*
 * R11 scenes and the store's password field. The R7 store builds new links
 * from a fixed field list, so the wrapper keeps `password` on created links;
 * `update` already merges any patch.
 */
Object.assign(FIX.config, { version: 'v0.9.10' });
for (const [id, password] of [[10, '7KQ2MX'], [9, 'R4TQ8N'], [4, 'H3KP9W']]) {
  const link = FIX.links.find((l) => l.id === id);
  if (link) link.password = password;
}

function useR11LinksStore(options) {
  const s = useLinksStore(options);
  const keep = (fn, at) => async (...args) => {
    const link = await fn(...args);
    const password = args[at]?.password;
    if (password && !link.reused) {
      link.password = password;
      s.upsert(link);
    }
    return link;
  };
  return { ...s, create: keep(s.create, 0), createText: keep(s.createText, 0), createFile: keep(s.createFile, 1) };
}

const R11_TEXT = '部署清单\n\n1. 备份 /data/sani.db\n2. 拉取 v0.9.10 镜像并重启容器\n3. 检查 /healthz 返回 200';

Object.assign(SCENES, {
  'r11-dashboard': { group: 'R11' },
  'r11-link-create': { group: 'R11', dashboard: { composer: { url: 'https://example.com/handbook/onboarding' } } },
  'r11-text-create': { group: 'R11', dashboard: { mode: 'text', composer: { text: R11_TEXT, expiry: { preset: '7d' }, maxClicks: '10', password: '7KQ2MX' } } },
  'r11-text-password': { group: 'R11', open: 'password', dashboard: { mode: 'text', composer: { text: R11_TEXT } } },
  'r11-text-limit': { group: 'R11', open: 'limit', dashboard: { mode: 'text', composer: { text: R11_TEXT } } },
  'r11-file-create': { group: 'R11', dashboard: { mode: 'file', composer: { file: 'sample', password: 'R4TQ8N' } } },
  'r11-detail-text': { group: 'R11', store: { expandedId: 10, kind: 'text' } },
  'r11-detail-file': { group: 'R11', store: { expandedId: 9, kind: 'file' } },
  'r11-detail-url': { group: 'R11', store: { expandedId: 4, kind: 'url' } },
  'r11-edit-text': { group: 'R11', store: { expandedId: 10, editingId: 10, kind: 'text' } },
  'r11-settings': { group: 'R11', route: 'settings', config: { timezone: 'Local' } },
  'r11-empty': { group: 'R11', store: { empty: true } },
  'r11-login': { group: 'R11', session: 'login' },
  'r11-setup': { group: 'R11', session: 'setup' },
  'r11-shortcuts': { group: 'R11', shortcuts: true },
});

Object.assign(window, { useR11LinksStore });
