function R4Choice({ value, options, onChange, label, disabled = false }) {
  return <Menu label={label} disabled={disabled} triggerClass="field r4-choice" minWidth={220}
    button={() => <><span>{options.find(o => o.value === value)?.label}</span><Icon name="chevronDown" size={14} /></>}>
    {close => options.map(o => <MenuItem key={o.value} checked={o.value === value} onClick={() => { onChange(o.value); close(); }}>{o.label}</MenuItem>)}
  </Menu>;
}

function R4Secret({ label, value, onChange, stored, onClear, disabled, optional = false }) {
  const { lang } = useI18n();
  const zh = lang === 'zh';
  const id = React.useId();
  const [edit, setEdit] = React.useState(!stored);
  const [show, setShow] = React.useState(false);
  React.useEffect(() => { setEdit(!stored); setShow(false); }, [stored]);
  return <div className="r4-input"><label htmlFor={edit ? id : undefined}>{label}</label>
    {stored && !edit ? <div className="r4-secret"><span className="hint">{zh ? '已保存' : 'Saved'}</span><Button disabled={disabled} size="sm" onClick={() => setEdit(true)}>{zh ? '替换' : 'Replace'}</Button><Button disabled={disabled} size="sm" variant="ghost" onClick={() => { onClear(); setEdit(true); }}>{zh ? '移除' : 'Remove'}</Button></div>
      : <><div className="r4-secret"><input id={id} className="field" type={show ? 'text' : 'password'} value={value} autoComplete="new-password" disabled={disabled} onChange={e => onChange(e.target.value)} placeholder={stored ? zh ? '留空保留已保存的凭据' : 'Leave blank to keep saved credentials' : optional ? zh ? '可选' : 'Optional' : zh ? '输入密码' : 'Enter password'} /><Button size="sm" variant="ghost" disabled={disabled || !value} aria-pressed={show} onClick={() => setShow(!show)}>{show ? zh ? '隐藏' : 'Hide' : zh ? '显示' : 'Show'}</Button></div>{stored && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { onChange(''); setEdit(false); setShow(false); }}>{zh ? '取消替换' : 'Cancel replacement'}</Button>}</>}
  </div>;
}

function R4MetadataSettings({ app }) {
  const { lang } = useI18n();
  const zh = lang === 'zh';
  const initial = app.config.metadataDraft ?? { enabled: true, route: 'protected', method: 'http', tls: true, host: '', port: '443', auth: false, username: '', password: '', key: '', passwordStored: false, keyStored: false };
  const [draft, setDraft] = React.useState(initial);
  const [saved, setSaved] = React.useState(initial);
  const [status, setStatus] = React.useState('');
  const [errors, setErrors] = React.useState({});
  const timer = React.useRef();
  const attempts = React.useRef(0);
  const locked = !!app.config.metadataLocked;
  const busy = status === 'testing';
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  function change(patch) { clearTimeout(timer.current); setDraft(prev => ({ ...prev, ...patch })); setErrors({}); setStatus(''); }
  function validate() {
    const next = {};
    if (draft.enabled && draft.route === 'protected' && draft.method !== 'relay') {
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
    const next = { ...draft, passwordStored: draft.auth && (!!draft.password || draft.passwordStored), keyStored: !!draft.key || draft.keyStored, password: '', key: '' };
    setDraft(next); setSaved(next); app.updateConfig({ metadataDraft: next }); setStatus('saved');
  }
  const protectedRoute = draft.enabled && draft.route === 'protected';
  const labels = [{ value: 'relay', label: zh ? '中继' : 'Relay' }, { value: 'http', label: 'HTTP(S)' }, { value: 'socks', label: 'SOCKS5' }];
  return <section id="r4-meta"><header><h2>{zh ? '网页信息' : 'Page metadata'}</h2></header>
    <form className="st-body r4-form" noValidate onSubmit={save}>
      <div className="r3-setting"><div><label htmlFor="r4-enabled">{zh ? '自动获取网页信息' : 'Fetch page metadata'}</label><p className="hint">{zh ? '创建短链接时获取标题与网站图标。' : 'Fetch titles and site icons when creating links.'}</p></div><Switch id="r4-enabled" label={zh ? '自动获取网页信息' : 'Fetch page metadata'} checked={draft.enabled} disabled={locked || busy} onChange={enabled => change({ enabled })} /></div>
      {locked && <p className="hint r4-notice"><Icon name="lock" />{zh ? '当前连接方式由环境变量固定，后台显示有效值。' : 'Environment variables lock the current connection settings.'}</p>}
      {draft.enabled ? <>
        <div className="r3-setting r4-route"><label>{zh ? '连接方式' : 'Connection'}</label><R4Choice label={zh ? '连接方式' : 'Connection'} value={draft.route} disabled={locked || busy} options={[{ value: 'direct', label: zh ? '直接连接' : 'Direct connection' }, { value: 'protected', label: zh ? '中继或代理' : 'Relay or proxy' }]} onChange={route => change({ route })} /></div>
        {!protectedRoute && <p className="hint">{zh ? '目标网站会看到服务器的出口 IP。' : 'Destination sites can see your server’s outgoing IP.'}</p>}
        {protectedRoute && <fieldset className="r4-panel" disabled={locked || busy}>
          <legend className="sr-only">{zh ? '中继或代理设置' : 'Relay or proxy settings'}</legend>
          <Segmented value={draft.method} label={zh ? '代理方式' : 'Proxy method'} options={labels} onChange={method => change({ method })} />
          <div className="r4-method-body">
            {draft.method === 'relay' ? <>
              <div className="r4-provider"><span>Jina Reader</span><span className="hint">{zh ? '网页标题' : 'Page titles'}</span></div>
              <p className="hint">{zh ? '中继会收到完整目标网址。此模式只获取标题，图标使用本地字母图标。' : 'The relay receives the full destination URL. This mode fetches titles only; icons use local initials.'}</p>
              <R4Secret key="relay" optional label={zh ? 'API 密钥（可选）' : 'API key (optional)'} value={draft.key} stored={draft.keyStored} disabled={locked || busy} onChange={key => change({ key })} onClear={() => change({ key: '', keyStored: false })} />
              <p className="hint">{zh ? '不填密钥也可使用，额度与可用性由服务商决定。' : 'A key is optional. Limits and availability depend on the provider.'}</p>
            </> : <>
              <div className="r4-address"><div className="r4-input"><label htmlFor="r4-host">{zh ? '代理主机' : 'Proxy host'}</label><input id="r4-host" className="field" value={draft.host} autoComplete="off" spellCheck="false" placeholder="proxy.example.com" aria-invalid={!!errors.host} aria-describedby={errors.host ? 'r4-host-error' : undefined} onChange={e => change({ host: e.target.value })} /></div><div className="r4-input"><label htmlFor="r4-port">{zh ? '端口' : 'Port'}</label><input id="r4-port" className="field" value={draft.port} inputMode="numeric" autoComplete="off" aria-invalid={!!errors.port} aria-describedby={errors.port ? 'r4-port-error' : undefined} onChange={e => change({ port: e.target.value })} /></div></div>
              {errors.host && <p id="r4-host-error" className="error-text" role="alert">{errors.host}</p>}
              {errors.port && <p id="r4-port-error" className="error-text" role="alert">{errors.port}</p>}
              {draft.method === 'http' ? <div className="r3-setting"><div><label htmlFor="r4-tls">{zh ? '加密连接到代理（HTTPS）' : 'Encrypt connection to proxy (HTTPS)'}</label><p className="hint">{zh ? '代理服务需要支持 HTTPS。关闭后使用 HTTP。' : 'Requires an HTTPS proxy. Turn off to use HTTP.'}</p></div><Switch id="r4-tls" label={zh ? '加密连接到代理（HTTPS）' : 'Encrypt connection to proxy (HTTPS)'} checked={draft.tls} onChange={tls => change({ tls })} /></div> : <p className="hint">{zh ? 'SOCKS5 不加密到代理的连接。账号密码仅用于认证。' : 'SOCKS5 does not encrypt the connection to the proxy. Credentials provide authentication only.'}</p>}
              <div className="r3-setting"><label htmlFor="r4-auth">{zh ? '身份认证' : 'Authentication'}</label><Switch id="r4-auth" label={zh ? '身份认证' : 'Authentication'} checked={draft.auth} onChange={auth => change({ auth })} /></div>
              {draft.auth && <div className="r4-auth-fields"><div className="r4-input"><label htmlFor="r4-user">{zh ? '用户名' : 'Username'}</label><input id="r4-user" className="field" autoComplete="off" value={draft.username} onChange={e => change({ username: e.target.value })} /></div><R4Secret key="password" label={zh ? '密码' : 'Password'} value={draft.password} stored={draft.passwordStored} disabled={locked || busy} onChange={password => change({ password })} onClear={() => change({ password: '', passwordStored: false })} /></div>}
              {errors.auth && <p className="error-text" role="alert">{errors.auth}</p>}
            </>}
          </div>
          <p className="hint r4-policy"><Icon name="lock" size={14} />{zh ? '连接失败时不自动回退到直连。' : 'Connection failures never fall back to direct requests.'}</p>
        </fieldset>}
      </> : <p className="hint">{zh ? '不再发起网页信息请求。你仍可手动填写标题。' : 'No new metadata requests. You can still enter titles manually.'}</p>}
      <div className="r4-actions"><Button type="submit" disabled={!dirty || locked || busy}>{zh ? '保存' : 'Save'}</Button>{protectedRoute && <Button disabled={locked} loading={busy} onClick={test}>{busy ? zh ? '正在测试' : 'Testing' : status === 'failed' ? zh ? '重试连接' : 'Retry connection' : zh ? '测试连接' : 'Test connection'}</Button>}</div>
      <div className={cx('r4-feedback', status === 'failed' ? 'error-text' : 'hint')} role="status" aria-live="polite">
        {status === 'saved' ? zh ? '已保存，新请求将使用此设置。' : 'Saved. New requests will use these settings.' : status === 'passed' ? zh ? '连接成功，已获取测试页面标题。尚未保存的设置不会生效。' : 'Connected and fetched the test page title. Unsaved changes are not applied.' : status === 'failed' ? zh ? '连接超时。请检查地址、端口和认证后重试。当前设置未改变。' : 'Connection timed out. Check the host, port and credentials, then retry. Current settings are unchanged.' : status === 'testing' ? zh ? '正在通过当前配置访问 example.com…' : 'Requesting example.com through this configuration…' : dirty ? zh ? '有尚未保存的更改' : 'Unsaved changes' : ''}
      </div>
    </form>
  </section>;
}

Object.assign(window, { R4Choice, MetadataSettings: R4MetadataSettings });
