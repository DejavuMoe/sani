<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError, type Tag, type TagColor } from '../lib/api';
  import { errorText, t } from '../lib/i18n.svelte';
  import { links } from '../lib/links.svelte';
  import { tagKey, tagHex, TAG_NAME_LIMIT } from '../lib/tags';
  import Button from './Button.svelte';
  import ColorEditor from './ColorEditor.svelte';
  import Dialog from './Dialog.svelte';
  import Icon from './Icon.svelte';
  import Segmented from './Segmented.svelte';
  import TagBadge from './TagBadge.svelte';

  const id = $props.id();
  let query = $state(''), unused = $state(false);
  let editing = $state<Tag | null>(null), removing = $state<Tag | null>(null);
  let name = $state(''), color = $state<TagColor>('#5872a5'), colorValid = $state(true);
  let busy = $state(false), error = $state('');
  let search = $state<HTMLInputElement>(), nameInput = $state<HTMLInputElement>();
  let returnTo: HTMLElement | null = null;
  const rows = $derived(links.tags.filter(tag => (!unused || tag.count === 0) && tagKey(tag.name).includes(tagKey(query))));
  const duplicate = $derived(links.tags.some(tag => tag.id !== editing?.id && tagKey(tag.name) === tagKey(name)));
  const tooLong = $derived([...name.trim().normalize('NFC')].length > TAG_NAME_LIMIT);
  const valid = $derived(!!name.trim() && !tooLong && !duplicate && colorValid);
  $effect(() => { if (links.managingTags) { query = ''; unused = false; void links.refreshTags(); void tick().then(() => search?.focus()); } });

  async function closeChild() {
    editing = removing = null; error = '';
    await tick(); returnTo?.focus();
  }
  async function edit(tag: Tag, target: HTMLElement) {
    returnTo = target; editing = tag; name = tag.name; color = tagHex(tag.color) as TagColor; error = ''; colorValid = true;
    await tick(); nameInput?.focus();
  }
  async function save(e: SubmitEvent) {
    e.preventDefault(); if (!editing || !valid || busy) return;
    busy = true; error = '';
    try { await links.editTag(editing.id, name, color); await closeChild(); }
    catch (e) { error = errorText(e instanceof ApiError ? e.code : 'unknown'); }
    finally { busy = false; }
  }
  async function remove() {
    if (!removing || busy) return;
    busy = true; error = '';
    try { await links.deleteTag(removing.id); removing = null; await tick(); search?.focus(); }
    catch (e) { error = errorText(e instanceof ApiError ? e.code : 'unknown'); }
    finally { busy = false; }
  }
</script>

<Dialog bind:open={links.managingTags} title={t('tags.manage')} width={600} dismissible={!busy && !editing && !removing}>
  <div class="tag-manager">
    <p class="hint">{t('tags.manageHint')}</p>
    <div class="tag-manager-tools">
      <label class="tag-manager-search"><Icon name="search" /><input bind:this={search} bind:value={query} placeholder={t('tags.searchExisting')} aria-label={t('tags.searchExisting')} /></label>
      <Segmented size="lg" label={t('tags.scope')} value={Number(unused)} onchange={v => unused = v === 1} options={[{value:0,label:t('tags.all')},{value:1,label:t('tags.unused')}]} />
    </div>
    <div class="tag-manager-caption"><span>{links.tagsFailed || !links.tagsLoaded ? '—' : t('tags.total', {n:rows.length})}</span><span>{t('tags.items')}</span></div>
    {#if links.tagsFailed || !links.tagsLoaded}
      <div class="state-notice" role="status"><span>{t(links.tagsFailed ? 'tags.loadFailed' : 'list.loading')}</span><Button size="sm" onclick={() => links.refreshTags()}>{t('act.retry')}</Button></div>
    {:else}
      <div class="tag-manager-rows">
        {#each rows as tag (tag.id)}
          <div class="tag-manager-row"><TagBadge {tag} /><span class="tag-manager-total">{tag.count}</span><Button size="sm" variant="ghost" icon="edit" aria-label={t('tags.editNamed',{name:tag.name})} onclick={e => edit(tag,e.currentTarget)} /><Button size="sm" variant="danger" icon="trash" aria-label={t('tags.deleteNamed',{name:tag.name})} onclick={e => {returnTo=e.currentTarget;removing=tag;error='';}} /></div>
        {:else}<p class="tag-manager-empty">{t(query ? 'tags.noMatch' : unused ? 'tags.noUnused' : 'tags.empty')}</p>{/each}
      </div>
    {/if}
    <p class="hint tag-manager-foot">{t('tags.countHint')}</p>
  </div>
</Dialog>
<Dialog open={editing !== null} title={t('tags.edit')} dismissible={!busy} onclose={() => closeChild()}>
  {#if editing}
  <form class="tag-manager-edit" onsubmit={save} novalidate>
    <p class="hint">{t('tags.editHint')}</p>
    <label class="label" for={id}>{t('tags.name')}</label><input id={id} class="field" bind:this={nameInput} bind:value={name} disabled={busy} aria-invalid={duplicate || tooLong} />
    {#if duplicate || tooLong}<p class="error-text" role="alert">{t(duplicate ? 'err.tag_taken' : 'tags.tooLong')}</p>{/if}
    <ColorEditor bind:value={color} bind:valid={colorValid} disabled={busy} />
    {#if error}<p class="error-text" role="alert">{error}</p>{/if}
    <div class="dialog-actions"><Button disabled={busy} onclick={closeChild}>{t('act.cancel')}</Button><Button type="submit" variant="primary" loading={busy} disabled={!valid}>{t('act.save')}</Button></div>
  </form>
  {/if}
</Dialog>
<Dialog open={removing !== null} title={t('tags.deleteTitle',{name:removing?.name ?? ''})} dismissible={!busy} onclose={() => closeChild()}>
  <p class="dialog-copy">{t('tags.deleteHint',{n:links.tags.find(tag=>tag.id===removing?.id)?.count ?? removing?.count ?? 0})}</p>
  <p class="dialog-copy hint">{t('tags.irreversible')}</p>
  {#if removing && links.tag === removing.id}<p class="dialog-copy hint">{t('tags.deleteFilterHint')}</p>{/if}
  {#if error}<p class="error-text dialog-copy" role="alert">{error}</p>{/if}
  <div class="dialog-actions"><Button disabled={busy} onclick={closeChild}>{t('act.cancel')}</Button><Button variant="danger" loading={busy} onclick={remove}>{t(error ? 'tags.retryDelete' : 'tags.delete')}</Button></div>
</Dialog>
