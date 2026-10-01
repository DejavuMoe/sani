<script lang="ts">
  import type { Link } from '../lib/api';
  import { clock } from '../lib/clock.svelte';
  import { copyText } from '../lib/clipboard';
  import { formatCompact, formatDateTime, formatNumber, formatRelative, t, type MessageKey } from '../lib/i18n.svelte';
  import { links } from '../lib/links.svelte';
  import { toasts } from '../lib/toast.svelte';
  import { formatSize, mediaType } from '../lib/size';
  import { displayParts, stripScheme } from '../lib/url';
  import Favicon from './Favicon.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import LinkDetail from './LinkDetail.svelte';
  import Sparkline from './Sparkline.svelte';

  let { link }: { link: Link } = $props();

  const expanded = $derived(links.expandedId === link.id);
  const selected = $derived(links.selectedId === link.id);
  const picked = $derived(links.picked.has(link.id));
  const fresh = $derived(links.fresh.has(link.id));
  const parts = $derived(displayParts(link.url));
  const spark = $derived(link.spark ?? new Array(14).fill(0));
  const sparkTotal = $derived(spark.reduce((a, b) => a + b, 0));
  const timeKey = $derived(links.sort === 'visited' ? link.lastClickAt : link.createdAt);
  const shared = $derived(link.kind !== 'url' && link.content ? link.content : null);
  const sharedTitle = $derived(link.title || shared?.preview || shared?.name || link.slug);
  /** What a text or file is, in place of a destination. */
  const sharedInfo = $derived.by(() => {
    const c = shared;
    if (!c) return '';
    if (link.kind === 'text') {
      const kind = c.format === 'code' ? t('format.code') : t('format.plain');
      return [kind, t('share.lines', { n: c.lines ?? 0 }), formatSize(c.size)].join(' · ');
    }
    return [link.title ? c.name : mediaType(c.type), formatSize(c.size)].filter(Boolean).join(' · ');
  });

  const statusIcon: Record<string, IconName> = { disabled: 'pause', expired: 'clock', exhausted: 'gauge' };

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  function toggle(e: MouseEvent) {
    // Selecting text in a row should not fold it open or shut.
    if (getSelection()?.toString()) return;
    links.selectedId = link.id;
    if (links.picking) {
      links.togglePick(link.id, e.shiftKey);
      return;
    }
    if (expanded) {
      links.expandedId = null;
      links.editingId = null;
    } else {
      links.expandedId = link.id;
    }
  }

  async function copy() {
    if (await copyText(link.shortUrl)) {
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1600);
      toasts.success(t('act.copied'), { detail: stripScheme(link.shortUrl) });
    }
  }
</script>

<div
  class={[
    'row',
    expanded && 'expanded',
    selected && 'selected',
    fresh && 'fresh',
    picked && 'picked',
    link.status !== 'active' && 'inactive',
  ]}
  data-link={link.id}
>
  <!-- The button carries keyboard access; the whole line is a larger mouse target. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="line" onclick={toggle}>
    {#if links.picking}
      <span class={['box', picked && 'on']} aria-hidden="true">
        {#if picked}<Icon name="check" size={12} stroke={2.25} />{/if}
      </span>
    {/if}
    <!-- In selection mode the row is a checkbox; otherwise it opens the details. -->
    <button
      class="main"
      role={links.picking ? 'checkbox' : undefined}
      aria-checked={links.picking ? picked : undefined}
      aria-expanded={links.picking ? undefined : expanded}
      aria-controls={links.picking ? undefined : `detail-${link.id}`}
      onfocus={() => (links.selectedId = link.id)}
    >
      <span class="slug">
        <span class={['slash', shared && 'shared']}>{shared ? '/p/' : '/'}</span>{link.slug}
      </span>
      <span class="target">
        <span class="title-line">
          {#if shared}
            <span class="kind"><Icon name={link.kind === 'text' ? 'text' : 'file'} size={14} /></span>
            <span class={['title', !link.title && link.kind === 'text' && 'excerpt']}>{sharedTitle}</span>
          {:else}
            <Favicon host={link.host} icon={link.icon} size={14} />
            {#if link.title}
              <span class="title">{link.title}</span>
            {:else if link.meta === 'pending'}
              <span class="title pending" aria-label={t('detail.fetching')}></span>
            {:else}
              <span class="title untitled">{parts.host || link.url}</span>
            {/if}
          {/if}
          {#if link.status !== 'active'}
            <span class="badge"><Icon name={statusIcon[link.status]} size={12} />{t(`status.${link.status}` as MessageKey)}</span>
          {/if}
        </span>
        <span class="dest">
          {#if shared}
            {sharedInfo}
          {:else if link.title || link.meta === 'pending'}
            <span class="host">{parts.host}</span><span class="rest">{parts.rest}</span>
          {:else if parts.host}
            <span class="rest">{parts.rest || '/'}</span>
          {/if}
        </span>
      </span>
    </button>
    <span class="spark" title={t('list.spark', { n: sparkTotal })}>
      <Sparkline values={spark} label={t('list.spark', { n: sparkTotal })} />
    </span>
    <span class="clicks" title={formatNumber(link.clicks)}>{formatCompact(link.clicks)}</span>
    <span class="age" title={timeKey ? formatDateTime(timeKey) : ''}>
      {timeKey ? formatRelative(timeKey, clock.now) : '–'}
    </span>
    <button
      class={['copy', copied && 'done']}
      aria-label={t('list.copyShort')}
      title={t('list.copyShort')}
      onclick={(e) => {
        e.stopPropagation();
        copy();
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} stroke={copied ? 2 : 1.5} />
    </button>
  </div>
  {#if expanded}
    <LinkDetail {link} />
  {/if}
</div>

<style>
  .row {
    position: relative;
  }

  .line {
    position: relative;
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 60px;
    padding: 8px 10px 8px 16px;
    cursor: pointer;
    transition: background-color var(--fast) var(--ease);
  }

  .line:hover,
  .expanded .line {
    background: color-mix(in oklab, var(--surface), var(--surface-2) 55%);
  }

  .selected .line::before {
    content: '';
    position: absolute;
    top: 10px;
    bottom: 10px;
    left: 0;
    width: 2px;
    border-radius: 0 2px 2px 0;
    background: var(--accent);
  }

  /* Half-strength, so the row's dimmest text keeps AA contrast on it. */
  .picked .line,
  .picked .line:hover {
    background: color-mix(in oklab, var(--accent-soft) 50%, var(--surface));
  }

  .box {
    display: grid;
    flex: none;
    width: 16px;
    height: 16px;
    place-items: center;
    /* The box is the control: its edge keeps 3:1 against the row. */
    border: 1.5px solid var(--text-3);
    border-radius: var(--radius-xs);
    background: var(--surface);
    color: #fff;
    transition:
      background-color var(--fast) var(--ease),
      border-color var(--fast) var(--ease);
  }

  .line:hover .box {
    border-color: var(--text-2);
  }

  .box.on,
  .line:hover .box.on {
    border-color: var(--accent);
    background: var(--accent);
  }

  :global([data-theme='dark']) .box.on {
    color: #0d0f1c;
  }

  .fresh .line {
    animation: fresh 2.4s var(--ease);
  }

  @keyframes fresh {
    0%,
    25% {
      background: var(--accent-soft);
    }
    100% {
      background: transparent;
    }
  }

  .main {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 16px;
    min-width: 0;
    padding: 2px 0;
    text-align: left;
    border-radius: var(--radius-sm);
  }

  .main:focus-visible {
    outline-offset: 4px;
  }

  .slug {
    flex: none;
    width: var(--col-slug);
    overflow: hidden;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slash {
    color: var(--text-4);
    font-weight: 400;
  }

  /* "/p/" carries a letter, so it needs text contrast, not a separator's. */
  .slash.shared {
    color: var(--text-3);
  }

  .target {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .title-line {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .title {
    overflow: hidden;
    color: var(--text);
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .untitled {
    color: var(--text-2);
  }

  .excerpt {
    font-family: var(--font-mono);
    font-size: 13px;
  }

  .kind {
    display: grid;
    flex: none;
    width: 14px;
    height: 14px;
    place-items: center;
    color: var(--text-3);
  }

  .pending {
    width: min(220px, 60%);
    height: 12px;
    border-radius: 3px;
    background: var(--surface-3);
    animation: breathe 1.2s ease-in-out infinite alternate;
  }

  @keyframes breathe {
    from {
      opacity: 0.45;
    }
    to {
      opacity: 1;
    }
  }

  .badge {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 3px;
    height: 18px;
    padding: 0 6px 0 4px;
    border: 1px solid var(--line-2);
    border-radius: 4px;
    color: var(--text-2);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }

  .dest {
    overflow: hidden;
    padding-left: 21px;
    color: var(--text-3);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dest .host {
    color: var(--text-2);
  }

  .inactive .slug,
  .inactive .title,
  .inactive .dest,
  .inactive .dest .host,
  .inactive .clicks {
    color: var(--text-3);
  }

  .inactive .spark,
  .inactive .title-line > .kind,
  .inactive .title-line > :global(.fav),
  .inactive .title-line > :global(.letter) {
    opacity: 0.5;
  }

  .spark {
    display: flex;
    flex: none;
    justify-content: flex-end;
    width: var(--col-spark);
  }

  .clicks {
    flex: none;
    width: var(--col-clicks);
    color: var(--text);
    font-size: 14px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .age {
    flex: none;
    width: var(--col-age);
    color: var(--text-3);
    font-size: 12.5px;
    text-align: right;
    white-space: nowrap;
  }

  .copy {
    display: grid;
    flex: none;
    width: 30px;
    height: 30px;
    place-items: center;
    border-radius: var(--radius-sm);
    color: var(--text-3);
    transition:
      background-color var(--fast) var(--ease),
      color var(--fast) var(--ease);
  }

  .line:hover .copy {
    color: var(--text-2);
  }

  .copy:hover {
    background: var(--surface-3);
    color: var(--text) !important;
  }

  .copy.done {
    color: var(--success) !important;
  }

  @media (max-width: 760px) {
    .spark {
      display: none;
    }
  }

  @media (max-width: 640px) {
    .line {
      align-items: flex-start;
      gap: 10px;
      padding: 12px 8px 12px 14px;
    }

    .main {
      flex-direction: column;
      align-items: stretch;
      gap: 3px;
    }

    .slug {
      width: auto;
    }

    .dest {
      padding-left: 0;
    }

    .age {
      display: none;
    }

    .clicks {
      width: auto;
      min-width: 28px;
      padding-top: 3px;
    }

    .copy {
      margin-top: -3px;
    }

    .box {
      margin-top: 2px;
    }
  }
</style>
