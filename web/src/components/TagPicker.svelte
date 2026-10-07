<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ApiError, type TagColor } from '../lib/api';
  import { errorText, t } from '../lib/i18n.svelte';
  import { links } from '../lib/links.svelte';
  import { TAG_COLORS, TAG_LIMIT, TAG_NAME_LIMIT, tagKey } from '../lib/tags';
  import Icon from './Icon.svelte';
  import TagBadge from './TagBadge.svelte';

  let { value = $bindable<number[]>([]), creating = $bindable(false), disabled = false, framed = false }: { value?: number[]; creating?: boolean; disabled?: boolean; framed?: boolean } = $props();
  const id = $props.id();
  let trigger = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();
  let input = $state<HTMLInputElement>();
  let open = $state(false);
  let query = $state('');
  let color = $state<TagColor>('blue');
  let error = $state('');
  const normalized = $derived(query.trim().normalize('NFC'));
  const tooLong = $derived([...normalized].length > TAG_NAME_LIMIT);
  const full = $derived(value.length >= TAG_LIMIT);
  const options = $derived(links.tags.filter(tag => tagKey(tag.name).includes(tagKey(query))));
  const exact = $derived(links.tags.some(tag => tagKey(tag.name) === tagKey(query)));
  const chosen = $derived(value.flatMap(id => links.tags.filter(t => t.id === id)));
  const close = () => pop?.hidePopover();

  function place() {
    if (!trigger || !pop || !open) return;
    const box = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const bottom = top + (viewport?.height ?? innerHeight);
    const left = viewport?.offsetLeft ?? 0;
    // The stable scrollbar gutter may be included in visualViewport.width.
    const right = Math.min(left + (viewport?.width ?? innerWidth), document.documentElement.getBoundingClientRect().right);
    pop.style.maxWidth = `${right - left - 16}px`;
    pop.style.maxHeight = `${bottom - top - 16}px`;
    pop.style.left = `${Math.max(left + 8, Math.min(box.left, right - pop.offsetWidth - 8))}px`;
    pop.style.top = `${Math.max(top + 8, Math.min(box.bottom + 6, bottom - pop.offsetHeight - 8))}px`;
  }
  onMount(() => {
    if (!links.tagsLoaded) links.refreshTags();
    const observer = new ResizeObserver(place);
    if (pop) observer.observe(pop);
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      removeEventListener('resize', place);
      removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
    };
  });
  $effect(() => { if (disabled) close(); });
  async function ontoggle(e: Event) {
    open = (e as ToggleEvent).newState === 'open';
    if (open) { await tick(); place(); input?.focus(); }
    else {
      query = '';
      error = '';
      if (pop?.contains(document.activeElement) || document.activeElement === document.body) trigger?.focus();
    }
  }
  function toggle(id: number) {
    if (disabled || creating) return;
    if (value.includes(id)) value = value.filter(v => v !== id);
    else if (!full) value = [...value, id];
  }
  async function create() {
    if (!normalized || tooLong || full || exact || disabled || creating) return;
    creating = true;
    error = '';
    try {
      const tag = await links.addTag(normalized, color);
      if (!value.includes(tag.id) && value.length < TAG_LIMIT) value = [...value, tag.id];
      query = '';
      input?.focus();
    } catch (e) { error = errorText(e instanceof ApiError ? e.code : 'unknown'); }
    finally { creating = false; }
  }
  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); trigger?.focus(); return; }
    if (e.isComposing) return;
    const choices = [...(pop?.querySelectorAll<HTMLButtonElement>('.tag-choice:not(:disabled), .tag-create:not(:disabled)') ?? [])];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const index = choices.indexOf(document.activeElement as HTMLButtonElement);
      const next = index < 0 ? (e.key === 'ArrowDown' ? 0 : choices.length - 1)
        : (index + (e.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length;
      choices[next]?.focus();
    } else if (e.key === 'Enter' && e.target === input) {
      e.preventDefault();
      if (normalized && !exact) create();
      else if (options[0]) toggle(options[0].id);
    }
  }
</script>

<div class="tag-field" class:tag-field-framed={framed} role="group" aria-label={t('tags.label')}>
  <span class="tag-label"><Icon name="tag" size={14} />{t('tags.label')}</span>
  <div class="tag-selected">
    {#each chosen as tag (tag.id)}
      <TagBadge {tag}><button type="button" disabled={disabled || creating} aria-label={t('tags.remove', { name: tag.name })} onclick={() => toggle(tag.id)}><Icon name="x" size={12} /></button></TagBadge>
    {/each}
    <button bind:this={trigger} type="button" class="tag-add" popovertarget={id} aria-haspopup="dialog" aria-expanded={open} {disabled}>
      <Icon name="plus" size={13} />{t(value.length ? 'tags.add' : 'tags.choose')}
    </button>
  </div>
  <div bind:this={pop} {id} class="tag-pop" popover="auto" role="dialog" tabindex="-1" aria-label={t('tags.label')} {onkeydown} {ontoggle}>
    <div class="tag-search"><Icon name="search" size={15} /><input bind:this={input} bind:value={query} placeholder={t('tags.search')} aria-label={t('tags.search')} aria-invalid={tooLong || undefined} aria-describedby="{id}-status" autocomplete="off" spellcheck="false" /></div>
    <div class="tag-choices" role="group" aria-label={t('tags.label')}>
      {#if links.tagsFailed}
        <p class="tag-empty" role="alert">{t('list.loadError')} <button type="button" class="tag-done" onclick={() => links.refreshTags()}>{t('act.retry')}</button></p>
      {:else if !links.tagsLoaded}<p class="tag-empty" role="status">{t('list.loading')}</p>{/if}
      {#each options as tag (tag.id)}
        <button type="button" class="tag-choice" role="checkbox" aria-checked={value.includes(tag.id)} disabled={creating || (!value.includes(tag.id) && full)} onclick={() => toggle(tag.id)}>
          <TagBadge {tag} /><span class="tag-check">{#if value.includes(tag.id)}<Icon name="check" size={14} />{/if}</span>
        </button>
      {/each}
      {#if links.tagsLoaded && !links.tags.length && !normalized}<p class="tag-empty">{t('tags.empty')}</p>{/if}
      {#if normalized && !exact && !tooLong}
        <div class="tag-new">
          <button type="button" class="tag-create" disabled={full || creating || !links.tagsLoaded} aria-busy={creating} onclick={create}><Icon name="plus" size={14} /><span>{t('tags.create', { name: normalized })}</span></button>
          <div class="tag-colors" role="group" aria-label={t('tags.color')}>
            {#each TAG_COLORS as c}<button type="button" class="tag-color tag-{c}" aria-label={t(`tags.${c}`)} aria-pressed={color === c} disabled={creating} onclick={() => (color = c)}><span class="tag-swatch">{#if color === c}<Icon name="check" size={12} />{/if}</span></button>{/each}
          </div>
        </div>
      {/if}
      {#if error}<p class="tag-empty error-text" role="alert">{error}</p>{/if}
    </div>
    <footer><span id="{id}-status" class:error-text={tooLong} aria-live="polite">{t(tooLong ? 'tags.tooLong' : full ? 'tags.limit' : 'tags.count', { n: value.length })}</span><button type="button" class="tag-done" onclick={() => { close(); trigger?.focus(); }}>{t('tags.done')}</button></footer>
  </div>
</div>
