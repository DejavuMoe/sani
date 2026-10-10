/*
 * Layer 4 — screens, one per web/src/views file plus App.svelte's offline
 * state. Each takes `app` (prefs, navigation, store, toasts) from layer 5 and
 * an optional `initial` to open in a given state.
 */
const { useState: useSt, useRef: useRf, useEffect: useEf } = React;

/* ---- Dashboard.svelte ---- */

function Dashboard({ app, initial = {} }) {
  const { t } = useI18n();
  const { store, toasts } = app;
  const composer = useRf(null);
  const list = useRf(null);
  const sref = useRf(store);
  sref.current = store;

  useEf(() => {
    const rowButton = (id) => document.querySelector(`[data-link="${id}"] .lr-main`);
    const overlayOpen = () => {
      try {
        return !!document.querySelector('dialog[open], :popover-open');
      } catch {
        return !!document.querySelector('dialog[open]');
      }
    };
    function move(delta) {
      const s = sref.current;
      if (!s.items.length) return false;
      let i = s.items.findIndex((l) => l.id === s.selectedId);
      i = i < 0 ? (delta > 0 ? 0 : s.items.length - 1) : Math.max(0, Math.min(s.items.length - 1, i + delta));
      s.setSelected(s.items[i].id);
      const el = rowButton(s.items[i].id);
      el?.focus({ preventScroll: true });
      el?.closest('.lr')?.scrollIntoView({ block: 'nearest' });
      return true;
    }
    function removeSelected(e) {
      const s = sref.current;
      if (s.picked.size) {
        e.preventDefault();
        return s.bulk('delete');
      }
      const l = s.items.find((x) => x.id === s.selectedId);
      if (!l) return;
      e.preventDefault();
      s.remove(l);
    }
    function onKeyDown(e) {
      const s = sref.current;
      if (overlayOpen()) return;
      if (isMac && e.key === 'Backspace' && e.metaKey && !isTyping(e.target)) return removeSelected(e);
      if (e.key === 'Escape' && !isTyping(e.target)) {
        if (s.editingId !== null) s.setEditing(null);
        else if (s.expandedId !== null) {
          const id = s.expandedId;
          s.setExpanded(null);
          rowButton(id)?.focus();
        } else if (s.picking) s.stopPicking();
        else if (s.query) s.search('');
        else s.setSelected(null);
        return;
      }
      if (!plainKey(e)) return;
      const onButton = e.target.closest?.('button, a');
      const sel = s.items.find((l) => l.id === s.selectedId);
      switch (e.key) {
        case '/':
          e.preventDefault();
          list.current?.focusSearch();
          break;
        case 'n':
          e.preventDefault();
          composer.current?.focus();
          break;
        case '?':
          e.preventDefault();
          app.setShortcuts(true);
          break;
        case 'j':
        case 'ArrowDown':
          if (move(1)) e.preventDefault();
          break;
        case 'k':
        case 'ArrowUp':
          if (move(-1)) e.preventDefault();
          break;
        case 'Enter':
          if (!sel || onButton) return;
          e.preventDefault();
          if (s.picking) s.togglePick(sel.id);
          else s.setExpanded(s.expandedId === sel.id ? null : sel.id);
          break;
        case 'x':
        case 'X':
          if (!sel) return;
          e.preventDefault();
          s.togglePick(sel.id, e.shiftKey);
          break;
        case 'c':
          if (!sel) return;
          e.preventDefault();
          copyText(sel.shortUrl).then((ok) => ok && toasts.success(t('act.copied'), { detail: stripScheme(sel.shortUrl) }));
          break;
        case 'e':
          if (!sel || s.picking) return;
          e.preventDefault();
          s.setExpanded(sel.id);
          s.setEditing(sel.id);
          break;
        case 'Delete':
          removeSelected(e);
          break;
      }
    }
    function onPaste(e) {
      if (isTyping(e.target) || document.querySelector('dialog[open]')) return;
      const file = e.clipboardData?.files[0];
      if (file) {
        e.preventDefault();
        return composer.current?.fillFile(file);
      }
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const url = extractURL(text);
      if (url && (url === text.trim() || !text.includes('\n'))) {
        e.preventDefault();
        composer.current?.fill(url, 'paste');
      } else if (text.trim()) {
        e.preventDefault();
        composer.current?.fillText(text);
      }
    }
    function onDragOver(e) {
      const types = e.dataTransfer?.types ?? [];
      if (types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain')) e.preventDefault();
    }
    function onDrop(e) {
      if (isTyping(e.target)) return;
      const data = e.dataTransfer;
      const file = data?.files[0];
      if (file) {
        e.preventDefault();
        return composer.current?.fillFile(file);
      }
      const url = extractURL(data?.getData('text/uri-list').split('\n')[0] || data?.getData('text/plain') || '');
      if (!url) return;
      e.preventDefault();
      composer.current?.fill(url, 'drop');
    }
    addEventListener('keydown', onKeyDown);
    addEventListener('dragover', onDragOver);
    addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
    return () => {
      removeEventListener('keydown', onKeyDown);
      removeEventListener('dragover', onDragOver);
      removeEventListener('drop', onDrop);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  return (
    <>
      <AppHeader route="dashboard" theme={app.theme} onCycleTheme={app.cycleTheme} onShortcuts={() => app.setShortcuts(true)} onNavigate={app.go} />
      <main className="dash" data-screen-label="dashboard">
        <h1 className="sr-only">Sani</h1>
        <Creator ref={composer} store={store} toasts={toasts} config={app.config} initialMode={initial.mode} initial={initial.composer} />
        <Summary overview={store.overview} /><SummaryScope/>
        <LinkList ref={list} store={store} toasts={toasts} />
      </main>
    </>
  );
}

/* ---- Login.svelte ---- */

function Login({ app, initial = {} }) {
  const { t } = useI18n();
  const [password, setPassword] = useSt(initial.password ?? '');
  const [busy, setBusy] = useSt(false);
  const [error, setError] = useSt(initial.error ? t(initial.error === 'rate' ? 'auth.rateLimited' : 'auth.wrong', { s: 42 }) : '');
  const [wait, setWait] = useSt(initial.error === 'rate' ? 42 : 0);
  const [shake, setShake] = useSt(false);
  const field = useRf(null);

  async function submit(e) {
    e.preventDefault();
    if (busy || wait > 0 || !password) return;
    setBusy(true);
    setError('');
    await new Promise((r) => setTimeout(r, 450));
    setBusy(false);
    if (password === 'sani-demo') return app.signIn();
    setError(t('auth.wrong'));
    setShake(true);
    field.current?.select();
  }

  return (
    <AuthShell theme={app.theme} onToggleLang={app.toggleLang} onCycleTheme={app.cycleTheme}>
      <form className="login-form" onSubmit={submit} data-screen-label="login">
        <h1 className="sr-only">Sani</h1>
        {initial.expired && <p className="login-notice">{t('auth.expired')}</p>}
        <input className="sr-only" type="text" name="username" autoComplete="username" value="sani" readOnly tabIndex={-1} aria-hidden="true" />
        <label className="label" htmlFor="password">
          {t('auth.password')}
        </label>
        <input
          ref={field}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          id="password"
          name="password"
          className={cx('field', shake && 'shake')}
          type="password"
          autoComplete="current-password"
          autoFocus
          aria-invalid={!!error || undefined}
          aria-describedby={error ? 'login-error' : undefined}
          onAnimationEnd={() => setShake(false)}
        />
        {error && (
          <p className="error-text" id="login-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={wait > 0}>
          {busy ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
      </form>
    </AuthShell>
  );
}

/* ---- Setup.svelte ---- */

function Setup({ app, initial = {} }) {
  const { t } = useI18n();
  const [code, setCode] = useSt(initial.code ?? '');
  const [password, setPassword] = useSt(initial.password ?? '');
  const [confirm, setConfirm] = useSt(initial.confirm ?? '');
  const [busy, setBusy] = useSt(false);
  const [error, setError] = useSt(initial.error ? { field: initial.error, text: t(initial.error === 'code' ? 'err.setup_code' : initial.error === 'password' ? 'setup.short' : 'setup.mismatch') } : null);
  const hint = t('setup.codeHint').split(/(\{cmd\})/);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (!code.trim()) return setError({ field: 'code', text: t('setup.codeMissing') });
    if ([...password].length < 8) return setError({ field: 'password', text: t('setup.short') });
    if (password !== confirm) return setError({ field: 'confirm', text: t('setup.mismatch') });
    setBusy(true);
    setError(null);
    await new Promise((r) => setTimeout(r, 450));
    setBusy(false);
    app.signIn();
  }

  return (
    <AuthShell theme={app.theme} onToggleLang={app.toggleLang} onCycleTheme={app.cycleTheme}>
      <form className="setup-form" onSubmit={submit} noValidate data-screen-label="setup">
        <h1>{t('setup.title')}</h1>
        <p className="setup-lead">{t('setup.lead')}</p>
        <input className="sr-only" type="text" name="username" autoComplete="username" value="sani" readOnly tabIndex={-1} aria-hidden="true" />
        <label className="label" htmlFor="setup-code">
          {t('setup.code')}
        </label>
        <input
          id="setup-code"
          className="field mono setup-code"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck="false"
          maxLength={64}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus={!code}
          aria-invalid={error?.field === 'code' || undefined}
          aria-describedby="code-hint"
        />
        {error?.field === 'code' ? (
          <p className="error-text" id="code-hint" role="alert">
            {error.text}
          </p>
        ) : (
          <p className="hint" id="code-hint">
            {hint.map((part, i) => (part === '{cmd}' ? <code key={i}>docker logs sani</code> : <React.Fragment key={i}>{part}</React.Fragment>))}
          </p>
        )}
        <label className="label setup-second" htmlFor="new-password">
          {t('setup.password')}
        </label>
        <input
          id="new-password"
          className="field"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error?.field === 'password' || undefined}
          aria-describedby="password-hint"
        />
        {error?.field === 'password' ? (
          <p className="error-text" id="password-hint" role="alert">
            {error.text}
          </p>
        ) : (
          <p className="hint" id="password-hint">
            {t('setup.short')}
          </p>
        )}
        <label className="label setup-second" htmlFor="confirm-password">
          {t('setup.confirm')}
        </label>
        <input
          id="confirm-password"
          className="field"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={error?.field === 'confirm' || undefined}
        />
        {(error?.field === 'confirm' || error?.field === 'other') && (
          <p className="error-text" role="alert">
            {error.text}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          {t('setup.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}

/* ---- App.svelte, offline ---- */

function Offline({ app }) {
  const { t } = useI18n();
  return (
    <main className="offline" data-screen-label="offline">
      {/* r1: the message is the page's heading. */}
      <h1 className="offline-msg">{t('err.network')}</h1>
      <Button onClick={app.retry}>{t('act.retry')}</Button>
    </main>
  );
}

/* ---- NewLink.svelte ---- */

function NewLink({ app, initial = {} }) {
  const { t } = useI18n();
  const composer = useRf(null);
  const [created, setCreated] = useSt(initial.created ?? null);
  const [copied, setCopied] = useSt(!!initial.created);
  const popup = !!initial.popup;

  useEf(() => {
    if (!initial.shared || created) return;
    composer.current?.fill(initial.shared, 'prefill', initial.title ?? '');
    composer.current?.submitNow(initial.shared);
  }, []);

  return (
    <main className="nl" data-screen-label="new">
      <header className="nl-head">
        <Logo size={18} />
        {/* r1: the page's name is its heading. */}
        <h1 className="nl-title">{t('new.title')}</h1>
      </header>
      {created ? (
        <div className="nl-result">
          <QRCode value={created.shortUrl} size={120} label={t('detail.qrLabel', { url: stripScheme(created.shortUrl) })} />
          <a className="nl-short" href={created.shortUrl} target="_blank" rel="noopener">
            {stripScheme(created.shortUrl)}
          </a>
          {created.title && <p className="nl-page">{created.title}</p>}
          <div className="nl-actions">
            <Button
              variant="primary"
              icon={copied ? 'check' : 'copy'}
              onClick={async () => {
                const ok = await copyText(created.shortUrl);
                setCopied(ok);
                if (ok) app.toasts.success(t('act.copied'), { detail: stripScheme(created.shortUrl) });
              }}
            >
              {copied ? t('act.copied') : t('act.copy')}
            </Button>
            {popup ? (
              <Button variant="ghost">{t('new.closeWindow')}</Button>
            ) : (
              <Button variant="ghost" onClick={() => app.go('dashboard')}>
                {t('act.back')}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Composer
          ref={composer}
          store={app.store}
          toasts={app.toasts}
          reuse
          autofocus
          onCreated={(link, ok) => {
            setCreated(link);
            setCopied(ok);
          }}
        />
      )}
    </main>
  );
}

/* ---- Settings.svelte ---- */

function Settings({ app, initial = {} }) {
  const { t, errorText, formatDate, formatRelative, lang } = useI18n();
  const { toasts } = app;
  const config = app.config;
  const [baseUrl, setBaseUrl] = useSt(config.baseUrlSource === 'setting' ? config.baseUrl : '');
  const [baseBusy, setBaseBusy] = useSt(false);
  const [tokens, setTokens] = useSt(initial.noTokens ? [] : FIX.tokens);
  const [tokenState, setTokenState] = useSt(initial.tokenError ? 'error' : 'ready');
  const [tokenName, setTokenName] = useSt('');
  const [tokenBusy, setTokenBusy] = useSt(false);
  const [tokenError, setTokenError] = useSt('');
  const [revealed, setRevealed] = useSt(initial.revealed ? { ...FIX.tokens[0], token: 'sani_' + 'x'.repeat(40) } : null);
  const [confirming, setConfirming] = useSt(null);
  const [importing, setImporting] = useSt(false);
  const [importResult, setImportResult] = useSt(initial.imported ? { created: 12, skipped: [{ slug: 'gh', reason: 'slug_taken' }, { row: 7, reason: 'url_invalid' }] } : null);
  const [dragOver, setDragOver] = useSt(false);
  const [current, setCurrent] = useSt('');
  const [next, setNext] = useSt('');
  const [pwError, setPwError] = useSt('');
  const apiOrigin = config.baseUrl;
  const curl = `curl -X POST ${apiOrigin}/api/links \\\n  -H "Authorization: Bearer ${revealed?.token ?? 'sani_…'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"url": "https://example.com/some/long/path"}'`;
  const reason = (r) => {
    const s = t(`reason.${r}`);
    return s === `reason.${r}` ? r : s;
  };
  const copy = async (text) => (await copyText(text)) && toasts.success(t('act.copied'));
  const later = (fn, ms = 400) => new Promise((r) => setTimeout(() => r(fn()), ms));

  return (
    <>
      <AppHeader route="settings" theme={app.theme} onCycleTheme={app.cycleTheme} onShortcuts={() => app.setShortcuts(true)} onNavigate={app.go} />
      <main className="st" data-screen-label="settings">
        <a className="st-back" href="#dashboard" onClick={(e) => (e.preventDefault(), app.go('dashboard'))}>
          <Icon name="arrowLeft" size={14} />
          {t('act.back')}
        </a>
        <h1>{t('settings.title')}</h1>

        <section>
          <header>
            <h2>{t('settings.appearance')}</h2>
          </header>
          <div className="st-body">
            <div className="st-row">
              <span className="k">{t('settings.theme')}</span>
              <Segmented
                label={t('settings.theme')}
                value={app.theme}
                onChange={app.setTheme}
                options={[
                  { value: 'system', label: t('theme.system'), icon: 'monitor' },
                  { value: 'light', label: t('theme.light'), icon: 'sun' },
                  { value: 'dark', label: t('theme.dark'), icon: 'moon' },
                ]}
              />
            </div>
            <div className="st-row">
              <span className="k">{t('settings.language')}</span>
              <Segmented
                label={t('settings.language')}
                value={lang}
                onChange={app.setLang}
                options={[
                  { value: 'zh', label: '中文' },
                  { value: 'en', label: 'English' },
                ]}
              />
            </div>
          </div>
        </section>

        <section>
          <header>
            <h2>{t('settings.domain')}</h2>
          </header>
          <div className="st-body">
            {config.baseUrlSource === 'env' ? (
              <p className="st-text">{t('settings.domainEnv', { url: config.baseUrl })}</p>
            ) : (
              <>
                <form
                  className="st-inline-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBaseBusy(true);
                    await later(() => toasts.success(t('settings.domainSaved')));
                    setBaseBusy(false);
                  }}
                >
                  <input
                    className="field mono"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={config.requestOrigin}
                    inputMode="url"
                    autoComplete="off"
                    spellCheck="false"
                    aria-label={t('settings.domain')}
                  />
                  <Button type="submit" loading={baseBusy}>
                    {t('act.save')}
                  </Button>
                </form>
                <p className="hint">{t('settings.domainHint', { origin: config.requestOrigin })}</p>
              </>
            )}
          </div>
        </section>

        <DefaultsSettings app={app} />
        <MetadataSettings app={app} />

        <section>
          <header>
            <h2>{t('settings.tokens')}</h2>
            <p>{t('settings.tokensHint')}</p>
          </header>
          <div className="st-body">
            <form
              className="st-inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!tokenName.trim()) return setTokenError(t('err.name_invalid'));
                setTokenBusy(true);
                setTokenError('');
                await later(() => {
                  const tok = { id: Date.now(), name: tokenName.trim(), hint: 'sani_' + Math.random().toString(36).slice(2, 6), createdAt: new Date().toISOString(), usedAt: null };
                  setRevealed({ ...tok, token: 'sani_' + 'x'.repeat(40) });
                  setTokens((xs) => [tok, ...xs]);
                  setTokenName('');
                });
                setTokenBusy(false);
              }}
            >
              <input
                className="field"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder={t('settings.tokenNamePlaceholder')}
                maxLength={60}
                aria-label={t('settings.tokenName')}
                aria-invalid={!!tokenError || undefined}
              />
              <Button type="submit" icon="plus" loading={tokenBusy} disabled={tokenState!=="ready"}>
                {t('settings.tokenCreate')}
              </Button>
            </form>
            {tokenError && <p className="error-text">{tokenError}</p>}
            {revealed?.token && (
              <div className="st-reveal">
                <p className="st-reveal-note">
                  <Icon name="key" size={14} />
                  {t('settings.tokenOnce')}
                </p>
                <div className="st-secret">
                  <code>{revealed.token}</code>
                  <Button size="sm" icon="copy" onClick={() => copy(revealed.token)}>
                    {t('act.copy')}
                  </Button>
                </div>
                <p className="k small">{t('settings.tokenExample')}</p>
                <div className="st-code">
                  {/* r1: it scrolls sideways on phones, so it takes focus. */}
                  <pre tabIndex={0} role="region" aria-label={t('settings.tokenExample')}>
                    {curl}
                  </pre>
                  <button className="st-code-copy" aria-label={t('act.copy')} onClick={() => copy(curl)}>
                    <Icon name="copy" size={14} />
                  </button>
                </div>
              </div>
            )}
            {tokenState !== 'ready' ? <div className="r7-notice error" role="status"><span>{tokenState === 'loading' ? lang === 'zh' ? '正在读取令牌…' : 'Loading tokens…' : lang === 'zh' ? '无法读取令牌列表，当前令牌数量未知。' : 'Could not read token list. The token count is unknown.'}</span><Button size="sm" loading={tokenState==='loading'} onClick={()=>{setTokenState('loading');setTimeout(()=>setTokenState('ready'),700);}}>{t('act.retry')}</Button></div> : tokens.length > 0 ? (
              <ul className="st-tokens">
                {tokens.map((tok) => (
                  <li key={tok.id}>
                    <Icon name="key" size={14} className="tok-icon" />
                    <div className="st-tok-main">
                      <span className="st-tok-name">{tok.name}</span>
                      <span className="st-tok-meta">
                        <code>{tok.hint}…</code> · {formatDate(tok.createdAt)} · {tok.usedAt ? t('settings.tokenUsed', { time: formatRelative(tok.usedAt) }) : t('settings.tokenUnused')}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant={confirming === tok.id ? 'danger' : 'ghost'}
                      onClick={() => {
                        if (confirming !== tok.id) {
                          setConfirming(tok.id);
                          setTimeout(() => setConfirming(null), 3500);
                          return;
                        }
                        setConfirming(null);
                        setTokens((xs) => xs.filter((x) => x.id !== tok.id));
                        if (revealed?.id === tok.id) setRevealed(null);
                        toasts.show(t('settings.tokenRevoked', { name: tok.name }));
                      }}
                    >
                      {confirming === tok.id ? t('settings.tokenConfirm') : t('settings.tokenRevoke')}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="st-empty">{t('settings.tokensEmpty')}</p>
            )}
          </div>
        </section>

        <section>
          <header>
            <h2>{t('settings.tools')}</h2>
          </header>
          <div className="st-body">
            <div className="st-tool">
              <div>
                <h3>{t('settings.bookmarklet')}</h3>
                <p className="hint">{t('settings.bookmarkletHint')}</p>
              </div>
              <a className="st-bookmarklet" href="#bookmarklet" onClick={(e) => (e.preventDefault(), toasts.show(t('settings.bookmarkletDrag')))} draggable="true">
                <Icon name="bookmark" size={14} />
                {t('settings.bookmarkletButton')}
              </a>
            </div>
            <div className="st-tool">
              <div>
                <h3>{t('settings.install')}</h3>
                <p className="hint">{t('settings.installHint')}</p>
              </div>
            </div>
          </div>
        </section>

        <DataSettings app={app} />

        <section>
          <header>
            <h2>{t('settings.account')}</h2>
          </header>
          <div className="st-body">
            {config.passwordFromEnv ? (
              <p className="st-text">{t('settings.passwordEnv')}</p>
            ) : (
              <form
                className="st-password"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setPwError('');
                  if ([...next].length < 8) return setPwError(t('err.password_short'));
                  await later(() => {
                    setCurrent('');
                    setNext('');
                    toasts.success(t('settings.passwordChanged'));
                  });
                }}
              >
                <h3>{t('settings.passwordChange')}</h3>
                <input className="sr-only" type="text" autoComplete="username" value="sani" readOnly tabIndex={-1} aria-hidden="true" />
                <div className="st-pw-grid">
                  <label>
                    <span className="label">{t('settings.passwordCurrent')}</span>
                    <input className="field" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">{t('settings.passwordNew')}</span>
                    <input className="field" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
                  </label>
                </div>
                {pwError && <p className="error-text">{pwError}</p>}
                <div className="st-actions">
                  <Button type="submit" disabled={!current || !next}>
                    {t('settings.passwordChange')}
                  </Button>
                </div>
              </form>
            )}
            <div className="st-actions spaced">
              <Button variant="ghost" icon="lock" onClick={() => toasts.success(t('settings.sessionsRevoked'))}>
                {t('settings.sessionsRevoke')}
              </Button>
              <Button variant="ghost" icon="logout" onClick={app.signOut}>
                {t('auth.signOut')}
              </Button>
            </div>
          </div>
        </section>

        <section>
          <header>
            <h2>{t('settings.about')}</h2>
          </header>
          <div className="st-body">
            <dl className="st-about">
              <div>
                <dt>{t('settings.version')}</dt>
                <dd className="mono">{config.version ?? '–'}</dd>
              </div>
              <div>
                <dt>{t('settings.timezone')}</dt>
                <dd>{config.timezone ?? '–'}</dd>
              </div>
              <div>
                <dt>{t('settings.files')}</dt>
                <dd className={config.filesUrl ? 'mono' : ''}>{config.filesUrl ?? t('settings.filesOff')}</dd>
              </div>
            </dl>
          </div>
        </section>
      </main>
    </>
  );
}

Object.assign(window, { Dashboard, Login, Setup, Offline, NewLink, Settings });
