/*
 * Board shell for the layer pages. A board shows specimens in one or both
 * themes side by side (?theme=light|dark|both) in one language (?lang=zh|en).
 * Each pane is a [data-theme] scope with its own language context, so the
 * product components render exactly as they do in the app.
 */
const BOARD_PAGES = [
  ['index.html', 'Index'],
  ['foundations.html', 'L1 Foundations'],
  ['components.html', 'L2 Components'],
  ['patterns.html', 'L3 Patterns'],
  ['screens.html', 'L4–5 Screens'],
  ['visitors.html', 'Visitor pages'],
  ['changes.html', 'Changes'],
  ['prototype.html', 'Prototype ↗'],
];

function boardParams() {
  const p = new URLSearchParams(location.search);
  const theme = ['light', 'dark', 'both'].includes(p.get('theme')) ? p.get('theme') : 'both';
  const lang = p.get('lang') === 'en' ? 'en' : 'zh';
  return { theme, lang, themes: theme === 'both' ? ['light', 'dark'] : [theme] };
}
const BOARD = boardParams();
const BOARD_NOW = Date.parse(FIX.capturedAt);

function boardHref(patch) {
  const p = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) p.set(k, v);
  return `?${p.toString()}${location.hash}`;
}

function BoardShell({ page, title, intro, toc = [], children }) {
  React.useLayoutEffect(() => {
    document.documentElement.dataset.theme = BOARD.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.lang = BOARD.lang === 'zh' ? 'zh-CN' : 'en';
  }, []);
  // Keep the theme and language when moving between boards.
  const keep = `?theme=${BOARD.theme}&lang=${BOARD.lang}`;
  return (
    <div className="board" data-proto-chrome="">
      <header className="bd-bar">
        <a className="bd-home" href={`index.html${keep}`}>
          <Logo size={18} wordmark={false} />
          Sani UI layers
          <small>{FIX.config.version}</small>
        </a>
        <nav className="bd-nav" aria-label="Layers">
          {BOARD_PAGES.map(([href, label]) => (
            <a key={href} href={href === 'prototype.html' ? `${href}?lang=${BOARD.lang}` : `${href}${keep}`} aria-current={href === page ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <div className="bd-controls">
          <BoardSwitch label="Theme" param="theme" value={BOARD.theme} options={['light', 'dark', 'both']} />
          <BoardSwitch label="Language" param="lang" value={BOARD.lang} options={['zh', 'en']} />
        </div>
      </header>
      <main className="bd-main">
        <div className="bd-intro">
          <h1>{title}</h1>
          {intro}
          {toc.length > 0 && (
            <nav className="bd-toc" aria-label="Sections">
              {toc.map(([id, label]) => (
                <a key={id} href={`#${id}`}>
                  {label}
                </a>
              ))}
            </nav>
          )}
        </div>
        {children}
      </main>
    </div>
  );
}

/** Links, not a stateful control: a board's settings live in its URL. */
function BoardSwitch({ label, param, value, options }) {
  return (
    <nav className="bd-switch" aria-label={label}>
      {options.map((o) => (
        <a key={o} href={boardHref({ [param]: o })} aria-current={o === value ? 'true' : undefined}>
          {o}
        </a>
      ))}
    </nav>
  );
}

function Pane({ theme, flush, tag = true, children }) {
  return (
    <div className={cx('pane', flush && 'flush')} data-theme={theme}>
      {tag && <div className="pane-tag">{theme}</div>}
      <EnvCtx.Provider value={{ lang: BOARD.lang, now: BOARD_NOW, host: 's.example.com' }}>{typeof children === 'function' ? children(theme) : children}</EnvCtx.Provider>
    </div>
  );
}

/** One specimen section. `children` may be a function of the pane's theme. */
function Spec({ id, title, source, note, single, flush, children }) {
  const sources = [].concat(source ?? []);
  return (
    <section className="spec" id={id} aria-labelledby={`${id}-title`}>
      <div className="spec-head">
        <h2 id={`${id}-title`}>{title}</h2>
        {sources.map((s) => (
          <code key={s}>{s}</code>
        ))}
        {note && <p className="spec-note">{note}</p>}
      </div>
      <div className={cx('panes', (single || BOARD.themes.length === 1) && 'single')}>
        {BOARD.themes.map((theme) => (
          <Pane key={theme} theme={theme} flush={flush}>
            {children}
          </Pane>
        ))}
      </div>
    </section>
  );
}

/** A store and toasts for specimens that need them (rows, details, composers). */
function WithStore({ preset = {}, children }) {
  const { lang } = React.useContext(EnvCtx);
  const i18n = React.useMemo(() => makeI18n(lang, BOARD_NOW), [lang]);
  const toasts = useToasts();
  const store = useLinksStore({ toasts, i18n, preset, latency: 0 });
  return children(store, toasts);
}

function Cap({ children }) {
  return <span className="b-cap">{children}</span>;
}

/** A frame of a page at a given size, scaled down to fit. */
function Frame({ src, w, h, scale = 1, label }) {
  // Each frame boots React and Babel; loading="lazy" still starts dozens at
  // once, so a frame mounts only when it comes near the viewport.
  const box = React.useRef(null);
  const [near, setNear] = React.useState(false);
  React.useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setNear(true), io.disconnect()), { rootMargin: '200px' });
    io.observe(box.current);
    return () => io.disconnect();
  }, []);
  return (
    <figure className="frame" style={{ margin: 0 }}>
      <div ref={box} className="frame-box" style={{ width: w * scale, height: h * scale }}>
        {near && <iframe src={src} title={label} width={w} height={h} style={{ transform: `scale(${scale})` }}></iframe>}
      </div>
      <figcaption className="frame-cap">
        <Cap>{label}</Cap>
        <a href={src} target="_blank" rel="noopener">
          open ↗
        </a>
      </figcaption>
    </figure>
  );
}

function mountBoard(node) {
  ReactDOM.createRoot(document.getElementById('app')).render(node);
}

Object.assign(window, { BOARD, BOARD_NOW, BoardShell, Pane, Spec, WithStore, Cap, Frame, mountBoard });
