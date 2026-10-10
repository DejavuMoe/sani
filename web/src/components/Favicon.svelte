<script lang="ts">
  import { hostHue } from '../lib/url';
  import Icon from './Icon.svelte';

  let { host, icon, size = 16 }: { host: string; icon: boolean; size?: number } = $props();

  let failed = $state(false);
  const letter = $derived(([...host.replace(/^www\./, '')][0] ?? '').toUpperCase());
</script>

{#if host && icon && !failed}
  <img
    class="fav"
    src="/api/admin/v1/favicons/{encodeURIComponent(host)}"
    alt=""
    width={size}
    height={size}
    loading="lazy"
    decoding="async"
    onerror={() => (failed = true)}
  />
{:else if letter}
  <span class="letter" style:--h={hostHue(host)} style:width="{size}px" style:height="{size}px" aria-hidden="true">{letter}</span>
{:else}
  <span class="letter blank" style:width="{size}px" style:height="{size}px" aria-hidden="true">
    <Icon name="link" size={size - 4} />
  </span>
{/if}

<style>
  .fav {
    flex: none;
    border-radius: 3px;
    object-fit: contain;
  }

  :global([data-theme='dark']) .fav {
    padding: 1px;
    border-radius: 4px;
    background: #ecebe6;
    box-sizing: content-box;
    margin: -1px;
  }

  .letter {
    display: grid;
    flex: none;
    place-items: center;
    border-radius: 4px;
    background: oklch(0.93 0.03 var(--h));
    color: oklch(0.42 0.07 var(--h));
    font-size: 10px;
    font-weight: 650;
    line-height: 1;
  }

  :global([data-theme='dark']) .letter {
    background: oklch(0.3 0.035 var(--h));
    color: oklch(0.84 0.06 var(--h));
  }

  .blank,
  :global([data-theme='dark']) .blank {
    background: var(--surface-3);
    color: var(--text-3);
  }
</style>
