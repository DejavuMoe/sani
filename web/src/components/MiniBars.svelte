<script lang="ts">
  /* Thirty days at a glance. Hover or focus a day to read it. */
  import type { DayCount } from '../lib/api';
  import { formatDay, t } from '../lib/i18n.svelte';

  let { days, height = 24, label }: { days: DayCount[]; height?: number; label: string } = $props();

  const BAR = 4;
  const PITCH = 6;
  const width = $derived(days.length * PITCH - (PITCH - BAR));
  const peak = $derived(days.reduce((m, d) => Math.max(m, d.count), 1));

  let active = $state<number | null>(null);

  function onpointermove(e: PointerEvent) {
    const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const i = Math.floor(((e.clientX - box.left) / box.width) * days.length);
    active = i >= 0 && i < days.length ? i : null;
  }

  function onkeydown(e: KeyboardEvent) {
    const cur = active ?? days.length - 1;
    if (e.key === 'ArrowLeft') active = Math.max(0, cur - 1);
    else if (e.key === 'ArrowRight') active = Math.min(days.length - 1, cur + 1);
    else return;
    e.preventDefault();
  }
</script>

<!-- A keyboard-explorable chart: arrow keys move between days. The same data
     is in the table below for screen readers. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="mini"
  role="group"
  aria-label={label}
  tabindex="0"
  {onkeydown}
  onfocus={() => (active ??= days.length - 1)}
  onblur={() => (active = null)}
>
  <svg {width} {height} viewBox="0 0 {width} {height}" aria-hidden="true" {onpointermove} onpointerleave={() => (active = null)}>
    <rect class="hit" {width} {height} />
    <rect class="base" x="0" y={height - 1} {width} height="1" />
    {#each days as d, i (d.date)}
      {#if d.count > 0}
        {@const h = Math.max(2, Math.round((d.count / peak) * (height - 2)))}
        <rect
          x={i * PITCH}
          y={height - 1 - h}
          width={BAR}
          height={h}
          rx="1.5"
          class={['bar', i === days.length - 1 && 'today', active === i && 'on']}
        />
      {/if}
    {/each}
    {#if active !== null}
      <rect class="cursor" x={active * PITCH - 1} y="0" width={BAR + 2} {height} rx="2" />
    {/if}
  </svg>
  {#if active !== null}
    {@const d = days[active]}
    <div class="tip" style:left="{active * PITCH + BAR / 2}px">
      <strong>{t('chart.clicks', { n: d.count })}</strong>
      <span>{formatDay(d.date)}</span>
    </div>
  {/if}
  <table class="sr-only">
    <caption>{label}</caption>
    <tbody>
      {#each days as d (d.date)}
        <tr><td>{d.date}</td><td>{d.count}</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .mini {
    position: relative;
    flex: none;
    border-radius: var(--radius-xs);
  }

  .mini:focus-visible {
    outline-offset: 4px;
  }

  svg {
    display: block;
    overflow: visible;
  }

  .hit {
    fill: transparent;
  }

  .base {
    fill: var(--line-2);
  }

  .bar {
    fill: var(--text-4);
    transition: fill var(--fast) var(--ease);
  }

  .bar.today {
    fill: var(--accent);
  }

  .bar.on {
    fill: var(--text-2);
  }

  .bar.today.on {
    fill: var(--accent-hover);
  }

  .cursor {
    fill: color-mix(in oklab, var(--text) 7%, transparent);
  }

  .tip {
    position: absolute;
    z-index: 5;
    bottom: calc(100% + 8px);
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-pop);
    white-space: nowrap;
    transform: translateX(-50%);
    pointer-events: none;
  }

  :global([data-theme='dark']) .tip {
    background: var(--surface-2);
    border-color: var(--line-2);
  }

  .tip strong {
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .tip span {
    color: var(--text-3);
    font-size: 12px;
  }
</style>
