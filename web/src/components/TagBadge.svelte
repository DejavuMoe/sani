<script lang="ts">
  import { tooltip } from '../lib/tooltip';
  import { tagHex } from '../lib/tags';
  import type { Snippet } from 'svelte';
  import type { Tag } from '../lib/api';
  let { tag, children }: { tag: Tag; children?: Snippet } = $props();
</script>

<span class="tag-badge" style:--tag-color={tagHex(tag.color)}>
  <span class="tag-dot" aria-hidden="true"></span>
  <span class="tag-name" use:tooltip={tag.name}>{tag.name}</span>
  {@render children?.()}
</span>
