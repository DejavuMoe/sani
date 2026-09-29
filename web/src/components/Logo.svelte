<script lang="ts">
  /* The mark is the slash every short link is made of: the part after it is yours. */
  let { size = 20, wordmark = true }: { size?: number; wordmark?: boolean } = $props();
</script>

<span class="logo" role="img" aria-label="Sani">
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="8" class="tile" />
    <path d="M12.6 23.2 19.4 8.8" class="slash" />
  </svg>
  {#if wordmark}<span class="word" aria-hidden="true">sani</span>{/if}
</span>

<style>
  .logo {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .tile {
    fill: var(--ink);
  }

  .slash {
    fill: none;
    stroke: var(--on-ink);
    stroke-width: 3.4;
    stroke-linecap: round;
  }

  .word {
    color: var(--text);
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
</style>
