/*
 * Visitor pages: what someone who opens a short link sees. These come from
 * the Go server (internal/server/web.go, sharepage.go), not the admin app;
 * visitor.html renders them from the copied styles and copy.
 */
const VISITOR_PAGES = [
  ['notfound', '404 · link not found', 'web.go pageTemplate'],
  ['gone', '410 · expired, turned off or at its limit', 'web.go pageTemplate'],
  ['error', '500 · server error', 'web.go pageTemplate'],
  ['share-notfound', '404 · nothing shared at /p/…', 'web.go pageTemplate'],
  ['share-gone', '410 · share no longer available', 'web.go pageTemplate'],
  ['share-code', 'Text share · code (line numbers)', 'sharepage.go'],
  ['share-text', 'Text share · plain (same fixture body)', 'sharepage.go'],
  ['share-code&until=1', 'Text share · with an expiry', 'sharepage.go'],
  ['share-file', 'File share', 'sharepage.go'],
  ['share-file-off', 'File share · download unavailable', 'sharepage.go'],
];

function Visitors() {
  const src = (page, theme) => `visitor.html?page=${page}&theme=${theme}&lang=${BOARD.lang}`;
  return (
    <BoardShell
      page="visitors.html"
      title="Visitor pages"
      intro={
        <p>
          Server-rendered pages outside the admin app, using system fonts and their own small palette. Styles and copy are copied from{' '}
          <code>internal/server</code> by <code>tools/sync.mjs</code>; language follows <code>Accept-Language</code> and the theme follows the system in production.
        </p>
      }
      toc={VISITOR_PAGES.map(([id, label]) => [`v-${id.replace(/\W/g, '-')}`, label])}
    >
      {VISITOR_PAGES.map(([id, label, source]) => (
        <section className="spec" id={`v-${id.replace(/\W/g, '-')}`} key={id} aria-label={label}>
          <div className="spec-head">
            <h2>{label}</h2>
            <code>{source}</code>
          </div>
          <div className="frames">
            {BOARD.themes.flatMap((theme) => [
              <Frame key={theme + 'd'} src={src(id, theme)} w={1280} h={720} scale={0.35} label={`${theme} · desktop`} />,
              <Frame key={theme + 'p'} src={src(id, theme)} w={390} h={720} scale={0.4} label={`${theme} · phone`} />,
            ])}
          </div>
        </section>
      ))}
    </BoardShell>
  );
}

mountBoard(<Visitors />);
