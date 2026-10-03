/*
 * Every scene of the clickable app: where it starts, and in what state.
 * `?scene=<id>` on prototype.html opens one; the screens board frames them all.
 */
const SLUG = (slug) => FIX.links.find((l) => l.slug === slug)?.id;
const FILE_LINK = () => FIX.links.find((l) => l.kind === 'file')?.id;
const sampleFile = () => new File([new Uint8Array(1843200)], 'design-review.pdf', { type: 'application/pdf' });

const SCENES = {
  setup: { group: 'auth', session: 'setup' },
  'setup-filled': { group: 'auth', session: 'setup', setup: { code: 'k7m2-p9x4-hq3d', password: 'correct-horse', confirm: 'correct-horse' } },
  'setup-error': { group: 'auth', session: 'setup', setup: { code: 'k7m2-p9x4-hq3x', password: 'correct-horse', confirm: 'correct-horse', error: 'code' } },
  login: { group: 'auth', session: 'login' },
  'login-expired': { group: 'auth', session: 'login', login: { expired: true } },
  'login-wrong': { group: 'auth', session: 'login', login: { password: 'hunter22', error: 'wrong' } },
  'login-rate': { group: 'auth', session: 'login', login: { password: 'hunter22', error: 'rate' } },
  offline: { group: 'auth', session: 'offline' },

  dashboard: { group: 'dashboard' },
  'dashboard-empty': { group: 'dashboard', store: { empty: true } },
  'dashboard-loading': { group: 'dashboard', store: { loading: true, overview: null } },
  'dashboard-error': { group: 'dashboard', store: { failed: true } },
  'dashboard-search': { group: 'dashboard', store: { query: 'github' } },
  'dashboard-noresults': { group: 'dashboard', store: { query: 'kubernetes' } },
  'dashboard-texts': { group: 'dashboard', store: { kind: 'text' } },
  'dashboard-sort-clicks': { group: 'dashboard', store: { sort: 'clicks' } },
  'dashboard-picking': { group: 'dashboard', store: () => ({ picking: true, picked: [SLUG('gh'), SLUG('blog'), SLUG('talk')] }) },
  'dashboard-selected': { group: 'dashboard', store: () => ({ selectedId: SLUG('blog') }) },
  'detail-url': { group: 'detail', store: () => ({ expandedId: SLUG('weekly-42') }) },
  'detail-text': { group: 'detail', store: () => ({ expandedId: SLUG('nginx-conf') }) },
  'detail-file': { group: 'detail', store: () => ({ expandedId: FILE_LINK() }) },
  'detail-expired': { group: 'detail', store: () => ({ expandedId: SLUG('talk') }) },
  'detail-limit': { group: 'detail', store: () => ({ expandedId: SLUG('beta') }) },
  'edit-url': { group: 'detail', store: () => ({ expandedId: SLUG('weekly-42'), editingId: SLUG('weekly-42') }) },
  'edit-text': { group: 'detail', store: () => ({ expandedId: SLUG('nginx-conf'), editingId: SLUG('nginx-conf') }) },
  'composer-more': { group: 'composer', dashboard: { composer: { url: 'https://example.com/a/very/long/path?with=query', more: true } } },
  'composer-error': { group: 'composer', dashboard: { composer: { url: 'not a link', error: { field: 'url', text: null, code: 'url_invalid' } } } },
  'composer-pasted': { group: 'composer', dashboard: { composer: { url: 'https://example.com/a/very/long/path', note: 'composer.pasted' } } },
  'composer-text': { group: 'composer', dashboard: { mode: 'text' } },
  'composer-code': { group: 'composer', dashboard: { mode: 'text', composer: { text: 'server {\n    listen 443 ssl;\n    server_name s.example.com;\n}\n', format: 'code' } } },
  'composer-file': { group: 'composer', dashboard: { mode: 'file' } },
  'composer-file-picked': { group: 'composer', dashboard: { mode: 'file', composer: { file: 'sample', note: 'share.dropped' } } },
  'composer-file-uploading': { group: 'composer', dashboard: { mode: 'file', composer: { file: 'sample', busy: true, progress: 0.42 } } },
  'composer-file-off': { group: 'composer', config: { filesUrl: null }, dashboard: { mode: 'file' } },
  shortcuts: { group: 'overlays', shortcuts: true },
  toasts: { group: 'overlays', toasts: true },
  settings: { group: 'settings', route: 'settings' },
  'settings-token': { group: 'settings', route: 'settings', settings: { revealed: true } },
  'settings-import': { group: 'settings', route: 'settings', settings: { imported: true } },
  'settings-env': { group: 'settings', route: 'settings', config: { baseUrlSource: 'env', passwordFromEnv: true, filesUrl: null } },
  new: { group: 'new', route: 'new' },
  'new-result': { group: 'new', route: 'new', newLink: () => ({ created: FIX.links.find((l) => l.slug === 'gh') }) },
};

Object.assign(window, { SCENES, sampleFile });
