<script lang="ts">
  import { tooltip } from '../lib/tooltip';
  import { links } from '../lib/links.svelte';
  import TagBadge from './TagBadge.svelte';
  let { ids, limit = Infinity }: { ids: number[]; limit?: number } = $props();
  const chosen = $derived(links.tags.filter(t => ids.includes(t.id)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)));
</script>

{#if chosen.length}
  <span class="tag-badges">
    {#each chosen.slice(0, limit) as tag (tag.id)}<TagBadge {tag} />{/each}
    {#if chosen.length > limit}<span class="tag-overflow" use:tooltip={chosen.slice(limit).map(t => t.name).join(', ')}>+{chosen.length - limit}</span>{/if}
  </span>
{/if}
