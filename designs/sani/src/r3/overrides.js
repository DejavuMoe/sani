Object.assign(window.SANI_FIXTURES.config, {
  maxFileSize: 99000000, excludeConfusable: true, metaMode: 'direct', proxyConfigured: true,
});
Object.assign(window.SANI_ICONS, {
  keyboard: ['M3 4h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z', 'M4.5 6.5h.01m3.49 0h.01m3.49 0h.01M5 9.5h6'],
  copy: ['M6 5.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z', 'M3 10V3a1 1 0 0 1 1-1h6'],
  open: ['M9 2.5h4.5V7', 'M13 3 7.5 8.5', 'M6 3H3.5a1 1 0 0 0-1 1v8.5a1 1 0 0 0 1 1H12a1 1 0 0 0 1-1V10'],
  enter: ['M13 3.5v4A1.5 1.5 0 0 1 11.5 9H3', 'M6 6 3 9l3 3'],
});
Object.assign(window.SANI_I18N.zh, { 'settings.importHint': '支持 Sani、Shlink 导出的 CSV 或 JSON。已有短码会被跳过。' });
Object.assign(window.SANI_I18N.en, { 'settings.importHint': 'Import CSV or JSON exported by Sani or Shlink. Existing slugs are skipped.' });
