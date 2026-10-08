<script lang="ts">
  import TagList from './TagList.svelte';
  import { untrack } from 'svelte';
  import { slide } from 'svelte/transition';
  import { api, ApiError, type Link, type LinkStats } from '../lib/api';
  import { clock } from '../lib/clock.svelte';
  import { copyText } from '../lib/clipboard';
  import { errorText, formatDateTime, formatNumber, formatRelative, t } from '../lib/i18n.svelte';
  import { links } from '../lib/links.svelte';
  import { download, fileName, qrPNG, qrSVG } from '../lib/qr';
  import { toasts } from '../lib/toast.svelte';
  import { formatSize, mediaType } from '../lib/size';
  import { stripScheme } from '../lib/url';
  import BarChart from './BarChart.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import LinkEditor from './LinkEditor.svelte';
  import QRCode from './QRCode.svelte';
  import Segmented from './Segmented.svelte';

  let { link }: { link: Link } = $props();

  const id = $derived(link.id);
  const editing = $derived(links.editingId === link.id);

  let range = $state(30);
  let stats = $state<LinkStats | null>(null);
  let loading = $state(false);
  let refetching = $state(false);

  // Depends on the id and range only: new click counts arriving for the
  // same link must not refetch the stats.
  $effect(() => {
    const linkId = id;
    const days = range;
    untrack(() => load(linkId, days));
  });

  async function load(linkId: number, days: number) {
    loading = true;
    try {
      const s = await api.stats(linkId, days);
      if (linkId !== id || days !== range) return;
      stats = s;
      links.upsert({ ...s.link, spark: undefined });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not_found') links.expandedId = null;
    } finally {
      loading = false;
    }
  }

  const today = $derived(stats ? stats.days[stats.days.length - 1].count : (link.spark?.[13] ?? 0));
  const visitsLabel = $derived(
    link.kind === 'text' ? t('detail.views') : link.kind === 'file' ? t('detail.downloads') : t('detail.clicks'),
  );

  // A text's body isn't part of the link; fetch it, and again after an edit.
  let body = $state<string | null>(null);
  $effect(() => {
    if (link.kind !== 'text') return;
    const linkId = id;
    void link.updatedAt;
    let current = true;
    body = null;
    untrack(async () => {
      try {
        const r = await api.linkText(linkId);
        if (current && linkId === id) body = r.text;
      } catch {
        /* the list notices a deleted link on its own */
      }
    });
    return () => { current = false; };
  });

  async function copyBody() {
    if (body !== null && (await copyText(body))) toasts.success(t('share.textCopied'));
  }

  async function copyRaw() {
    const raw = link.content?.rawUrl;
    if (raw && (await copyText(raw))) toasts.success(t('act.copied'), { detail: stripScheme(raw) });
  }

  async function copy() {
    if (await copyText(link.shortUrl)) toasts.success(t('act.copied'), { detail: stripScheme(link.shortUrl) });
  }

  async function refetch() {
    refetching = true;
    try {
      links.upsert(await api.refreshLink(link.id));
    } catch (e) {
      toasts.error(errorText(e instanceof ApiError ? e.code : 'unknown'));
    } finally {
      refetching = false;
    }
  }

  async function png() {
    download(fileName(link.slug, 'png'), await qrPNG(link.shortUrl));
  }

  function svg() {
    download(fileName(link.slug, 'svg'), new Blob([qrSVG(link.shortUrl)], { type: 'image/svg+xml' }));
  }

  const redirectLabel = $derived(
    link.redirect === 301 || link.redirect === 308 ? t('redirect.301') : t('redirect.302'),
  );
</script>

<div class="detail" id="detail-{link.id}" transition:slide={{ duration: 200 }}>
  {#if editing}
    <LinkEditor {link} />
  {:else}
    <div class="grid">
      <div class="main">
        <div class="short">
          <a class="short-url" href={link.shortUrl} target="_blank" rel="noopener">{stripScheme(link.shortUrl)}</a>
          <div class="short-actions">
            <Button size="sm" icon="copy" onclick={copy}>{t('act.copy')}</Button>
            <Button size="sm" icon="open" onclick={() => open(link.shortUrl, '_blank', 'noopener')}>
              {t('act.open')}
            </Button>
          </div>
        </div>
        {#if link.kind === 'text' && link.content}
          {@const c = link.content}
          <section class="content" aria-label={t('detail.text')}>
            <div class="content-head">
              <span class="content-meta">
                {c.format === 'code' ? t('format.code') : t('format.plain')} · {t('share.lines', { n: c.lines ?? 0 })} · {formatSize(c.size)}
              </span>
              <Button size="sm" variant="ghost" icon="copy" disabled={body === null} onclick={copyBody}>{t('share.copyText')}</Button>
            </div>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <pre class={['preview', c.format === 'code' && 'code']} tabindex="0">{body ?? t('share.loading')}</pre>
          </section>
        {:else if link.kind === 'file' && link.content}
          {@const c = link.content}
          <section class="content file" aria-label={t('detail.file')}>
            <span class="ficon"><Icon name="file" size={18} /></span>
            <span class="finfo">
              <span class="fname">{c.name}</span>
              <span class="fmeta">{mediaType(c.type)} · {formatSize(c.size)}</span>
              <span class="sum" title={c.sha256}>SHA-256 {c.sha256?.slice(0, 16)}…</span>
            </span>
            {#if c.rawUrl}
              <Button size="sm" variant="ghost" icon="link" onclick={copyRaw}>{t('share.copyRaw')}</Button>
            {/if}
          </section>
        {:else}
          <p class="dest">
            <span class="dest-k">{t('detail.destination')}</span>
            <a href={link.url} target="_blank" rel="noopener noreferrer">{link.url}</a>
          </p>
        {/if}

        {#if link.tags.length}<div class="tag-detail"><span>{t('tags.label')}</span><TagList ids={link.tags} /></div>{/if}
        <div class="stats-head">
          <dl class="figs">
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
              <dd class="soft">{link.lastClickAt ? formatRelative(link.lastClickAt, clock.now) : t('detail.never')}</dd>
            </div>
          </dl>
          <Segmented
            size="sm"
            label={t('detail.chart')}
            value={range}
            onchange={(v) => (range = v)}
            options={[7, 30, 90].map((n) => ({ value: n, label: t('detail.days', { n }) }))}
          />
        </div>

        {#if stats}
          <BarChart days={stats.days} dim={loading} label={t('detail.chart')} empty={t('detail.noVisits')} />
          {#if stats.referrers.length > 0}
            <section class="refs">
              <h2>{t('detail.referrers')}</h2>
              <ul>
                {#each stats.referrers as r (r.host)}
                  {@const share = stats.referrersTotal ? r.count / stats.referrersTotal : 0}
                  <li>
                    <span class={['host', (!r.host || r.host === '*') && 'direct']}>
                      {r.host === '*' ? t('detail.otherSites') : r.host || t('detail.direct')}
                    </span>
                    <span class="n">{formatNumber(r.count)}</span>
                    <span class="pct">{Math.round(share * 100)}%</span>
                    <span class="track" aria-hidden="true"><span class="fill" style:width="{Math.max(1, share * 100)}%"></span></span>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}
        {:else}
          <div class="chart-placeholder" aria-busy="true"></div>
        {/if}
      </div>

      <aside class="side">
        <div class="qr">
          <QRCode value={link.shortUrl} size={116} label={t('detail.qrLabel', { url: stripScheme(link.shortUrl) })} />
          <div class="qr-actions">
            <Button size="sm" variant="ghost" icon="download" onclick={png}>PNG</Button>
            <Button size="sm" variant="ghost" onclick={svg}>SVG</Button>
          </div>
        </div>
        <dl class="meta">
          <div>
            <dt>{t('detail.created')}</dt>
            <dd>{formatDateTime(link.createdAt, clock.now)}</dd>
          </div>
          <div>
            <dt>{t('detail.expires')}</dt>
            <dd class={link.status === 'expired' ? 'warn' : ''}>
              {link.expiresAt ? formatDateTime(link.expiresAt, clock.now) : t('expiry.never')}
            </dd>
          </div>
          <div>
            <dt>{t('detail.limit')}</dt>
            <dd class={link.status === 'exhausted' ? 'warn' : ''}>
              {link.maxClicks
                ? t('detail.used', { n: formatNumber(Math.min(link.clicks, link.maxClicks)), max: formatNumber(link.maxClicks) })
                : t('composer.noLimit')}
            </dd>
          </div>
          {#if link.kind === 'url'}
            <div>
              <dt>{t('detail.redirect')}</dt>
              <dd>{redirectLabel} <span class="code">{link.redirect}</span></dd>
            </div>
          {/if}
        </dl>
      </aside>
    </div>

    <footer class="actions">
      <Button size="sm" icon="edit" onclick={() => (links.editingId = link.id)}>
        {t('act.edit')}<kbd>E</kbd>
      </Button>
      <Button size="sm" variant="ghost" icon={link.enabled ? 'pause' : 'power'} onclick={() => links.setEnabled(link, !link.enabled)}>
        {link.enabled ? t('detail.disable') : t('detail.enable')}
      </Button>
      {#if link.meta !== 'manual'}
        <Button size="sm" variant="ghost" icon="refresh" loading={refetching} onclick={refetch}>
          {refetching ? t('detail.fetching') : t('detail.refetch')}
        </Button>
      {/if}
      <span class="spacer"></span>
      <Button size="sm" variant="danger" icon="trash" onclick={() => links.remove(link)}>{t('act.delete')}</Button>
    </footer>
  {/if}
</div>

<style>
  .detail {
    border-top: 1px solid var(--line);
    background: var(--surface);
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 208px;
    gap: 28px;
    padding: 20px 20px 18px 16px;
  }

  .short {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
  }

  .short-url {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 16px;
    font-weight: 500;
  }

  .short-url:hover {
    color: var(--accent);
  }

  .short-actions {
    display: flex;
    gap: 4px;
  }

  .dest {
    display: flex;
    gap: 10px;
    margin-top: 8px;
    font-size: 13px;
    line-height: 1.55;
  }

  .dest-k {
    flex: none;
    color: var(--text-3);
  }

  .dest a {
    min-width: 0;
    color: var(--text-2);
    overflow-wrap: anywhere;
    text-decoration: underline;
    text-decoration-color: var(--line-2);
    text-underline-offset: 3px;
  }

  .dest a:hover {
    color: var(--text);
    text-decoration-color: currentColor;
  }

  .content {
    margin-top: 14px;
  }

  .content-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 6px;
  }

  .content-meta {
    color: var(--text-3);
    font-size: 12.5px;
  }

  .preview {
    max-height: 280px;
    margin: 0;
    padding: 12px 14px;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 13.5px;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .preview.code {
    font-family: var(--font-mono);
    font-size: 12.5px;
    white-space: pre;
    overflow-wrap: normal;
    tab-size: 4;
  }

  .content.file {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 12px 12px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  .ficon {
    display: grid;
    flex: none;
    width: 38px;
    height: 38px;
    place-items: center;
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text-2);
  }

  .finfo {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .fname {
    overflow: hidden;
    font-size: 14px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fmeta {
    color: var(--text-2);
    font-size: 12.5px;
  }

  .sum {
    color: var(--text-3);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .stats-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    margin: 22px 0 18px;
  }

  .figs {
    display: flex;
    gap: 28px;
    margin: 0;
  }

  .figs dt {
    color: var(--text-3);
    font-size: 12px;
  }

  .figs dd {
    margin: 2px 0 0;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.015em;
    line-height: 1.2;
  }

  .figs dd.soft {
    /* Puts the 14px text on the 22px figures' baseline. */
    padding-top: 8px;
    color: var(--text-2);
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0;
  }

  .chart-placeholder {
    height: 148px;
  }

  .refs {
    margin-top: 22px;
  }

  .refs h2 {
    margin-bottom: 8px;
    color: var(--text-3);
    font-size: 12px;
    font-weight: 500;
  }

  .refs ul {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .refs li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 40px;
    gap: 4px 12px;
    align-items: baseline;
    font-size: 13px;
  }

  .refs .host {
    overflow: hidden;
    color: var(--text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .refs .direct {
    color: var(--text-2);
  }

  .refs .n,
  .refs .pct {
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .refs .pct {
    color: var(--text-3);
  }

  .track {
    grid-column: 1 / -1;
    height: 3px;
    border-radius: 2px;
    background: var(--surface-2);
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--accent);
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .qr {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 14px 12px 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
  }

  .qr :global(.qr) {
    padding: 6px;
    border-radius: var(--radius-sm);
    background: #fff;
    box-sizing: content-box;
  }

  .qr-actions {
    display: flex;
    gap: 2px;
  }

  .meta {
    display: grid;
    gap: 9px;
    margin: 0;
    font-size: 12.5px;
  }

  .meta div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .meta dt {
    color: var(--text-3);
    white-space: nowrap;
  }

  .meta dd {
    margin: 0;
    color: var(--text);
    text-align: right;
  }

  .meta .warn {
    color: var(--warning);
  }

  /* The redirect status code. Scoped to the meta list: a bare .code would
     also match the code preview and dim it. */
  .meta .code {
    color: var(--text-3);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 10px 12px 12px 16px;
    border-top: 1px solid var(--line);
  }

  .actions kbd {
    margin-left: 2px;
    min-width: 16px;
    height: 16px;
    font-size: 10px;
  }

  .spacer {
    flex: 1;
  }

  @media (max-width: 760px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
      gap: 22px;
    }

    .side {
      flex-direction: row;
      align-items: flex-start;
      gap: 20px;
    }

    .meta {
      flex: 1;
    }
  }

  @media (max-width: 640px) {
    .grid {
      padding: 16px 14px;
    }

    .figs {
      gap: 20px;
    }

    .figs dd {
      font-size: 19px;
    }

    .figs dd.soft {
      padding-top: 5px;
    }

    .actions kbd {
      display: none;
    }
  }
</style>
