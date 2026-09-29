<script lang="ts">
  /*
   * Fourteen days in 55px: 3px bars on a 4px pitch so every edge lands on a
   * whole pixel, standing on one hairline baseline. Past days use the
   * de-emphasis ink and today the accent.
   */
  let { values, height = 18, label }: { values: number[]; height?: number; label: string } = $props();

  const BAR = 3;
  const PITCH = 4;
  const width = $derived(values.length * PITCH - (PITCH - BAR));
  const peak = $derived(Math.max(1, ...values));
</script>

<svg class="spark" {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label={label}>
  <rect class="base" x="0" y={height - 1} {width} height="1" />
  {#each values as v, i (i)}
    {#if v > 0}
      {@const h = Math.max(2, Math.round((v / peak) * (height - 2)))}
      <rect x={i * PITCH} y={height - 1 - h} width={BAR} height={h} rx="1" class={['bar', i === values.length - 1 && 'today']} />
    {/if}
  {/each}
</svg>

<style>
  .spark {
    flex: none;
    overflow: visible;
  }

  .base {
    fill: var(--line);
  }

  .bar {
    fill: var(--text-4);
  }

  .bar.today {
    fill: var(--accent);
  }
</style>
