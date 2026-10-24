<script lang="ts">
  import { hostHue } from '../lib/url';
  import Icon from './Icon.svelte';

  let { host, iconHost, icon, size = 16 }: { host: string; iconHost: string; icon: boolean; size?: number } = $props();

  let failed = $state(false);
  const letter = $derived(([...host.replace(/^www\./, '')][0] ?? '').toUpperCase());
</script>

{#if iconHost && icon && !failed}
  <img
    class="fav"
    src="/api/admin/v1/favicons/{encodeURIComponent(iconHost)}"
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
    background: #edeef0; /* slate 12 (dark): light-designed icons need a light tile */
    box-sizing: content-box;
    margin: -1px;
  }

  .letter {
    display: grid;
    flex: none;
    place-items: center;
    border-radius: 4px;
    background: var(--surface-3);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 650;
    line-height: 1;
  }


  .blank,
  :global([data-theme='dark']) .blank {
    background: var(--surface-3);
    color: var(--text-3);
  }
</style>
