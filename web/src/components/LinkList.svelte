<script lang="ts">
  import Button from './Button.svelte';
  import { tooltip } from '../lib/tooltip';
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';
  import type { LinkKind, Sort } from '../lib/api';
  import { t } from '../lib/i18n.svelte';
  import { mod } from '../lib/keys';
  import { links, MAX_PICK } from '../lib/links.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import LinkRow from './LinkRow.svelte';
  import Menu from './Menu.svelte';
  import MenuItem from './MenuItem.svelte';
  import TagFilters from './TagFilters.svelte';

  let search = $state<HTMLInputElement>();
  let sentinel = $state<HTMLElement>();
  let searchFocused = $state(false);
  let slowLoad = $state(false);

  export function focusSearch() {
    search?.focus();
    search?.select();
  }

  // Show placeholder rows only if the first page is slow to arrive.
  $effect(() => {
    if (links.loaded) {
      slowLoad = false;
      return;
    }
    const timer = setTimeout(() => (slowLoad = true), 200);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && !links.moreFailed && links.loadMore(), {
      rootMargin: '800px 0px',
    });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  const sorts: Sort[] = ['created', 'clicks', 'visited'];
  const kinds: (LinkKind | null)[] = [null, 'url', 'text', 'file'];
  const kindIcon: Record<LinkKind, IconName> = { url: 'link', text: 'text', file: 'file' };

  // The select-all box reflects the loaded links it would check.
  const pickable = $derived(links.items.slice(0, MAX_PICK));
  const allPicked = $derived(pickable.length > 0 && pickable.every((l) => links.picked.has(l.id)));
  const nonePicked = $derived(links.picked.size === 0);
  const empty = $derived(links.loaded && !links.stale && links.items.length === 0);
  const blank = $derived(empty && !links.query && !links.kind && links.tag === null);

  /** Splits a message around {key} placeholders so keys render as keycaps. */
  function withKeys(text: string, keys: Record<string, string[]>) {
    return text.split(/(\{\w+\})/).map((part) => {
      const m = part.match(/^\{(\w+)\}$/);
      return m && keys[m[1]] ? { keys: keys[m[1]] } : { text: part };
    });
  }
</script>

<section class="list-section" aria-label={t('list.label')}>
  <TagFilters />
  {#if !blank}
  <div class="toolbar">
    <label class="search" class:active={searchFocused || links.query}>
      <Icon name="search" />
      <span class="sr-only">{t('list.search')}</span>
      <input
        bind:this={search}
        type="search"
        placeholder={t('list.search')}
        value={links.query}
          oninput={(e) => { links.search(e.currentTarget.value); e.currentTarget.value = links.query; }}
        onfocus={() => (searchFocused = true)}
        onblur={() => (searchFocused = false)}
        onkeydown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            if (links.query) links.search('');
            else search?.blur();
          } else if (e.key === 'ArrowDown' && links.items.length) {
            e.preventDefault();
            links.selectedId = links.items[0].id;
            search?.blur();
            document.querySelector<HTMLElement>(`[data-link="${links.items[0].id}"] .main`)?.focus();
          }
        }}
        autocomplete="off"
        spellcheck="false"
      />
      {#if links.query}
        <button class="clear" aria-label={t('list.clearSearch')} onclick={() => (links.search(''), search?.focus())}>
          <Icon name="x" size={14} />
        </button>
      {:else if !searchFocused}
        <kbd class="slash" aria-hidden="true">/</kbd>
      {/if}
    </label>
    {#if (links.query || links.kind || links.tag !== null) && links.loaded && !links.stale}
      <span class="count" aria-live="polite">{t('list.results', { n: links.total })}</span>
    {/if}
    <button
      class={['pick', links.picking && 'on']}
      disabled={links.stale}
      aria-pressed={links.picking}
      aria-label={t('bulk.startLabel')}
      use:tooltip={t('bulk.startLabel')}
      onclick={() => (links.picking ? links.stopPicking() : links.startPicking())}
    >
      <Icon name="select" size={14} />
      <span class="pick-text">{t('bulk.start')}</span>
    </button>
    <Menu triggerClass={['kind', links.kind && 'on'].filter(Boolean).join(' ')} label={t('filter.label')} align="end" minWidth={160}>
      {#snippet button()}
        <Icon name={links.kind ? kindIcon[links.kind] : 'sliders'} size={14} />
        <span class="kind-text">{t(`filter.${links.kind ?? 'all'}`)}</span>
      {/snippet}
      {#snippet children(close)}
        {#each kinds as k (k ?? 'all')}
          <MenuItem
            icon={k ? kindIcon[k] : undefined}
            checked={links.kind === k}
            onclick={() => {
              links.setKind(k);
              close();
            }}>{t(`filter.${k ?? 'all'}`)}</MenuItem
          >
        {/each}
      {/snippet}
    </Menu>
    <Menu triggerClass="sort" label={t('list.sortBy')} align="end" minWidth={160}>
      {#snippet button()}
        <Icon name="sort" size={14} />
        {t(`sort.${links.sort}`)}
      {/snippet}
      {#snippet children(close)}
        {#each sorts as s (s)}
          <MenuItem
            checked={links.sort === s}
            onclick={() => {
              links.setSort(s);
              close();
            }}>{t(`sort.${s}`)}</MenuItem
          >
        {/each}
      {/snippet}
    </Menu>
  </div>
  {/if}

  {#if links.picking && !empty}
    <div class="bulkbar" role="group" aria-label={t('bulk.label')}>
      <button
        class="all"
        disabled={links.stale}
        role="checkbox"
        aria-checked={allPicked ? true : nonePicked ? false : 'mixed'}
        aria-label={t('bulk.all')}
        use:tooltip={t('bulk.all')}
        onclick={() => links.togglePickAll()}
      >
        <span class={['box', !nonePicked && 'on']} aria-hidden="true">
          {#if allPicked}<Icon name="check" size={12} stroke={2.25} />{:else if !nonePicked}<span class="dash"></span>{/if}
        </span>
      </button>
      <span class="picked-count" aria-live="polite">
        {nonePicked ? t('bulk.none') : t('bulk.count', { n: links.picked.size })}
      </span>
      <span class="actions">
        <button disabled={nonePicked || links.busy || links.stale} aria-label={t('bulk.enable')} onclick={() => links.bulk('enable')}>
          <Icon name="power" size={14} /><span class="name">{t('bulk.enable')}</span>
        </button>
        <button disabled={nonePicked || links.busy || links.stale} aria-label={t('bulk.disable')} onclick={() => links.bulk('disable')}>
          <Icon name="pause" size={14} /><span class="name">{t('bulk.disable')}</span>
        </button>
        <button class="danger" disabled={nonePicked || links.busy || links.stale} aria-label={t('bulk.delete')} onclick={() => links.bulk('delete')}>
          <Icon name="trash" size={14} /><span class="name">{t('bulk.delete')}</span>
        </button>
      </span>
      <button class="done" onclick={() => links.stopPicking()}>{t('bulk.done')}</button>
    </div>
  {/if}

  {#if (links.failed && links.loaded) || links.refreshFailed}
    <div class="state-notice error" role="alert"><span>{t(links.failed ? 'list.queryFailed' : 'list.refreshFailed')}</span><Button size="sm" loading={links.refreshing} onclick={() => links.failed ? links.load() : links.refresh()}>{t('act.retry')}</Button></div>
  {/if}
  {#if blank}
    <div class="blank">
      <div class="blank-art" aria-hidden="true">
        {#each [0, 1, 2] as i (i)}<span><i></i><i></i><i></i></span>{/each}
      </div>
      <h2>{t('list.emptyTitle')}</h2>
      <p>
        {#each withKeys(t('list.emptyBody'), { enter: ['↵'] }) as part, i (i)}
          {#if part.keys}{#each part.keys as k (k)}<kbd>{k}</kbd>{/each}{:else}{part.text}{/if}
        {/each}
      </p>
      <p class="soft">
        {#each withKeys(t('list.emptyPaste'), { key: [mod, 'V'] }) as part, i (i)}
          {#if part.keys}{#each part.keys as k (k)}<kbd>{k}</kbd>{/each}{:else}{part.text}{/if}
        {/each}
      </p>
    </div>
  {:else if empty && links.tag !== null}
    <div class="blank"><p>{t(links.query || links.kind ? 'list.emptyCombined' : 'list.emptyTag', {name:links.tag === 'untagged' ? t('tags.untagged') : links.tags.find(tag=>tag.id===links.tag)?.name ?? ''})}</p><button class="text-btn" onclick={() => links.setTag(null)}>{t('list.clearTag')}</button>{#if links.kind}<button class="text-btn" onclick={()=>links.setKind(null)}>{t('list.clearKind')}</button>{/if}{#if links.query}<button class="text-btn" onclick={()=>links.search('')}>{t('list.clearSearch')}</button>{/if}</div>
  {:else if empty && links.query}
    <div class="blank">
      <p>{t('list.noResults', { q: links.query })}</p>
      <button class="text-btn" onclick={() => links.search('')}>{t('list.clearSearch')}</button>
    </div>
  {:else if empty}
    <div class="blank">
      <p>{t(links.kind === 'text' ? 'list.noneText' : links.kind === 'file' ? 'list.noneFile' : 'list.noneUrl')}</p>
      <button class="text-btn" onclick={() => links.setKind(null)}>{t('list.showAll')}</button>
    </div>
  {:else if links.failed && !links.loaded}
    <div class="blank">
      <p>{t('list.loadError')}</p>
      <button class="text-btn" onclick={() => links.load()}>{t('act.retry')}</button>
    </div>
  {:else if !links.loaded}
    {#if slowLoad}
      <div class="card" role="status" aria-busy="true" aria-label={t('list.loading')}>
        {#each [0, 1, 2, 3] as i (i)}
          <div class="ghost-row" style:--d="{i * 90}ms">
            <span class="g g1"></span><span class="g g2"></span><span class="g g3"></span>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <div class={['card', links.stale && 'stale']} inert={links.stale} aria-busy={links.loading}>
      <div class="head" aria-hidden="true">
        {#if links.picking}<span class="h-pick"></span>{/if}
        <span class="h-slug">{t('list.col.link')}</span>
        <span class="h-target">{t('list.col.target')}</span>
        <span class="h-tags">{t('tags.label')}</span>
        <span class="h-spark">{t('list.col.activity')}</span>
        <button class={['h-clicks', links.sort === 'clicks' && 'on']} tabindex="-1" onclick={() => links.setSort('clicks')}>
          {t('list.col.clicks')}
          {#if links.sort === 'clicks'}<Icon name="chevronDown" size={12} />{/if}
        </button>
        <span class="h-copy"></span>
      </div>
      <ul>
        {#each links.items as link (link.id)}
          <li
            animate:flip={{ duration: links.loading ? 0 : 200 }}
            in:slide={{ duration: links.fresh.has(link.id) ? 220 : 0 }}
            out:slide={{ duration: links.leaving.has(link.id) ? 200 : 0 }}
          >
            <LinkRow {link} />
          </li>
        {/each}
      </ul>
    </div>
    <div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>
    {#if links.moreFailed}<div class="state-notice error" role="alert"><span>{t('list.moreFailed')}</span><Button size="sm" onclick={()=>links.loadMore()}>{t('act.retry')}</Button></div>
    {:else if links.next && !links.stale}<div class="more"><Button size="sm" loading={links.loadingMore} onclick={()=>links.loadMore()}>{t('list.more')}</Button></div>{/if}
    {#if links.loadingMore}
      <p class="more">{t('list.loading')}</p>
    {/if}
  {/if}
</section>

<style>
  .list-section {
    --col-slug: 150px;
    --col-spark: 55px;
    --col-clicks: 52px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 10px;
  }

  .search {
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
    gap: 8px;
    max-width: 360px;
    height: 34px;
    padding: 0 8px 0 11px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    color: var(--text-3);
    cursor: text;
    transition:
      background-color var(--fast) var(--ease),
      border-color var(--fast) var(--ease),
      max-width var(--normal) var(--ease);
  }

  .search:hover {
    background: var(--surface-2);
  }

  .search.active {
    max-width: 480px;
    border-color: var(--line-2);
    background: var(--surface);
  }

  .search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 14%, transparent);
  }

  .search input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    background: transparent;
    color: var(--text);
    font-size: var(--input-font-size, 13.5px);
  }

  .search input:focus {
    outline: none;
  }

  .search input::-webkit-search-cancel-button {
    display: none;
  }

  .clear {
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    border-radius: 4px;
    color: var(--text-3);
  }

  .clear:hover {
    background: var(--surface-3);
    color: var(--text);
  }

  @media (hover: none) {
    .slash {
      display: none;
    }
  }

  .count {
    margin-left: 6px;
    color: var(--text-3);
    font-size: 12.5px;
    white-space: nowrap;
  }

  .toolbar :global(.sort) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 10px;
    border-radius: var(--radius);
    color: var(--text-2);
    font-size: 13px;
    white-space: nowrap;
  }

  .toolbar :global(.sort:hover),
  .toolbar :global(.sort[aria-expanded='true']) {
    background: var(--surface-2);
    color: var(--text);
  }

  /* Pick, kind and sort sit together at the right edge. (The kind menu's
     popover sits between kind and sort, so a sibling rule can't group them.) */
  .pick {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    margin-left: auto;
    padding: 0 10px;
    border-radius: var(--radius);
    color: var(--text-2);
    font-size: 13px;
    white-space: nowrap;
  }

  .pick:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .pick.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .toolbar :global(.kind) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 10px;
    border-radius: var(--radius);
    color: var(--text-2);
    font-size: 13px;
    white-space: nowrap;
  }

  .toolbar :global(.kind:hover),
  .toolbar :global(.kind[aria-expanded='true']) {
    background: var(--surface-2);
    color: var(--text);
  }

  .toolbar :global(.kind.on) {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .bulkbar {
    position: sticky;
    z-index: 10;
    top: 56px;
    display: flex;
    align-items: center;
    gap: 14px;
    height: 44px;
    margin-bottom: 10px;
    padding: 0 8px 0 16px;
    border: 1px solid var(--accent-line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-pop);
  }

  .bulkbar .all {
    display: grid;
    width: 16px;
    height: 16px;
    place-items: center;
    border-radius: var(--radius-xs);
  }

  .bulkbar .box {
    display: grid;
    width: 16px;
    height: 16px;
    place-items: center;
    border: 1.5px solid var(--text-3);
    border-radius: var(--radius-xs);
    color: #fff;
  }

  .bulkbar .box.on {
    border-color: var(--accent);
    background: var(--accent);
  }

  :global([data-theme='dark']) .bulkbar .box.on {
    color: #0d0f1c;
  }

  .dash {
    width: 8px;
    height: 2px;
    border-radius: 1px;
    background: currentColor;
  }

  .picked-count {
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
  }

  .bulkbar button:not(.all) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border-radius: var(--radius);
    color: var(--text-2);
    font-size: 13px;
    line-height: 1;
    white-space: nowrap;
  }

  .bulkbar button:not(.all):hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }

  .bulkbar .danger {
    color: var(--danger);
  }

  .bulkbar .danger:hover:not(:disabled) {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .bulkbar button:disabled {
    opacity: 0.45;
  }

  .bulkbar .done {
    color: var(--text);
    font-weight: 500;
  }

  .h-pick {
    width: 16px;
  }

  .card {
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    transition: opacity var(--normal) var(--ease);
  }

  .stale {
    color: var(--text-2);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 34px;
    padding: 0 10px 0 16px;
    border-bottom: 1px solid var(--line);
    color: var(--text-3);
    font-size: 12px;
  }

  .head > * {
    flex: none;
  }

  .h-slug {
    width: var(--col-slug);
  }

  .h-target {
    flex: 1;
    margin-left: 2px;
  }

  .h-spark {
    width: var(--col-spark);
    text-align: right;
  }

  .h-clicks {
    width: var(--col-clicks);
    text-align: right;
  }

  .h-tags { flex: none; width: 110px; }

  .h-copy {
    width: 30px;
  }

  .head button {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    color: var(--text-3);
    font-size: 12px;
  }

  /* The column that orders the list carries a small descending mark. */
  .head button :global(.icon) {
    margin-right: -3px;
    color: var(--text-3);
  }

  .head button:hover {
    color: var(--text);
  }

  .head button.on {
    color: var(--text-2);
    font-weight: 500;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li + li {
    border-top: 1px solid var(--line);
  }

  .blank {
    padding: 56px 24px 64px;
    border: 1px dashed transparent;
    color: var(--text-2);
    text-align: center;
  }

  /* Three outline rows in the list's shape above the first-run message. */
  .blank-art {
    display: grid;
    width: min(100%, 320px);
    margin: 0 auto 26px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    mask-image: linear-gradient(to bottom, #000 30%, transparent);
  }

  .blank-art > span {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 40px;
    padding: 0 14px;
  }

  .blank-art > span + span {
    border-top: 1px solid var(--line);
  }

  .blank-art i {
    height: 6px;
    border-radius: 3px;
    background: var(--surface-3);
  }

  .blank-art i:nth-child(1) {
    width: 48px;
  }

  .blank-art i:nth-child(2) {
    flex: 1;
  }

  .blank-art i:nth-child(3) {
    width: 22px;
  }

  .blank-art > span:first-child i:nth-child(1) {
    background: var(--accent-line);
  }

  .blank h2 {
    margin-bottom: 8px;
    color: var(--text);
    font-size: 15px;
    font-weight: 600;
  }

  .blank p {
    max-width: 420px;
    margin: 0 auto;
    font-size: 13.5px;
    line-height: 1.65;
  }

  .blank .soft {
    margin-top: 4px;
    color: var(--text-3);
  }

  .blank kbd {
    margin: 0 2px;
    vertical-align: 1px;
  }

  .blank kbd + kbd {
    margin-left: 0;
  }

  .text-btn {
    margin-top: 10px;
    color: var(--accent);
    font-size: 13px;
    font-weight: 500;
  }

  .text-btn + .text-btn { margin-left:14px; }

  .text-btn:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .ghost-row {
    display: flex;
    align-items: center;
    gap: 16px;
    height: 60px;
    padding: 0 16px;
    border-top: 1px solid var(--line);
    animation: breathe 1.1s ease-in-out var(--d) infinite alternate;
  }

  .ghost-row:first-child {
    border-top: 0;
  }

  .g {
    height: 10px;
    border-radius: 3px;
    background: var(--surface-2);
  }

  .g1 {
    width: 90px;
  }

  .g2 {
    flex: 1;
    max-width: 320px;
  }

  .g3 {
    width: 40px;
    margin-left: auto;
  }

  @keyframes breathe {
    from {
      opacity: 0.5;
    }
    to {
      opacity: 1;
    }
  }

  .sentinel {
    height: 1px;
  }

  .more {
    padding: 14px;
    color: var(--text-3);
    font-size: 12.5px;
    text-align: center;
  }

  @media (max-width: 900px) {
    .h-spark {
      display: none;
    }
  }

  @media (max-width: 640px) {
    .head {
      display: none;
    }

    .search {
      max-width: none;
    }

    .search.active {
      max-width: none;
    }

    .count {
      display: none;
    }

    .pick-text,
    .kind-text,
    .bulkbar .name {
      display: none;
    }
  }
</style>
