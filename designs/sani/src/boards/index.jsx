/*
 * The hub: what each layer is, where it comes from, and how closely the
 * prototype matches production (screenshots/compare/report.json).
 */
const LAYERS = [
  ['L0', 'Logic', 'src/lib.jsx', 'i18n, number/date/relative formatting, URL and slug rules, sizes, expiry, QR, toasts — ported from web/src/lib.', null],
  ['L1', 'Foundations', 'src/gen/tokens.css · fonts.css', 'Color tokens for both themes, type, radius, motion, icons, logo. Generated from app.css and Icon.svelte.', 'foundations.html'],
  ['L2', 'Components', 'src/components.jsx · css/components.css', 'Button, Segmented, Switch, Menu, Dialog, Toaster, Favicon, charts, QR, SlugField, ExpiryPicker.', 'components.html'],
  ['L3', 'Patterns', 'src/patterns.jsx · css/patterns.css · store.jsx', 'Creator and composers, Summary, LinkList, LinkRow, LinkDetail, LinkEditor, AppHeader, AuthShell, shortcuts.', 'patterns.html'],
  ['L4', 'Screens', 'src/screens.jsx · css/screens.css', 'Dashboard, Login, Setup, Offline, Settings, NewLink.', 'screens.html'],
  ['L5', 'App', 'src/app.jsx · scenes.jsx', 'The clickable app: session, routes, global shortcuts, paste and drop, and scenes for every state.', 'prototype.html'],
  ['V', 'Visitor pages', 'visitor.html · src/gen/visitor.js', 'Server-rendered 404 / 410 / 500 and the text and file share pages.', 'visitors.html'],
];

function CompareReport() {
  const [report, setReport] = React.useState(undefined);
  React.useEffect(() => {
    fetch('screenshots/compare/report.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(setReport, () => setReport(null));
  }, []);
  if (report === undefined) return <Cap>Loading report…</Cap>;
  if (!report) return <Cap>No report yet: run tools/compare.mjs.</Cap>;
  const worst = Math.max(...report.cases.map((c) => c.diff ?? 100));
  return (
    <div className="b-surface" style={{ overflowX: 'auto' }}>
      <Cap>
        {report.cases.length} captures · {new Date(report.at).toLocaleString('en-CA', { timeZone: FIX.config.timezone, hour12: false })} · worst {worst.toFixed(2)}% of pixels differ
      </Cap>
      <table style={{ marginTop: 10, borderCollapse: 'collapse', font: '12px/1.6 var(--font-mono)', width: '100%' }}>
        <thead>
          <tr style={{ color: 'var(--text-3)', textAlign: 'left' }}>
            <th style={{ fontWeight: 500, padding: '2px 16px 2px 0' }}>case</th>
            <th style={{ fontWeight: 500, padding: '2px 16px 2px 0' }}>diff</th>
            <th style={{ fontWeight: 500, padding: '2px 16px 2px 0' }}>size</th>
            <th style={{ fontWeight: 500, padding: '2px 0' }}>images</th>
          </tr>
        </thead>
        <tbody>
          {report.cases.map((c) => (
            <tr key={c.case} style={{ borderTop: '1px solid var(--line)' }}>
              <td style={{ padding: '2px 16px 2px 0' }}>{c.case}</td>
              <td style={{ padding: '2px 16px 2px 0', color: c.error ? 'var(--danger)' : c.diff === 0 ? 'var(--text-3)' : 'var(--text)' }}>{c.error ? 'error' : `${c.diff.toFixed(2)}%`}</td>
              <td style={{ padding: '2px 16px 2px 0', color: 'var(--text-3)' }}>{c.prod?.join('×')}</td>
              <td style={{ padding: '2px 0' }}>
                {['prod', 'proto', 'diff'].map((k) => (
                  <a key={k} href={`screenshots/compare/${c.case}-${k}.png`} style={{ color: 'var(--accent)', marginRight: 10 }}>
                    {k}
                  </a>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Index() {
  const keep = `?theme=${BOARD.theme}&lang=${BOARD.lang}`;
  return (
    <BoardShell
      page="index.html"
      title="Sani · UI layers"
      intro={
        <p>
          A layered reconstruction of the current admin app and visitor pages. The baseline (<code>f01fe22</code>) matches production pixel for pixel; revisions change a
          layer here, get reviewed, then get implemented. Status: <strong>revision 1 needs review</strong> (<code>_d_meta.json</code>).
        </p>
      }
    >
      <section className="spec" aria-labelledby="rev-title">
        <div className="spec-head">
          <h2 id="rev-title">Revisions</h2>
          <code>src/revisions.js</code>
        </div>
        <div className="bd-cards">
          {window.SANI_REVISIONS.map((r) => (
            <a key={r.id} className="bd-card" href={`changes.html${keep}#${r.id}-title`}>
              <span className="tag">
                {r.id.toUpperCase()} · {r.status}
              </span>
              <h3>{r.title}</h3>
              <p>
                {r.items.length} items across {[...new Set(r.items.flatMap((i) => i.area.split(', ')))].join(', ')}.
              </p>
              <code>base {r.base.split(' ')[0]}</code>
            </a>
          ))}
        </div>
      </section>

      <section className="spec" aria-labelledby="layers-title">
        <div className="spec-head">
          <h2 id="layers-title">Layers</h2>
        </div>
        <div className="bd-cards">
          {LAYERS.map(([tag, name, files, about, href]) => {
            const body = (
              <>
                <span className="tag">{tag}</span>
                <h3>{name}</h3>
                <p>{about}</p>
                <code>{files}</code>
              </>
            );
            return href ? (
              <a key={tag} className="bd-card" href={href === 'prototype.html' ? `${href}?lang=${BOARD.lang}` : `${href}${keep}`}>
                {body}
              </a>
            ) : (
              <div key={tag} className="bd-card">
                {body}
              </div>
            );
          })}
        </div>
      </section>

      <section className="spec" aria-labelledby="align-title">
        <div className="spec-head">
          <h2 id="align-title">Alignment with production</h2>
          <code>tools/compare.mjs</code>
          <p className="spec-note">
            Production (a seeded instance) and the prototype in the same Chromium, viewport, theme, language and time zone, diffed per pixel (a pixel counts when a channel
            differs by more than 32). Since r1 the non-zero cases are its intended changes; README.md maps each one.
          </p>
        </div>
        <CompareReport />
      </section>

      <section className="spec" aria-labelledby="records-title">
        <div className="spec-head">
          <h2 id="records-title">Records and tools</h2>
        </div>
        <div className="bd-cards">
          {[
            ['README.md', 'Layers, naming, and how to sync, capture, compare and check.'],
            ['capabilities.md', 'Current surfaces, states and interfaces, with evidence.'],
            ['constraints.md', 'Product and content rules the prototype keeps.'],
            ['ui-contract.json', 'Each surface mapped to its production files and tests.'],
            ['content-inventory.json', 'Every rendered string, its origin and purpose.'],
            ['design-sources.json', 'Where the prototype’s truth comes from.'],
          ].map(([file, about]) => (
            <a key={file} className="bd-card" href={file}>
              <h3>
                <code>{file}</code>
              </h3>
              <p>{about}</p>
            </a>
          ))}
        </div>
      </section>
    </BoardShell>
  );
}

mountBoard(<Index />);
