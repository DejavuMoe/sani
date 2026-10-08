const R4_BASE = { enabled: true, route: 'protected', method: 'http', tls: true, host: 'proxy.example.com', port: '443', auth: false, username: '', password: '', key: '', passwordStored: false, keyStored: false };
Object.assign(SCENES, {
  'r4-settings': { group: 'R4', route: 'settings', config: { metadataDraft: R4_BASE } },
  'r4-relay': { group: 'R4', route: 'settings', config: { metadataDraft: { ...R4_BASE, method: 'relay' } } },
  'r4-socks': { group: 'R4', route: 'settings', config: { metadataDraft: { ...R4_BASE, method: 'socks', port: '1080', auth: true, username: 'demo', passwordStored: true } } },
  'r4-empty': { group: 'R4', route: 'settings', config: { metadataDraft: { ...R4_BASE, host: '', port: '' } } },
  'r4-retry': { group: 'R4', route: 'settings', config: { metadataDraft: R4_BASE, testFails: true } },
  'r4-env-locked': { group: 'R4', route: 'settings', config: { metadataDraft: R4_BASE, metadataLocked: true } },
  'r4-direct': { group: 'R4', route: 'settings', config: { metadataDraft: { ...R4_BASE, route: 'direct' } } },
  'r4-off': { group: 'R4', route: 'settings', config: { metadataDraft: { ...R4_BASE, enabled: false } } },
});
