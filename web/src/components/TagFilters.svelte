<script lang="ts">
  import type { TagColor, TagFilter } from '../lib/api';
  import { t } from '../lib/i18n.svelte';
  import { links } from '../lib/links.svelte';
  import Icon from './Icon.svelte';
  const filters = $derived<{ id: TagFilter; name: string; count: number; color?: TagColor }[]>([
    { id: null, name: t('tags.all'), count: links.allCount },
    ...links.tags,
    { id: 'untagged', name: t('tags.untagged'), count: links.untaggedCount },
  ]);
</script>

{#if links.tagsLoaded}
  <div class="tag-filters" role="group" aria-label={t('tags.filter')}>
    <span class="tag-filter-label"><Icon name="tag" size={14} />{t('tags.label')}</span>
    {#each filters as tag (tag.id ?? 'all')}
      <button type="button" class="tag-filter {tag.color ? `tag-${tag.color}` : ''}" aria-pressed={links.tag === tag.id} onclick={() => links.setTag(links.tag === tag.id ? null : tag.id)}>
        {#if tag.color}<span class="tag-dot" aria-hidden="true"></span>{/if}<span class="tag-name">{tag.name}</span><span class="tag-count">{tag.count}</span>
      </button>
    {/each}
  </div>
{/if}
