/*
 * L1 — foundations: the tokens in web/src/app.css (copied by tools/sync.mjs),
 * the type scale the components actually use, radii, motion, the icon set
 * and the logo. Values are read back from the rendered pane, not retyped.
 */
const TOKEN_GROUPS = [
  ['Surfaces', ['--bg', '--surface', '--surface-2', '--surface-3', '--line', '--line-2']],
  ['Text', ['--text', '--text-2', '--text-3', '--text-4']],
  ['Accent', ['--accent', '--accent-hover', '--accent-soft', '--accent-line', '--selection']],
  ['Ink (primary buttons)', ['--ink', '--ink-hover', '--on-ink']],
  ['Status', ['--danger', '--danger-soft', '--success', '--warning']],
  ['Floating layers', ['--toast', '--on-toast', '--scrim']],
];
/** Contrast pairs worth checking: foreground token → background token. */
const CONTRAST = {
  '--text': '--bg',
  '--text-2': '--bg',
  '--text-3': '--bg',
  '--text-4': '--bg',
  '--accent': '--surface',
  '--danger': '--surface',
  '--success': '--surface',
  '--warning': '--surface',
  '--on-ink': '--ink',
  '--on-toast': '--toast',
};

function luminance(hex) {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function Swatch({ name }) {
  const ref = React.useRef(null);
  const [vals, setVals] = React.useState({});
  React.useLayoutEffect(() => {
    const cs = getComputedStyle(ref.current);
    const read = (n) => cs.getPropertyValue(n).trim();
    setVals({ value: read(name), against: CONTRAST[name] ? read(CONTRAST[name]) : null });
  }, [name]);
  const ratio = vals.against ? contrast(vals.value, vals.against) : null;
  // --text-4 is documented in app.css as disabled/marks only, so it is exempt.
  const need = name === '--text-4' ? null : 4.5;
  return (
    <div className="swatch" ref={ref}>
      <div className="swatch-chip" style={{ background: `var(${name})` }}></div>
      <div className="swatch-meta">
        <b>{name}</b>
        <span>{vals.value}</span>
        {ratio && (
          <span className={need ? (ratio >= need ? 'pass' : 'fail') : undefined}>
            {need ? (ratio >= need ? '✓ ' : '✗ ') : ''}{ratio.toFixed(2)}:1 on {CONTRAST[name]}
            {!need && ' · marks only'}
          </span>
        )}
      </div>
    </div>
  );
}

const TYPE = [
  ['22px', 'Settings title, detail figures', 'Settings.svelte, LinkDetail.svelte', 'sans'],
  ['20px', 'Summary figures (tnum)', 'Summary.svelte', 'sans'],
  ['19px', 'Setup heading, detail stat', 'Setup.svelte, LinkDetail.svelte', 'sans'],
  ['15.5px', 'Composer URL field', 'Composer.svelte', 'sans'],
  ['15px', 'Dialog title, list blank state, login', 'Dialog.svelte, LinkList.svelte, Login.svelte', 'sans'],
  ['14px', 'Body (app.css)', 'app.css', 'sans'],
  ['13px', 'Secondary text, controls (most used)', '48 uses', 'sans'],
  ['12.5px', 'Metadata, error text', '19 uses', 'sans'],
  ['12px', 'Hints', '17 uses', 'sans'],
  ['13px', 'Slugs, URLs', 'LinkRow.svelte', 'mono'],
  ['11.5px', 'Redirect code, small mono', 'LinkDetail.svelte', 'mono'],
  ['11px', 'kbd', 'app.css', 'sans'],
];

function TypeScale() {
  const { t } = useI18n();
  return (
    <div className="b-surface">
      {TYPE.map(([size, role, where, family], i) => (
        <div className="type-row" key={i}>
          <div className="b-specimen">
            <Cap>
              {size} · {family}
            </Cap>
            <Cap>{where}</Cap>
          </div>
          <div style={{ fontSize: size, fontFamily: `var(--font-${family})` }}>
            {family === 'mono' ? 's.example.com/weekly-42' : i < 5 ? t('list.emptyTitle') : t('list.emptyBody').replace(/\{\w+\}/g, '↵')}
            <div className="b-cap" style={{ marginTop: 2 }}>
              {role}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Foundations() {
  const icons = Object.keys(window.SANI_ICONS);
  return (
    <BoardShell
      page="foundations.html"
      title="L1 · Foundations"
      intro={
        <p>
          Tokens are generated from <code>web/src/app.css</code> by <code>tools/sync.mjs</code>; every value below is read from the rendered pane. Contrast is checked
          against the token each one is used on.
        </p>
      }
      toc={[
        ['colors', 'Colors'],
        ['type', 'Type'],
        ['shape', 'Radius, shadow, layout'],
        ['motion', 'Motion'],
        ['fields', 'Base elements'],
        ['icons', 'Icons'],
        ['logo', 'Logo'],
      ]}
    >
      <Spec id="colors" title="Colors" source="web/src/app.css" note="Warm neutrals and one accent. Surfaces are separated by hairlines; only floating layers cast a shadow.">
        {() =>
          TOKEN_GROUPS.map(([group, names]) => (
            <div key={group} style={{ marginBottom: 18 }}>
              <div className="b-cap" style={{ marginBottom: 8 }}>
                {group}
              </div>
              <div className="b-grid" style={{ '--min': '150px' }}>
                {names.map((n) => (
                  <Swatch key={n} name={n} />
                ))}
              </div>
            </div>
          ))
        }
      </Spec>

      <Spec id="type" title="Type" source={['--font-sans: Inter Variable', '--font-mono: IBM Plex Mono']} note="Sizes counted across web/src; each row names where it occurs. Chinese falls back to the system CJK fonts listed in app.css.">
        {() => <TypeScale />}
      </Spec>

      <Spec id="shape" title="Radius, shadow, layout" source="web/src/app.css">
        {() => (
          <div className="b-stack">
            <div className="b-row">
              {['--radius-xs', '--radius-sm', '--radius', '--radius-lg'].map((r) => (
                <div className="b-specimen" key={r}>
                  <div className="radius-box" style={{ borderRadius: `var(${r})` }}></div>
                  <Cap>{r}</Cap>
                </div>
              ))}
            </div>
            <div className="b-row">
              <div className="b-specimen">
                <div className="radius-box" style={{ width: 180, borderRadius: 'var(--radius-lg)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-pop)' }}></div>
                <Cap>--shadow-pop (menus, dialogs, toasts)</Cap>
              </div>
              <div className="b-specimen">
                <div className="radius-box" style={{ width: 180, borderRadius: 'var(--radius-lg)', background: 'var(--scrim)' }}></div>
                <Cap>--scrim (dialog backdrop)</Cap>
              </div>
            </div>
            <div className="b-row">
              <Cap>--page: 920px · --gutter: 24px (16px under 640px)</Cap>
            </div>
          </div>
        )}
      </Spec>

      <Spec id="motion" title="Motion" source="web/src/app.css" note="Hover a track. Reduced motion shortens every transition and animation to 1ms.">
        {() => (
          <div className="b-stack">
            {[
              ['--ease', '--fast'],
              ['--ease', '--normal'],
              ['--ease-io', '--normal'],
            ].map(([ease, dur]) => (
              <div className="b-row" key={ease + dur}>
                <div className="motion-track">
                  <div className="motion-dot" style={{ transition: `left var(${dur}) var(${ease})` }}></div>
                </div>
                <Cap>
                  {ease} · {dur}
                </Cap>
              </div>
            ))}
          </div>
        )}
      </Spec>

      <Spec id="fields" title="Base elements" source="web/src/app.css (.field, .label, .hint, .error-text, kbd)">
        {(theme) => (
          <div className="b-surface" style={{ maxWidth: 420 }}>
            <BaseFields theme={theme} />
          </div>
        )}
      </Spec>

      <Spec id="icons" title={`Icons (${icons.length})`} source="web/src/components/Icon.svelte" note="Hand-drawn 16×16 paths, 1.5 stroke; 'more' and 'dot' use 2.25. No icon library.">
        {() => (
          <div className="b-grid" style={{ '--min': '96px' }}>
            {icons.map((name) => (
              <div className="icon-cell" key={name}>
                <Icon name={name} size={20} />
                <Cap>{name}</Cap>
              </div>
            ))}
          </div>
        )}
      </Spec>

      <Spec id="logo" title="Logo" source="web/src/components/Logo.svelte">
        {() => (
          <div className="b-row" style={{ gap: 28 }}>
            <Logo size={20} />
            <Logo size={26} />
            <Logo size={32} wordmark={false} />
            <img src="src/assets/favicon.svg" width="32" height="32" alt="" />
            <Cap>20 header · 26 sign-in · mark · favicon.svg</Cap>
          </div>
        )}
      </Spec>
    </BoardShell>
  );
}

function BaseFields({ theme }) {
  const { t } = useI18n();
  const id = `bf-${theme}`;
  return (
    <div className="b-stack">
      <div>
        <label className="label" htmlFor={`${id}-a`}>
          {t('settings.domain')}
        </label>
        <input id={`${id}-a`} className="field" defaultValue="https://s.example.com" />
        <p className="hint">{t('settings.domainHint', { origin: FIX.config.requestOrigin })}</p>
      </div>
      <div>
        <label className="label" htmlFor={`${id}-b`}>
          {t('settings.passwordCurrent')}
        </label>
        <input id={`${id}-b`} className="field" type="password" defaultValue="hunter22" aria-invalid="true" />
        <p className="error-text">{t('err.wrong_password')}</p>
      </div>
      <div className="b-row">
        <kbd>N</kbd>
        <kbd>{mod}</kbd>
        <kbd>V</kbd>
        <kbd>↵</kbd>
        <kbd>Esc</kbd>
      </div>
    </div>
  );
}

mountBoard(<Foundations />);
