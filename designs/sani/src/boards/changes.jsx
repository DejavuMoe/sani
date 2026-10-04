/*
 * Changes: each revision's items, with the baseline (identical to
 * production) beside the revised prototype. Images come from
 * tools/revision-shots.mjs; light captures are in Chinese, dark in English.
 */
function Shot({ src, label }) {
  return (
    <figure className="chg-shot">
      <img src={src} alt="" loading="lazy" />
      <figcaption className="b-cap">{label}</figcaption>
    </figure>
  );
}

function Changes() {
  const revs = window.SANI_REVISIONS;
  return (
    <BoardShell
      page="changes.html"
      title="Changes"
      intro={
        <p>
          What each revision changes against production. “Before” is the baseline prototype, which matches production pixel for pixel; “after” is the current prototype,
          in the same state and region. Light captures are in Chinese and dark ones in English. Approve or send back each revision as a whole.
        </p>
      }
      toc={revs.flatMap((r) => r.items.map((i) => [`${r.id}-${i.id}`, i.title]))}
    >
      {revs.map((rev) => (
        <section key={rev.id} aria-labelledby={`${rev.id}-title`}>
          <div className="spec-head" style={{ marginTop: 8 }}>
            <h2 id={`${rev.id}-title`} style={{ fontSize: 20 }}>
              {rev.title}
            </h2>
            <code>
              base {rev.base} · {rev.items.length} items · {rev.status}
            </code>
          </div>
          {rev.items.map((item, n) => (
            <article className="spec chg" id={`${rev.id}-${item.id}`} key={item.id} aria-labelledby={`${rev.id}-${item.id}-t`}>
              <div className="chg-text">
                <span className="b-cap">
                  {String(n + 1).padStart(2, '0')} · {item.area}
                </span>
                <h3 id={`${rev.id}-${item.id}-t`}>{item.title}</h3>
                <p>{item.why}</p>
                <dl className="chg-files">
                  <dt>Prototype</dt>
                  {item.files.map((f) => (
                    <dd key={f}>
                      <code>{f}</code>
                    </dd>
                  ))}
                  <dt>Production to change</dt>
                  {item.production.map((f) => (
                    <dd key={f}>
                      <code>{f}</code>
                    </dd>
                  ))}
                </dl>
              </div>
              {item.shot ? (
                <div className="chg-shots">
                  {BOARD.themes.map((theme) => (
                    <div className={cx('chg-pair', item.shot.clip[2] / item.shot.clip[3] > 4 && 'stacked')} key={theme}>
                      <Shot src={`screenshots/revisions/${rev.id}/${item.id}-${theme}-before.png`} label={`before · ${theme}`} />
                      <Shot src={`screenshots/revisions/${rev.id}/${item.id}-${theme}-after.png`} label={`after · ${theme}`} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="chg-none b-cap">No visual change; checked with tools/a11y.mjs.</p>
              )}
            </article>
          ))}
        </section>
      ))}
    </BoardShell>
  );
}

mountBoard(<Changes />);
