Object.assign(SCENES, {
  'r3-settings': { group: 'R3', route: 'settings' },
  'r3-env-locked': { group: 'R3', route: 'settings', config: { defaultsLocked: true, maxFileSize: 67108864, slugLength: 6 } },
  'r3-proxy-missing': { group: 'R3', route: 'settings', config: { proxyConfigured: false } },
  'r3-file': { group: 'R3', dashboard: { mode: 'file', composer: { file: 'large' } } },
  'r3-file-retry': { group: 'R3', store: { uploadError: true }, dashboard: { mode: 'file', composer: { file: 'large' } } },
  'r3-file-limit': { group: 'R3', config: { maxFileSize: 50000000 }, dashboard: { mode: 'file', composer: { file: 'large' } } },
});
