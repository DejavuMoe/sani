function R5Choice({ value, options, onChange, label }) {
  return <Menu label={label} triggerClass="btn btn-secondary" minWidth={180}
    button={() => <><span>{options.find(o => o.value === value)?.label}</span><Icon name="chevronDown" size={14} /></>}>
    {close => options.map(o => <MenuItem key={o.value} checked={o.value === value} onClick={() => { onChange(o.value); close(); }}>{o.label}</MenuItem>)}
  </Menu>;
}

function R5Secret({ value, onChange, stored, onClear, disabled }) {
  const { lang } = useI18n();
  const zh = lang === 'zh';
  const id = React.useId();
  const [edit, setEdit] = React.useState(!stored);
  const [show, setShow] = React.useState(false);
  React.useEffect(() => { setEdit(!stored); setShow(false); }, [stored]);
  return <div className="r5-input"><label htmlFor={edit ? id : undefined}>{zh ? '密码' : 'Password'}</label>
    {stored && !edit ? <div className="r5-secret r5-secret-saved"><span className="hint">{zh ? '已保存' : 'Saved'}</span><Button disabled={disabled} size="sm" onClick={() => setEdit(true)}>{zh ? '替换' : 'Replace'}</Button><Button disabled={disabled} size="sm" variant="ghost" onClick={() => { onClear(); setEdit(true); }}>{zh ? '移除' : 'Remove'}</Button></div>
      : <><div className="r5-secret"><input id={id} className="field" type={show ? 'text' : 'password'} value={value} autoComplete="new-password" disabled={disabled} onChange={e => onChange(e.target.value)} placeholder={stored ? zh ? '留空保留已保存的密码' : 'Leave blank to keep saved password' : zh ? '输入密码' : 'Enter password'} /><Button variant="ghost" disabled={disabled || !value} aria-pressed={show} onClick={() => setShow(!show)}>{show ? zh ? '隐藏' : 'Hide' : zh ? '显示' : 'Show'}</Button></div>{stored && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { onChange(''); setEdit(false); setShow(false); }}>{zh ? '取消替换' : 'Cancel replacement'}</Button>}</>}
  </div>;
}

function R5MetadataSettings({ app }) {
  const { lang } = useI18n();
  const zh = lang === 'zh';
  const initial = app.config.metadataDraft ?? { enabled: true, mode: 'direct', tls: true, host: '', port: '443', auth: false, username: '', password: '', passwordStored: false };
  const [draft, setDraft] = React.useState(initial);
  const [saved, setSaved] = React.useState(initial);
  const [status, setStatus] = React.useState('');
  const [errors, setErrors] = React.useState({});
  const timer = React.useRef();
  const attempts = React.useRef(0);
  const locked = !!app.config.metadataLocked;
  const busy = status === 'testing';
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const proxy = draft.enabled && draft.mode !== 'direct';
  React.useEffect(() => () => clearTimeout(timer.current), []);
  function change(patch) { clearTimeout(timer.current); setDraft(prev => ({ ...prev, ...patch })); setErrors({}); setStatus(''); }
  function validate() {
    const next = {};
    if (proxy) {
      if (!draft.host.trim() || /[\s/@?#]/.test(draft.host) || draft.host.includes('://')) next.host = zh ? '填写主机名或 IP，不包含协议、路径或凭据。' : 'Enter a hostname or IP without a scheme, path or credentials.';
      if (!/^\d+$/.test(draft.port) || +draft.port < 1 || +draft.port > 65535) next.port = zh ? '端口须为 1–65535。' : 'Port must be 1–65535.';
      if (draft.auth && (!draft.username.trim() || (!draft.password && !draft.passwordStored))) next.auth = zh ? '请填写用户名和密码，或关闭身份认证。' : 'Enter a username and password, or turn off authentication.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }
  function test() {
    if (!validate()) return;
    setStatus('testing');
    timer.current = setTimeout(() => { setStatus(app.config.testFails && attempts.current++ === 0 ? 'failed' : 'passed'); }, 900);
  }
  function save(e) {
    e.preventDefault();
    if (!validate()) return;
    const next = { ...draft, host: draft.host.trim(), username: draft.username.trim(), passwordStored: draft.auth && (!!draft.password || draft.passwordStored), password: '' };
    setDraft(next); setSaved(next); app.updateConfig({ metadataDraft: next }); setStatus('saved');
  }
  const options = [{ value: 'direct', label: zh ? '直接连接' : 'Direct' }, { value: 'http', label: 'HTTP(S)' }, { value: 'socks', label: 'SOCKS5' }];
  return <section id="r5-meta"><header><h2>{zh ? '网页信息' : 'Page metadata'}</h2></header>
    <form className="st-body r5-form" noValidate onSubmit={save}>
      <div className="r3-setting"><div><label htmlFor="r5-enabled">{zh ? '自动获取网页信息' : 'Fetch page metadata'}</label><p className="hint">{zh ? '创建短链接时获取标题与网站图标。' : 'Fetch titles and site icons when creating links.'}</p></div><Switch id="r5-enabled" label={zh ? '自动获取网页信息' : 'Fetch page metadata'} checked={draft.enabled} disabled={locked || busy} onChange={enabled => change({ enabled })} /></div>
      {locked && <p className="hint">{zh ? '当前连接方式由环境变量固定，后台显示有效值。' : 'Environment variables lock the current connection settings.'}</p>}
      {draft.enabled ? <fieldset className="r5-connection" disabled={locked || busy}>
        <legend className="sr-only">{zh ? '网页信息连接设置' : 'Metadata connection settings'}</legend>
        <div className="st-row r5-route"><span className="k">{zh ? '连接方式' : 'Connection'}</span><Segmented value={draft.mode} label={zh ? '连接方式' : 'Connection'} options={options} onChange={mode => change({ mode })} /></div>
        {proxy && <>
          <div className="r5-address"><div className="r5-input"><label htmlFor="r5-host">{zh ? '代理主机' : 'Proxy host'}</label><input id="r5-host" className="field" value={draft.host} autoComplete="off" spellCheck="false" placeholder="proxy.example.com" aria-invalid={!!errors.host} aria-describedby={errors.host ? 'r5-host-error' : undefined} onChange={e => change({ host: e.target.value })} /></div><div className="r5-input"><label htmlFor="r5-port">{zh ? '端口' : 'Port'}</label><input id="r5-port" className="field" value={draft.port} inputMode="numeric" autoComplete="off" aria-invalid={!!errors.port} aria-describedby={errors.port ? 'r5-port-error' : undefined} onChange={e => change({ port: e.target.value })} /></div></div>
          {errors.host && <p id="r5-host-error" className="error-text" role="alert">{errors.host}</p>}
          {errors.port && <p id="r5-port-error" className="error-text" role="alert">{errors.port}</p>}
          <div className="st-row r5-option">{draft.mode === 'http' ? <><label className="k" htmlFor="r5-tls">{zh ? '使用 HTTPS 代理' : 'Use HTTPS proxy'}</label><Switch id="r5-tls" label={zh ? '使用 HTTPS 代理' : 'Use HTTPS proxy'} checked={draft.tls} onChange={tls => change({ tls })} /></> : <><span className="k">{zh ? '连接加密' : 'Connection encryption'}</span><span className="hint">{zh ? 'SOCKS5 不提供加密' : 'Not provided by SOCKS5'}</span></>}</div>
          <div className="st-row r5-option"><label className="k" htmlFor="r5-auth">{zh ? '身份认证' : 'Authentication'}</label><Switch id="r5-auth" label={zh ? '身份认证' : 'Authentication'} checked={draft.auth} onChange={auth => change({ auth })} /></div>
          {draft.auth && <div className="r5-auth-fields"><div className="r5-input"><label htmlFor="r5-user">{zh ? '用户名' : 'Username'}</label><input id="r5-user" className="field" autoComplete="off" value={draft.username} onChange={e => change({ username: e.target.value })} /></div><R5Secret value={draft.password} stored={draft.passwordStored} disabled={locked || busy} onChange={password => change({ password })} onClear={() => change({ password: '', passwordStored: false })} /></div>}
          {errors.auth && <p className="error-text" role="alert">{errors.auth}</p>}
        </>}
        <p className="hint">{proxy ? zh ? '目标网站看到代理出口 IP。连接失败时不自动直连。' : 'Sites see the proxy’s outgoing IP. No direct fallback on failure.' : zh ? '目标网站会看到服务器的出口 IP。' : 'Destination sites can see your server’s outgoing IP.'}</p>
      </fieldset> : <p className="hint">{zh ? '不再发起网页信息请求。你仍可手动填写标题。' : 'No new metadata requests. You can still enter titles manually.'}</p>}
      <div className="r5-actions"><Button type="submit" disabled={!dirty || locked || busy}>{zh ? '保存' : 'Save'}</Button>{proxy && <Button variant="ghost" disabled={locked} loading={busy} onClick={test}>{busy ? zh ? '正在测试' : 'Testing' : status === 'failed' ? zh ? '重试连接' : 'Retry connection' : zh ? '测试连接' : 'Test connection'}</Button>}</div>
      <div className={cx('r5-feedback', status === 'failed' ? 'error-text' : 'hint')} role="status" aria-live="polite">
        {status === 'saved' ? zh ? '已保存，新请求将使用此设置。' : 'Saved. New requests will use these settings.' : status === 'passed' ? zh ? '连接成功，已获取测试页面标题。尚未保存的设置不会生效。' : 'Connected and fetched the test page title. Unsaved changes are not applied.' : status === 'failed' ? zh ? '连接超时。请检查地址、端口和认证后重试。当前设置未改变。' : 'Connection timed out. Check the host, port and credentials, then retry. Current settings are unchanged.' : status === 'testing' ? zh ? '正在通过当前配置访问 example.com…' : 'Requesting example.com through this configuration…' : dirty ? zh ? '有尚未保存的更改' : 'Unsaved changes' : ''}
      </div>
    </form>
  </section>;
}

Object.assign(window, { R5Choice, MetadataSettings: R5MetadataSettings });
