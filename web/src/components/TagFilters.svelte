<script lang="ts">
  import { tagHex, tagKey } from '../lib/tags';
  import type { TagColor, TagFilter } from '../lib/api';
  import { t } from '../lib/i18n.svelte';
  import { links } from '../lib/links.svelte';
  import Icon from './Icon.svelte';
  import Dialog from './Dialog.svelte';
  import TagBadge from './TagBadge.svelte';
  let more = $state(false), query = $state('');
  const selected = $derived(links.tags.find(tag => tag.id === links.tag));
  const filters = $derived<{ id: TagFilter; name: string; count: number; color?: TagColor }[]>([
    { id: null, name: t('tags.all'), count: links.allCount },
    ...links.tags.slice(0,4),
    ...(selected && !links.tags.slice(0,4).some(tag=>tag.id===selected.id) ? [selected] : []),
    { id: 'untagged', name: t('tags.untagged'), count: links.untaggedCount },
  ]);
</script>
<div class="tag-filters" role="group" aria-label={t('tags.filter')}>
  <span class="tag-filter-label"><Icon name="tag" size={14} />{t('tags.label')}</span>
  {#if links.tagsLoaded}
    {#each filters as tag (tag.id ?? 'all')}
      <button type="button" class="tag-filter" style:--tag-color={tag.color ? tagHex(tag.color) : undefined} aria-pressed={links.tag === tag.id} onclick={() => links.setTag(links.tag === tag.id ? null : tag.id)}>
        {#if tag.color}<span class="tag-dot" aria-hidden="true"></span>{/if}<span class="tag-name">{tag.name}</span><span class="tag-count">{tag.count}</span>
      </button>
    {/each}
    <button type="button" class="tag-filter" aria-haspopup="dialog" onclick={()=>{query='';more=true;}}>{t('tags.more')}<Icon name="chevronDown" size={12}/></button>
  {/if}
  <button type="button" class="tag-manage-link" aria-haspopup="dialog" onclick={()=>links.managingTags=true}>{t('tags.manage')}</button>
</div>
<Dialog bind:open={more} title={t('tags.filter')}>
  <label class="tag-manager-search"><Icon name="search"/><input bind:value={query} aria-label={t('tags.searchExisting')} placeholder={t('tags.searchExisting')}/></label>
  <div class="tag-manager-more">
    {#each links.tags.filter(tag=>tagKey(tag.name).includes(tagKey(query))) as tag (tag.id)}
      <button type="button" class="tag-choice" aria-pressed={links.tag===tag.id} onclick={()=>{links.setTag(tag.id);more=false;}}><TagBadge {tag}/><span>{tag.count}</span></button>
    {:else}<p class="tag-manager-empty">{t('tags.noMatch')}</p>{/each}
  </div>
</Dialog>
