function ColorEditor({ value, onChange, onValidity }) {
  const { lang } = useI18n();
  const [input, setInput] = React.useState(value);
  const id = React.useId();
  const normalized = normalizeTagColor(input);
  React.useEffect(() => { onValidity(!!normalizeTagColor(value)); }, []);
  const change = next => {
    setInput(next);
    const hex = normalizeTagColor(next);
    onValidity(!!hex);
    if (hex) onChange(hex);
  };
  return <div className="r3-color">
    <div className="r3-swatches" role="group" aria-label={lang === 'zh' ? '预设颜色' : 'Preset colors'}>
      {TAG_COLORS.map(([hex, zh, en]) => <button type="button" key={hex} style={tagStyle(hex)} aria-label={lang === 'zh' ? zh : en} aria-pressed={hex === value} onClick={() => change(hex)}><span className="tag-swatch" /></button>)}
    </div>
    <label className="r3-color-label" htmlFor={id}>{lang === 'zh' ? '自定义颜色' : 'Custom color'}</label>
    <div className="r3-color-input">
      <input type="color" className="r3-native-color" aria-label={lang === 'zh' ? '打开取色器' : 'Open color picker'} value={value} onChange={e => change(e.target.value)} />
      <input id={id} className="field" value={input} spellCheck="false" autoComplete="off" aria-invalid={!normalized} aria-describedby={id + '-help'} onChange={e => change(e.target.value)} onBlur={() => { if (normalized) setInput(normalized); }} />
    </div>
    <p id={id + '-help'} className={normalized ? 'hint' : 'error-text'}>{normalized ? 'HEX · RGB · HSL' : lang === 'zh' ? '请输入 HEX、rgb(88, 114, 165) 或 hsl(220, 30%, 50%)，不支持透明度。' : 'Use HEX, rgb(88, 114, 165) or hsl(220, 30%, 50%). Alpha is not supported.'}</p>
  </div>;
}

function DefaultsSettings({ app }) {
  const { lang } = useI18n();
  const zh = lang === 'zh';
  const [length, setLength] = React.useState(app.config.slugLength);
  const [exclude, setExclude] = React.useState(app.config.excludeConfusable);
  const [max, setMax] = React.useState(app.config.maxFileSize / 1000000);
  const [saved, setSaved] = React.useState(false);
  const valid = Number.isInteger(+length) && +length >= 3 && +length <= 32 && Number.isInteger(+max) && +max >= 1 && +max <= 4096;
  const locked = !!app.config.defaultsLocked;
  const changed = +length !== app.config.slugLength || exclude !== app.config.excludeConfusable || +max * 1000000 !== app.config.maxFileSize;
  return <section id="r3-defaults"><header><h2>{zh ? '创建默认值' : 'Creation defaults'}</h2></header><form className="st-body r3-form" onSubmit={e => { e.preventDefault(); if (!valid) return; app.updateConfig({ slugLength: +length, excludeConfusable: exclude, maxFileSize: +max * 1000000 }); setSaved(true); }}>
    {locked && <p className="hint">{zh ? "由服务器环境变量设置，后台仅显示当前值。" : "Set by server environment variables. These values are read-only."}</p>}
    <div className="r3-setting"><div><label htmlFor="r3-length">{zh ? '自动短码长度' : 'Generated slug length'}</label><p className="hint">{zh ? '3–32 位，仅影响之后自动生成的短链接。' : '3–32 characters. Applies to future generated link slugs.'}</p></div><input id="r3-length" disabled={locked} className="field" type="number" min="3" max="32" value={length} onChange={e => { setLength(e.target.value); setSaved(false); }} /></div>
    <div className="r3-setting"><div><label htmlFor="r3-exclude">{zh ? '排除易混淆字符' : 'Exclude look-alike characters'}</label><p className="hint">{zh ? '不使用 0、o、1、i、l，方便辨认和手动输入。' : 'Avoid 0, o, 1, i and l for easier reading and typing.'}</p></div><Switch id="r3-exclude" disabled={locked} checked={exclude} label={zh ? "排除易混淆字符" : "Exclude look-alike characters"} onChange={checked => { setExclude(checked); setSaved(false); }} /></div>
    <div className="r3-preview"><span>{zh ? '短码示例' : 'Example slug'}</span><code>/{(exclude ? 'k7mx9p4w2r6h8q3t' : 'k0mi9p1o2r6h8q3t').repeat(2).slice(0, Math.max(3, Math.min(32, +length)))}</code></div>
    <div className="r3-setting"><div><label htmlFor="r3-max">{zh ? '单文件大小上限' : 'Maximum file size'}</label><p className="hint">{zh ? '默认 99 MB。超过 25 MB 自动分片上传。' : '99 MB by default. Files over 25 MB upload in chunks.'}</p></div><span className="r3-unit"><input id="r3-max" disabled={locked} className="field" type="number" min="1" max="4096" value={max} onChange={e => { setMax(e.target.value); setSaved(false); }} />MB</span></div>
    {!valid && !locked && <p className="error-text" role="alert">{zh ? '短码长度须为 3–32 的整数，文件上限须为 1–4096 MB 的整数。' : 'Use an integer from 3–32 for slug length and 1–4096 MB for file size.'}</p>}
    <div className="r3-save"><Button type="submit" disabled={locked || !valid || !changed}>{zh ? '保存' : 'Save'}</Button><span role="status" className="r3-saved">{saved && !changed ? zh ? '已保存' : 'Saved' : ''}</span></div>
  </form></section>;
}

function MetadataSettings({ app }) {
  const { lang } = useI18n();
  const zh = lang === 'zh';
  const [mode, setMode] = React.useState(app.config.metaMode);
  const [saved, setSaved] = React.useState(false);
  return <section id="r3-meta"><header><h2>{zh ? '网页信息' : 'Page metadata'}</h2></header><form className="st-body r3-form" onSubmit={e => { e.preventDefault(); app.updateConfig({ metaMode: mode }); setSaved(true); }}>
    <div className="r3-setting"><div><label htmlFor="r3-meta-mode">{zh ? '标题与网站图标' : 'Titles and site icons'}</label><p className="hint">{zh ? '选择自动获取网页信息的方式。' : 'Choose how page metadata is fetched.'}</p></div><select id="r3-meta-mode" className="field" value={mode} onChange={e => { setMode(e.target.value); setSaved(false); }}><option value="off">{zh ? '关闭' : 'Off'}</option><option value="direct">{zh ? '直接连接' : 'Direct'}</option><option value="proxy" disabled={!app.config.proxyConfigured}>{zh ? '使用代理' : 'Use proxy'}</option></select></div>
    <p className="hint">{mode === 'off' ? zh ? '不请求目标网站。你仍可以手动填写标题。' : 'No requests to destination sites. You can still enter titles manually.' : mode === 'direct' ? zh ? '目标网站会看到服务器的出口 IP。' : 'Destination sites can see your server’s outgoing IP.' : zh ? '目标网站看到代理出口 IP。代理不可用时不自动直连。' : 'Sites see the proxy’s outgoing IP. No direct fallback if the proxy fails.'}</p>
    <div className="r3-meta-status"><Icon name={app.config.proxyConfigured ? 'check' : 'lock'} size={14} />{app.config.proxyConfigured ? zh ? '服务器已配置代理' : 'A proxy is configured on the server' : zh ? '尚未配置代理，请先在服务器上配置。' : 'Configure a proxy on the server to enable this option.'}</div>
    <div className="r3-save"><Button type="submit" disabled={mode === app.config.metaMode}>{zh ? '保存' : 'Save'}</Button><span role="status" className="r3-saved">{saved && mode === app.config.metaMode ? zh ? '已保存' : 'Saved' : ''}</span></div>
  </form></section>;
}

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
