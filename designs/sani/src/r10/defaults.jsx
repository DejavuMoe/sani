function UnitInput({ id, value, unit, disabled, invalid, describedBy, onChange }) {
  return <div className="unit-input">
    <input id={id} className="field" inputMode="numeric" autoComplete="off" spellCheck="false" value={value} disabled={disabled} aria-invalid={invalid || undefined} aria-describedby={[describedBy, id + '-unit'].filter(Boolean).join(' ')} onChange={event => onChange(event.target.value)} />
    <label id={id + '-unit'} htmlFor={id}>{unit}</label>
  </div>;
}

function R6DefaultsSettings({ app }) {
  const { lang } = useI18n();
  const zh = lang === 'zh';
  const fields = [
    ['slugLength', zh ? '链接' : 'Links', 5, ''],
    ['textSlugLength', zh ? '文本' : 'Text', 10, 'p/'],
    ['fileSlugLength', zh ? '文件' : 'Files', 10, 'p/'],
  ];
  const initial = () => Object.fromEntries(fields.map(([key, , fallback]) => [key, String(app.config[key] ?? fallback)]));
  const [lengths, setLengths] = React.useState(initial);
  const [exclude, setExclude] = React.useState(app.config.excludeConfusable);
  const [max, setMax] = React.useState(String(app.config.maxFileSize / 1000000));
  const [status, setStatus] = React.useState('');
  const attempted = React.useRef(false);
  const timer = React.useRef();
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const locked = key => !!app.config.defaultsLocked || app.config.configSources?.[key] === 'env';
  const integer = (value, high) => /^\d+$/.test(value) && +value >= (high === 32 ? 3 : 1) && +value <= high;
  const valid = fields.every(([key]) => integer(lengths[key], 32)) && integer(max, 4096);
  const changed = fields.some(([key, , fallback]) => +lengths[key] !== (app.config[key] ?? fallback)) || exclude !== app.config.excludeConfusable || +max * 1000000 !== app.config.maxFileSize;
  const busy = status === 'saving';
  const edit = (key, value) => { setLengths(prev => ({ ...prev, [key]: value })); setStatus(''); };
  function save(e) {
    e.preventDefault();
    if (!valid || !changed || busy) return;
    setStatus('saving');
    timer.current = setTimeout(() => {
      if (app.config.defaultsSaveFails && !attempted.current) { attempted.current = true; setStatus('error'); return; }
      app.updateConfig({ ...Object.fromEntries(fields.map(([key]) => [key, +lengths[key]])), excludeConfusable: exclude, maxFileSize: +max * 1000000 });
      setStatus('saved');
    }, 650);
  }
  return <section id="r6-defaults">
    <header><h2>{zh ? '创建默认值' : 'Creation defaults'}</h2></header>
    <form className="st-body r6-defaults" noValidate onSubmit={save}>
      <fieldset className="r6-lengths" disabled={busy}>
        <legend>{zh ? '自动短码长度' : 'Generated slug length'}</legend>
        <p className="hint r6-length-help">{zh ? '分别设置三类短码的长度（3–32 位）。仅影响之后自动生成的短码，已有内容不变。' : 'Set each type independently (3–32 characters). Only future generated slugs change; existing items stay the same.'}</p>
        {fields.map(([key, label, fallback, prefix]) => {
          const ok = integer(lengths[key], 32);
          const alphabet = key === 'slugLength' && !exclude ? 'k0mi9p1o2r6h8q3t' : 'k7mx9p4w2r6h8q3t';
          return <div className="r6-length-row" key={key}>
            <div className="r6-length-label"><label htmlFor={'r6-' + key}>{label}</label><p className="hint">{zh ? `默认 ${fallback} 位` : `${fallback} characters by default`}{locked(key) && <span className="r6-lock"><Icon name="lock" size={12} />{zh ? '环境变量固定' : 'Set by environment'}</span>}</p></div>
            <UnitInput id={'r6-' + key} value={lengths[key]} unit={zh ? '位' : 'chars'} disabled={locked(key)} invalid={!ok} describedBy={'r6-' + key + '-help'} onChange={value => edit(key, value)} />
            <div id={'r6-' + key + '-help'} className="r6-example">{ok ? <><span>{zh ? '示例' : 'Example'}</span><code>/{prefix}{alphabet.repeat(2).slice(0, +lengths[key])}</code></> : <span className="error-text" role="alert">{zh ? '请输入 3–32 的整数。' : 'Enter a whole number from 3 to 32.'}</span>}</div>
          </div>;
        })}
      </fieldset>
      {['textSlugLength', 'fileSlugLength'].some(key => integer(lengths[key], 32) && +lengths[key] < 10) && <p className="hint r6-short-help">{zh ? '分享短码越短，越容易被猜中。文本和文件分享建议使用 10 位或更长。' : 'Shorter share slugs are easier to guess. We recommend 10 or more characters for text and file shares.'}</p>}
      <div className="r3-setting"><div><label htmlFor="r6-exclude">{zh ? '排除易混淆字符' : 'Exclude look-alike characters'}</label><p className="hint">{zh ? '网址短码不使用 0、o、1、i、l。文本和文件分享始终排除这些字符。' : 'Omit 0, o, 1, i and l from URL slugs. Text and file shares always omit them.'}</p></div><Switch id="r6-exclude" label={zh ? '排除易混淆字符' : 'Exclude look-alike characters'} checked={exclude} disabled={locked('excludeConfusable') || busy} onChange={v => { setExclude(v); setStatus(''); }} /></div>
      <div className="r3-setting"><div><label htmlFor="r6-max">{zh ? '单文件大小上限' : 'Maximum file size'}</label><p id="r6-max-help" className="hint">{zh ? '默认 99 MB。超过 25 MB 自动分片上传。' : '99 MB by default. Files over 25 MB upload in chunks.'}</p></div><UnitInput id="r6-max" value={max} unit="MB" disabled={locked('maxFileSize') || busy} invalid={!integer(max, 4096)} describedBy="r6-max-help" onChange={value => { setMax(value); setStatus(''); }} /></div>
      {!integer(max, 4096) && <p className="error-text" role="alert">{zh ? '文件上限须为 1–4096 MB 的整数。' : 'File size must be a whole number from 1–4096 MB.'}</p>}
      <div className="r3-save"><Button type="submit" loading={busy} disabled={!valid || !changed || busy}>{status === 'error' ? zh ? '重试保存' : 'Retry save' : zh ? '保存' : 'Save'}</Button><span className={status === 'error' ? 'error-text' : 'r3-saved'} role="status">{status === 'error' ? zh ? '保存失败，更改尚未生效。请重试。' : 'Save failed. Changes have not been applied. Try again.' : status === 'saved' && !changed ? zh ? '已保存' : 'Saved' : ''}</span></div>
    </form>
  </section>;
}
Object.assign(window, { DefaultsSettings: R6DefaultsSettings });
