/*
 * L4–L5 — every scene of the clickable app, framed at desktop and phone
 * sizes. Each frame is prototype.html itself (?scene=…&chrome=0), so what is
 * shown here is exactly what the prototype and the comparison tool run.
 *   ?size=desktop|phone|both (default both)
 */
const SIZES = {
  desktop: { w: 1280, h: 800, scale: 0.35 },
  phone: { w: 390, h: 844, scale: 0.4 },
};
const GROUP_TITLES = {
  auth: ['First run, sign-in, offline', 'Setup.svelte, Login.svelte, AuthShell.svelte, App.svelte (offline)'],
  dashboard: ['Dashboard', 'Dashboard.svelte, LinkList.svelte'],
  detail: ['Detail and editing', 'LinkDetail.svelte, LinkEditor.svelte'],
  composer: ['Creating', 'Creator.svelte, Composer.svelte, ShareComposer.svelte'],
  overlays: ['Overlays', 'ShortcutsDialog.svelte, Toaster.svelte'],
  settings: ['Settings', 'Settings.svelte'],
  new: ['New link (bookmarklet / share target)', 'NewLink.svelte'],
};

function Screens() {
  const p = new URLSearchParams(location.search);
  const size = ['desktop', 'phone'].includes(p.get('size')) ? p.get('size') : 'both';
  const sizes = size === 'both' ? ['desktop', 'phone'] : [size];
  const groups = [...new Set(Object.values(SCENES).map((s) => s.group))];
  const src = (scene, theme) => `prototype.html?scene=${scene}&theme=${theme}&lang=${BOARD.lang}&chrome=0`;
  return (
    <BoardShell
      page="screens.html"
      title="L4–5 · Screens"
      intro={
        <p>
          {Object.keys(SCENES).length} scenes of the clickable app (<code>prototype.html</code>), each framed at 1280×800 and 390×844. Open one to use it; the{' '}
          <code>Tweaks</code> button there switches scene, theme and language. Size: <a href={`?theme=${BOARD.theme}&lang=${BOARD.lang}&size=desktop`}>desktop</a> ·{' '}
          <a href={`?theme=${BOARD.theme}&lang=${BOARD.lang}&size=phone`}>phone</a> · <a href={`?theme=${BOARD.theme}&lang=${BOARD.lang}&size=both`}>both</a>
        </p>
      }
      toc={groups.map((g) => [g, GROUP_TITLES[g]?.[0] ?? g])}
    >
      {groups.map((g) => (
        <section className="spec" id={g} key={g} aria-labelledby={`${g}-title`}>
          <div className="spec-head">
            <h2 id={`${g}-title`}>{GROUP_TITLES[g]?.[0] ?? g}</h2>
            <code>{GROUP_TITLES[g]?.[1]}</code>
          </div>
          {Object.keys(SCENES)
            .filter((id) => SCENES[id].group === g)
            .map((id) => (
              <div key={id} style={{ marginBottom: 20 }}>
                <div className="b-cap" style={{ marginBottom: 6 }}>
                  {id}
                </div>
                <div className="frames">
                  {BOARD.themes.flatMap((theme) =>
                    sizes.map((s) => <Frame key={theme + s} src={src(id, theme)} w={SIZES[s].w} h={SIZES[s].h} scale={SIZES[s].scale} label={`${theme} · ${s}`} />),
                  )}
                </div>
              </div>
            ))}
        </section>
      ))}
    </BoardShell>
  );
}

mountBoard(<Screens />);
