function R6LinkDetail({ link, store, toasts, initialRange = 30 }) {
  const { t, lang, formatNumber, formatRelative, formatDateTime } = useI18n();
  const editing = store.editingId === link.id;
  const [range, setRange] = useS(initialRange);
  const stats = store.linkStats(link.id, range);
  const [loaded, setLoaded] = React.useState(null);
  const [bodyState, setBodyState] = React.useState('loading');
  const [retry, setRetry] = React.useState(0);
  const body = loaded?.id === link.id ? loaded.text : null;
  const scene = new URLSearchParams(location.search).get('scene');
  React.useEffect(() => {
    if (link.kind !== 'text') return;
    setBodyState('loading');
    const timer = setTimeout(() => {
      if (scene === 'r6-text-error' && retry === 0) { setBodyState('error'); return; }
      setLoaded({ id: link.id, text: store.linkText(link.id) });
      setBodyState('ready');
    }, scene === 'r6-text-loading' ? 2400 : 450);
    return () => clearTimeout(timer);
  }, [link.id, link.updatedAt, retry]);
  const today = stats.days[stats.days.length - 1].count;
  const visitsLabel = link.kind === 'text' ? t('detail.views') : link.kind === 'file' ? t('detail.downloads') : t('detail.clicks');
  const redirectLabel = link.redirect === 301 || link.redirect === 308 ? t('redirect.301') : t('redirect.302');
  const [refetching, setRefetching] = useS(false);
  const copy = async (text, msg = t('act.copied'), detail = stripScheme(text)) => (await copyText(text)) && toasts.success(msg, { detail });

  if (editing)
    return (
      <div className="ld" id={`detail-${link.id}`}>
        <LinkEditor link={link} store={store} toasts={toasts} />
      </div>
    );

  return (
    <div className="ld" id={`detail-${link.id}`}>
      <div className="ld-grid">
        <div className="ld-main">
          <div className="ld-short">
            <a className="ld-short-url" href={link.shortUrl} target="_blank" rel="noopener">
              {stripScheme(link.shortUrl)}
            </a>
            <div className="ld-short-actions">
              <Button size="sm" icon="copy" onClick={() => copy(link.shortUrl)}>
                {t('act.copy')}
              </Button>
              <Button size="sm" icon="open" onClick={() => open(link.shortUrl, '_blank', 'noopener')}>
                {t('act.open')}
              </Button>
            </div>
          </div>
          {link.kind === 'text' && link.content ? (
            <section className="ld-content" aria-label={t('detail.text')}>
              <div className="ld-content-head">
                <span className="ld-content-meta">
                  {link.content.format === 'code' ? t('format.code') : t('format.plain')} · {t('share.lines', { n: link.content.lines ?? 0 })} · {formatSize(link.content.size)}
                </span>
                <Button size="sm" variant="ghost" icon="copy" disabled={body === null} onClick={async () => (await copyText(body)) && toasts.success(t('share.textCopied'))}>
                  {t('share.copyText')}
                </Button>
              </div>
              <div className="r6-preview-shell" aria-busy={bodyState === 'loading'}>
                {body !== null ? <pre className={cx('ld-preview', link.content.format === 'code' && 'code')} tabIndex={0}>{body}</pre> : <div className="r6-preview-state" role="status">
                  <span>{bodyState === 'error' ? lang === 'zh' ? '文本加载失败，请重试。' : 'Could not load this text. Try again.' : t('share.loading')}</span>
                  {bodyState === 'error' && <Button size="sm" onClick={() => setRetry(n => n + 1)}>{lang === 'zh' ? '重试' : 'Retry'}</Button>}
                </div>}
                {body !== null && bodyState === 'loading' && <span className="r6-preview-update" role="status">{lang === 'zh' ? '正在更新…' : 'Updating…'}</span>}
              </div>
            </section>
          ) : link.kind === 'file' && link.content ? (
            <section className="ld-content file" aria-label={t('detail.file')}>
              <span className="ld-ficon">
                <Icon name="file" size={18} />
              </span>
              <span className="ld-finfo">
                <span className="ld-fname">{link.content.name}</span>
                <span className="ld-fmeta">
                  {mediaType(link.content.type)} · {formatSize(link.content.size)}
                </span>
                <span className="ld-sum" title={link.content.sha256}>
                  SHA-256 {link.content.sha256?.slice(0, 16)}…
                </span>
              </span>
              {link.content.rawUrl && (
                <Button size="sm" variant="ghost" icon="link" onClick={() => copy(link.content.rawUrl)}>
                  {t('share.copyRaw')}
                </Button>
              )}
            </section>
          ) : (
            <p className="ld-dest">
              <span className="ld-dest-k">{t('detail.destination')}</span>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.url}
              </a>
            </p>
          )}

          {!!link.tags?.length && <div className="tag-detail"><span>{tagText(lang, 'label')}</span><TagList ids={link.tags} tags={store.tags} /></div>}
          <div className="ld-stats-head">
            <dl className="ld-figs">
              <div>
                <dt>{visitsLabel}</dt>
                <dd>{formatNumber(link.clicks)}</dd>
              </div>
              <div>
                <dt>{t('detail.today')}</dt>
                <dd>{formatNumber(today)}</dd>
              </div>
              <div>
                <dt>{t('detail.lastVisit')}</dt>
                <dd className="soft">{link.lastClickAt ? formatRelative(link.lastClickAt) : t('detail.never')}</dd>
              </div>
            </dl>
            <Segmented size="sm" label={t('detail.chart')} value={range} onChange={setRange} options={[7, 30, 90].map((n) => ({ value: n, label: t('detail.days', { n }) }))} />
          </div>

          <BarChart days={stats.days} label={t('detail.chart')} empty={t('detail.noVisits')} />
          {stats.referrers.length > 0 && (
            <section className="ld-refs">
              <h2>{t('detail.referrers')}</h2>
              <ul>
                {stats.referrers.map((r) => {
                  const share = stats.referrersTotal ? r.count / stats.referrersTotal : 0;
                  return (
                    <li key={r.host}>
                      <span className={cx('host', (!r.host || r.host === '*') && 'direct')}>{r.host === '*' ? t('detail.otherSites') : r.host || t('detail.direct')}</span>
                      <span className="n">{formatNumber(r.count)}</span>
                      <span className="pct">{Math.round(share * 100)}%</span>
                      <span className="ld-track" aria-hidden="true">
                        <span className="ld-fill" style={{ width: `${Math.max(1, share * 100)}%` }}></span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <aside className="ld-side">
          <div className="ld-qr">
            <QRCode value={link.shortUrl} size={116} label={t('detail.qrLabel', { url: stripScheme(link.shortUrl) })} />
            <div className="ld-qr-actions">
              <Button size="sm" variant="ghost" icon="download">
                PNG
              </Button>
              <Button size="sm" variant="ghost">
                SVG
              </Button>
            </div>
          </div>
          <dl className="ld-meta">
            <div>
              <dt>{t('detail.created')}</dt>
              <dd>{formatDateTime(link.createdAt)}</dd>
            </div>
            <div>
              <dt>{t('detail.expires')}</dt>
              <dd className={link.status === 'expired' ? 'warn' : ''}>{link.expiresAt ? formatDateTime(link.expiresAt) : t('expiry.never')}</dd>
            </div>
            <div>
              <dt>{t('detail.limit')}</dt>
              <dd className={link.status === 'exhausted' ? 'warn' : ''}>
                {link.maxClicks ? t('detail.used', { n: formatNumber(Math.min(link.clicks, link.maxClicks)), max: formatNumber(link.maxClicks) }) : t('composer.noLimit')}
              </dd>
            </div>
            {link.kind === 'url' && (
              <div>
                <dt>{t('detail.redirect')}</dt>
                <dd>
                  {redirectLabel} <span className="ld-code">{link.redirect}</span>
                </dd>
              </div>
            )}
          </dl>
        </aside>
      </div>

      <footer className="ld-actions">
        <Button size="sm" icon="edit" onClick={() => store.setEditing(link.id)}>
          {t('act.edit')}
          <kbd>E</kbd>
        </Button>
        <Button size="sm" variant="ghost" icon={link.enabled ? 'pause' : 'power'} onClick={() => store.setEnabled(link, !link.enabled)}>
          {link.enabled ? t('detail.disable') : t('detail.enable')}
        </Button>
        {link.meta !== 'manual' && (
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            loading={refetching}
            onClick={() => {
              setRefetching(true);
              setTimeout(() => setRefetching(false), 900);
            }}
          >
            {refetching ? t('detail.fetching') : t('detail.refetch')}
          </Button>
        )}
        <span className="ld-spacer"></span>
        <Button size="sm" variant="danger" icon="trash" onClick={() => store.remove(link)}>
          {t('act.delete')}
        </Button>
      </footer>
    </div>
  );
}

/* ---- LinkEditor.svelte ---- */


Object.assign(window, { LinkDetail: R6LinkDetail });
