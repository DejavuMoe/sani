/*
 * L3 — patterns: the composite components the dashboard is built from
 * (Creator, Composer, ShareComposer, Summary, LinkList, LinkRow, LinkDetail,
 * LinkEditor, AppHeader), each in the states it has. Every specimen runs on
 * its own copy of the fixture store, so they can be used without affecting
 * one another. Panes stack because these patterns are laid out for the
 * 920px page column.
 */
const BY_SLUG = (slug) => FIX.links.find((l) => l.slug === slug);
const FILE = FIX.links.find((l) => l.kind === 'file');

/** A list frame like LinkList's, around chosen rows. */
function Rows({ preset, links }) {
  return (
    <WithStore preset={preset}>
      {(store, toasts) => (
        <section className="ll board-list">
          <div className="ll-card">
            <ul>
              {links.map((l) => (
                <li key={l.id}>
                  <LinkRow link={store.items.find((x) => x.id === l.id) ?? l} store={store} toasts={toasts} />
                </li>
              ))}
            </ul>
          </div>
          <Toaster toasts={toasts} />
        </section>
      )}
    </WithStore>
  );
}

function ListState({ preset }) {
  return (
    <WithStore preset={preset}>
      {(store, toasts) => (
        <div className="board-list">
          <LinkList store={store} toasts={toasts} />
        </div>
      )}
    </WithStore>
  );
}

function CreatorState({ mode = 'url', initial = {}, config }) {
  return (
    <WithStore>
      {(store, toasts) => (
        <div className="board-list">
          <Creator store={store} toasts={toasts} config={{ ...FIX.config, ...config }} initialMode={mode} initial={initial} />
          <Toaster toasts={toasts} />
        </div>
      )}
    </WithStore>
  );
}

function Labeled({ label, children }) {
  return (
    <div className="b-specimen" style={{ marginBottom: 22 }}>
      <Cap>{label}</Cap>
      {children}
    </div>
  );
}

function Patterns() {
  const i18n = makeI18n(BOARD.lang, BOARD_NOW);
  const pending = { ...BY_SLUG('gh'), id: 900, slug: 'k3x9p', title: '', meta: 'pending', clicks: 0, spark: new Array(14).fill(0), createdAt: new Date(BOARD_NOW - 20000).toISOString() };
  const sample = new File([new Uint8Array(1843200)], 'design-review.pdf', { type: 'application/pdf' });
  return (
    <BoardShell
      page="patterns.html"
      title="L3 · Patterns"
      intro={
        <p>
          Composite components from <code>web/src/components</code>, running on the captured fixtures (<code>src/fixtures.js</code>, sanitized) through a copy of the
          links store. Click rows, switch tabs, type in composers: the behavior is the app's.
        </p>
      }
      toc={[
        ['creator', 'Creator & composers'],
        ['summary', 'Summary'],
        ['rows', 'LinkRow'],
        ['picking', 'Picking'],
        ['detail', 'LinkDetail'],
        ['editor', 'LinkEditor'],
        ['list', 'LinkList states'],
        ['header', 'AppHeader'],
      ]}
    >
      <Spec id="creator" single title="Creator · Composer · ShareComposer" source={['Creator.svelte', 'Composer.svelte', 'ShareComposer.svelte']} note="Three tabs that stay mounted. Link: idle, options open, a field error, the paste note. Text: code format. File: picked, uploading, and files turned off (no SANI_FILES_URL).">
        {() => (
          <>
            <Labeled label="url · idle">
              <CreatorState />
            </Labeled>
            <Labeled label="url · options open">
              <CreatorState initial={{ url: 'https://example.com/a/very/long/path?with=query', more: true }} />
            </Labeled>
            <Labeled label="url · error">
              <CreatorState initial={{ url: 'not a link', error: { field: 'url', text: i18n.errorText('url_invalid') } }} />
            </Labeled>
            <Labeled label="url · pasted">
              <CreatorState initial={{ url: 'https://example.com/a/very/long/path', note: i18n.t('composer.pasted', { keys: `${mod} ↵` }) }} />
            </Labeled>
            <Labeled label="text · code">
              <CreatorState mode="text" initial={{ text: FIX.texts[String(BY_SLUG('nginx-conf').id)], format: 'code' }} />
            </Labeled>
            <Labeled label="file · picked">
              <CreatorState mode="file" initial={{ file: sample, note: i18n.t('share.dropped') }} />
            </Labeled>
            <Labeled label="file · uploading 42%">
              <CreatorState mode="file" initial={{ file: sample, busy: true, progress: 0.42 }} />
            </Labeled>
            <Labeled label="file · files origin not configured">
              <CreatorState mode="file" config={{ filesUrl: null }} />
            </Labeled>
          </>
        )}
      </Spec>

      <Spec id="summary" title="Summary" source="Summary.svelte" note="Totals and 30-day bars; dashes while loading; hidden when there are no links.">
        {() => (
          <>
            <Labeled label="ready">
              <Summary overview={FIX.overview} />
            </Labeled>
            <Labeled label="loading">
              <Summary overview={null} />
            </Labeled>
          </>
        )}
      </Spec>

      <Spec id="rows" single title="LinkRow" source="LinkRow.svelte" note="Titled link with icon; title still being fetched; no title (fetch failed); a text share and a file share; disabled, expired and limit reached; the selected row (keyboard cursor) and a just-created row.">
        {() => (
          <Rows
            preset={{ selectedId: BY_SLUG('blog').id, fresh: [pending.id] }}
            links={[BY_SLUG('gh'), pending, BY_SLUG('92ukv'), BY_SLUG('nginx-conf'), FILE, BY_SLUG('uq4s5'), BY_SLUG('talk'), BY_SLUG('beta'), BY_SLUG('blog')]}
          />
        )}
      </Spec>

      <Spec id="picking" single title="Picking (bulk actions)" source={['LinkList.svelte', 'LinkRow.svelte']} note="X or the toolbar button starts picking; shift-click picks a range. The bar shows the count and enable / disable / delete.">
        {() => <ListState preset={{ picking: true, picked: [BY_SLUG('gh').id, BY_SLUG('blog').id, BY_SLUG('talk').id] }} />}
      </Spec>

      <Spec id="detail" single title="LinkDetail" source="LinkDetail.svelte" note="Opens under its row. A redirect (chart, referrers, QR, meta), a text share (preview, views), a file share (downloads), an expired link and one at its visit limit.">
        {() => (
          <>
            {[
              ['url', BY_SLUG('weekly-42')],
              ['text', BY_SLUG('nginx-conf')],
              ['file', FILE],
              ['expired', BY_SLUG('talk')],
              ['limit reached', BY_SLUG('beta')],
            ].map(([label, l]) => (
              <Labeled key={label} label={label}>
                <Rows preset={{ expandedId: l.id }} links={[l]} />
              </Labeled>
            ))}
          </>
        )}
      </Spec>

      <Spec id="editor" single title="LinkEditor" source="LinkEditor.svelte" note="Replaces the detail while editing: destination or text, slug (with the rename warning), title, expiry, visit limit, redirect type.">
        {() => (
          <>
            <Labeled label="url">
              <Rows preset={{ expandedId: BY_SLUG('weekly-42').id, editingId: BY_SLUG('weekly-42').id }} links={[BY_SLUG('weekly-42')]} />
            </Labeled>
            <Labeled label="text">
              <Rows preset={{ expandedId: BY_SLUG('nginx-conf').id, editingId: BY_SLUG('nginx-conf').id }} links={[BY_SLUG('nginx-conf')]} />
            </Labeled>
          </>
        )}
      </Spec>

      <Spec id="list" single title="LinkList states" source="LinkList.svelte" note="Loading (ghost rows), first run (no links yet), no search results, a kind filter, and a failed load.">
        {() => (
          <>
            <Labeled label="loading">
              <ListState preset={{ loading: true }} />
            </Labeled>
            <Labeled label="no links yet">
              <ListState preset={{ empty: true }} />
            </Labeled>
            <Labeled label="no results">
              <ListState preset={{ query: 'kubernetes' }} />
            </Labeled>
            <Labeled label="filtered: files only">
              <ListState preset={{ kind: 'file' }} />
            </Labeled>
            <Labeled label="failed">
              <ListState preset={{ failed: true }} />
            </Labeled>
          </>
        )}
      </Spec>

      <Spec id="header" title="AppHeader" source="AppHeader.svelte" note="Logo, shortcuts (hidden on touch), theme cycle, settings. A hairline appears once the page scrolls.">
        {() => (
          <div className="b-stack">
            <Labeled label="top">
              <AppHeader theme="system" scrolled={false} />
            </Labeled>
            <Labeled label="scrolled · dark preference">
              <AppHeader theme="dark" scrolled />
            </Labeled>
            <Labeled label="on settings">
              <AppHeader route="settings" theme="light" scrolled={false} />
            </Labeled>
          </div>
        )}
      </Spec>
    </BoardShell>
  );
}

mountBoard(<Patterns />);
