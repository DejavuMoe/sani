/*
 * Layer 5 — the clickable app (App.svelte + session + router), with scenes:
 * `?scene=<id>` opens any screen in a given state (scenes.jsx). The screens
 * board and the comparison tool load scenes in frames, so every screen shown
 * anywhere is this app.
 *
 *   ?scene=dashboard&theme=dark&lang=en&now=live&chrome=0
 */

function resolveTheme(pref) {
  return pref === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref;
}

function App() {
  const params = React.useMemo(() => new URLSearchParams(location.search), []);
  const env = React.useMemo(readParams, []);
  const sceneId = SCENES[params.get('scene')] ? params.get('scene') : 'r4-settings';
  const scene = SCENES[sceneId];
  const chrome = params.get('chrome') !== '0';
  React.useEffect(() => { if (sceneId.startsWith('r4-')) document.getElementById('r4-meta')?.scrollIntoView({ block: 'start' }); }, []);

  const [theme, setThemeState] = React.useState(env.theme && ['system', 'light', 'dark'].includes(env.theme) ? env.theme : 'system');
  const [lang, setLang] = React.useState(env.lang === 'en' ? 'en' : env.lang === 'zh' ? 'zh' : /^zh/i.test(navigator.language) ? 'zh' : 'en');
  const [session, setSession] = React.useState(scene.session ?? 'ready');
  const [route, setRoute] = React.useState(scene.route ?? 'dashboard');
  const [shortcuts, setShortcuts] = React.useState(!!scene.shortcuts);
  const i18n = React.useMemo(() => makeI18n(lang, env.now), [lang]);
  const toasts = useToasts();
  const preset = typeof scene.store === 'function' ? scene.store() : scene.store ?? {};
  const store = useLinksStore({ toasts, i18n, preset, latency: Number(params.get('latency') ?? 220) });
  const [config, setConfig] = React.useState(() => { const initial = { ...FIX.config, ...(scene.config ?? {}) }; Object.assign(FIX.config, initial); return initial; });
  const updateConfig = patch => { Object.assign(FIX.config, patch); setConfig(prev => ({ ...prev, ...patch })); };

  React.useLayoutEffect(() => {
    const d = document.documentElement;
    d.dataset.theme = resolveTheme(theme);
    d.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [theme, lang]);

  React.useEffect(() => {
    if (!scene.toasts) return;
    toasts.success(i18n.t('created.copied'), { detail: 's.example.com/k3x9p', duration: 0 });
    toasts.show(i18n.t('detail.deleted', { slug: '/talk' }), { action: { label: i18n.t('act.undo'), run() {} }, duration: 0 });
    toasts.error(i18n.t('err.network'), { duration: 0 });
  }, []);

  React.useEffect(() => {
    if (!preset.expandedId) return;
    const row = document.querySelector(`[data-link="${preset.expandedId}"]`);
    if (row) scrollTo({ top: row.getBoundingClientRect().top + scrollY - 64, behavior: 'instant' });
  }, []);

  const order = ['system', 'light', 'dark'];
  const app = {
    theme,
    config,
    updateConfig,
    store,
    toasts,
    setTheme: setThemeState,
    cycleTheme: () => setThemeState((t) => order[(order.indexOf(t) + 1) % order.length]),
    setLang,
    toggleLang: () => setLang((l) => (l === 'zh' ? 'en' : 'zh')),
    setShortcuts,
    go: (to) => {
      setRoute(to);
      scrollTo(0, 0);
    },
    signIn: () => setSession('ready'),
    signOut: () => setSession('login'),
    retry: () => setSession('ready'),
  };

  const composerInitial = (() => {
    const c = scene.dashboard?.composer;
    if (!c) return undefined;
    const out = { ...c };
    if (c.file === 'sample') out.file = sampleFile();
    if (c.file === 'large') out.file = { name: 'project-assets.zip', size: 72000000, type: 'application/zip' };
    if (c.note) out.note = i18n.t(c.note, { keys: `${mod} ↵` });
    if (c.error?.code) out.error = { field: c.error.field, text: i18n.errorText(c.error.code) };
    return out;
  })();

  let screen;
  if (session === 'setup') screen = <Setup app={app} initial={scene.setup} />;
  else if (session === 'login') screen = <Login app={app} initial={scene.login} />;
  else if (session === 'offline') screen = <Offline app={app} />;
  else if (route === 'settings') screen = <Settings app={app} initial={scene.settings} />;
  else if (route === 'new') screen = <NewLink app={app} initial={typeof scene.newLink === 'function' ? scene.newLink() : scene.newLink} />;
  else screen = <Dashboard app={app} initial={{ mode: scene.dashboard?.mode, composer: composerInitial }} />;

  return (
    <EnvCtx.Provider value={{ lang, now: env.now, host: env.host }}>
      {screen}
      {session === 'ready' && <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />}
      <Toaster toasts={toasts} />
      {chrome && <Tweaks sceneId={sceneId} theme={theme} lang={lang} />}
    </EnvCtx.Provider>
  );
}

/** Prototype chrome, not product UI: jump between scenes, themes, languages. */
function Tweaks({ sceneId, theme, lang }) {
  const [open, setOpen] = React.useState(false);
  const go = (patch) => {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) p.set(k, v);
    location.search = p.toString();
  };
  const options = Object.entries(SCENES).filter(([id]) => id.startsWith('r4-')).map(([id]) => ({ value: id, label: id }));
  return <div className="tweaks" data-proto-chrome="">
    {open && <div className="tweaks-panel">
      <R4Choice label="Scene" value={sceneId} options={options} onChange={scene => go({ scene })} />
      <R4Choice label="Theme" value={theme} options={['system', 'light', 'dark'].map(value => ({ value, label: value }))} onChange={theme => go({ theme })} />
      <R4Choice label="Language" value={lang} options={['zh', 'en'].map(value => ({ value, label: value }))} onChange={lang => go({ lang })} />
      <a href="index.html">layers ↗</a>
    </div>}
    <button type="button" className="tweaks-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>Tweaks</button>
  </div>;
}

ReactDOM.createRoot(document.getElementById('app')).render(<App />);
