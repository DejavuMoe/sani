<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Tag } from '../lib/api';
  let { tag, children }: { tag: Tag; children?: Snippet } = $props();
</script>

<span class="tag-badge tag-{tag.color}">
  <span class="tag-dot" aria-hidden="true"></span>
  <span class="tag-name" title={tag.name}>{tag.name}</span>
  {@render children?.()}
</span>
