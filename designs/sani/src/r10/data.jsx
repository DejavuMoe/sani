function DataSettings({ app }) {
  const { t, lang } = useI18n();
  const zh = lang === 'zh';
  const [busy, setBusy] = React.useState(false), [over, setOver] = React.useState(false), [error, setError] = React.useState(''), [result, setResult] = React.useState('');
  async function inspect(file) {
    if (!file || busy) return;
    setError(''); setResult(''); setBusy(true);
    try {
      if (file.size > 1000000) throw new Error('size');
      const [text, csv, json] = await Promise.all([file.text(), fetch('src/r3/examples/sani.csv').then(r => r.text()), fetch('src/r3/examples/sani.json').then(r => r.text())]);
      if (![csv, json].some(example => example.replace(/\r/g, '').trim() === text.replace(/\r/g, '').trim())) throw new Error('format');
      const item = JSON.parse(json).links[0];
      if (app.store.exportLinks().some(link => sameSlug(link.slug, item.slug))) {
        setResult(zh ? '已跳过 1 条链接：短码已存在' : 'Skipped 1 link: slug already exists');
        return;
      }
      try {
        await app.store.create({ ...item, tags: [app.store.addTag('Docs', 'blue').id] });
        setResult(zh ? '已导入 1 条链接' : 'Imported 1 link');
      } catch (err) {
        if (err.code !== 'slug_taken') throw err;
        setResult(zh ? '已跳过 1 条链接：短码已存在' : 'Skipped 1 link: slug already exists');
      }
    } catch {
      setError(zh ? '无法识别此文件。请对照 Sani 示例检查格式。' : 'File format not recognized. Check it against a Sani example.');
    } finally { setBusy(false); }
  }
  function exportData(format) {
    const links = app.store.exportLinks();
    const columns = ['slug', 'url', 'title', 'redirect', 'enabled', 'expires_at', 'max_clicks', 'clicks', 'created_at', 'tags'];
    const cell = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
    const data = format === 'JSON' ? JSON.stringify({ app: 'sani', version: 1, links }, null, 2) : [columns.join(','), ...links.map(l => columns.map(k => cell(k === 'tags' ? JSON.stringify(l.tags) : l[k])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([data], { type: format === 'JSON' ? 'application/json' : 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `sani.${format.toLowerCase()}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section id="r3-data"><header><h2>{t('settings.data')}</h2></header><div className="st-body">
    <div className="st-tool"><div><h3>{t('settings.export')}</h3><p className="hint">{t('settings.exportHint')}</p></div><div className="st-pair">{['JSON', 'CSV'].map(format => <button className="st-dl" type="button" key={format} onClick={() => exportData(format)}>{format}</button>)}</div></div>
    <div className="st-tool column"><div><h3>{t('settings.import')}</h3><p className="hint">{t('settings.importHint')}</p><div className="r3-examples"><span>{zh ? 'Sani 格式示例' : 'Sani format examples'}</span><a href="src/r3/examples/sani.csv" download>CSV</a><a href="src/r3/examples/sani.json" download>JSON</a></div></div>
      <label className={cx('st-drop', over && 'over', busy && 'busy')} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); inspect(e.dataTransfer.files[0]); }}><input className="sr-only" type="file" accept=".csv,.json,text/csv,application/json" disabled={busy} onChange={e => { inspect(e.target.files[0]); e.target.value = ''; }} /><Icon name="upload" /><span>{busy ? t('settings.importing') : t('settings.importDrop')}</span></label>
      {error && <p className="error-text" role="alert">{error}</p>}
      {result && <p className="r3-saved" role="status">{result}</p>}
    </div>
  </div></section>;
}
