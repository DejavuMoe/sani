const R5_BASE = { enabled: true, mode: 'http', tls: true, host: 'proxy.example.com', port: '443', auth: false, username: '', password: '', passwordStored: false };
Object.assign(SCENES, {
  'r5-settings': { group: 'R5', route: 'settings', config: { metadataDraft: R5_BASE } },
  'r5-socks': { group: 'R5', route: 'settings', config: { metadataDraft: { ...R5_BASE, mode: 'socks', port: '1080', auth: true, username: 'demo', passwordStored: true } } },
  'r5-empty': { group: 'R5', route: 'settings', config: { metadataDraft: { ...R5_BASE, host: '', port: '' } } },
  'r5-retry': { group: 'R5', route: 'settings', config: { metadataDraft: R5_BASE, testFails: true } },
  'r5-env-locked': { group: 'R5', route: 'settings', config: { metadataDraft: R5_BASE, metadataLocked: true } },
  'r5-direct': { group: 'R5', route: 'settings', config: { metadataDraft: { ...R5_BASE, mode: 'direct' } } },
  'r5-off': { group: 'R5', route: 'settings', config: { metadataDraft: { ...R5_BASE, enabled: false } } },
});
