<script lang="ts">
  import type { DayCount } from '../lib/api';
  import { formatDay, formatNumber, t } from '../lib/i18n.svelte';

  let {
    days,
    height = 148,
    dim = false,
    label,
    empty,
  }: { days: DayCount[]; height?: number; dim?: boolean; label: string; empty?: string } = $props();

  const LEFT = 30; // y tick labels
  const TOP = 10;
  const AXIS = 22; // x tick labels

  let width = $state(0);
  let active = $state<number | null>(null);
  let tipWidth = $state(0);

  const plotW = $derived(Math.max(0, width - LEFT));
  const plotH = $derived(height - TOP - AXIS);
  const peak = $derived(days.reduce((m, d) => Math.max(m, d.count), 0));
  const step = $derived(niceStep(peak / 2));
  const top = $derived(step * 2);
  const slot = $derived(days.length ? plotW / days.length : 0);
  const bar = $derived(Math.max(1.5, Math.min(16, slot * 0.62)));
  const ticks = $derived([0, step, top]);

  function niceStep(v: number): number {
    if (v <= 1) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  const yOf = (v: number) => TOP + plotH - (v / top) * plotH;

  // Rounded data end, square baseline.
  function barPath(x: number, y: number, w: number, h: number): string {
    const r = Math.min(4, w / 2, h);
    return `M${x} ${y + h}V${y + r}a${r} ${r} 0 0 1 ${r} ${-r}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${y + h}z`;
  }

  function onpointermove(e: PointerEvent) {
    const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const i = Math.floor((e.clientX - box.left - LEFT) / slot);
    active = i >= 0 && i < days.length ? i : null;
  }

  function onkeydown(e: KeyboardEvent) {
    const last = days.length - 1;
    const cur = active ?? last;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1);
    else if (e.key === 'ArrowRight') next = Math.min(last, cur + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else if (e.key === 'Escape' && active !== null) {
      active = null;
      e.stopPropagation();
      return;
    }
    if (next !== null) {
      e.preventDefault();
      active = next;
    }
  }

  const tipLeft = $derived.by(() => {
    if (active === null) return 0;
    const center = LEFT + (active + 0.5) * slot;
    const half = tipWidth / 2;
    return Math.max(half, Math.min(width - half, center));
  });
</script>

<!-- A keyboard-explorable chart: arrow keys move between days. The same data
     is in the table below for screen readers. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class={['chart', dim && 'dim']}
  bind:clientWidth={width}
  role="group"
  aria-label={label}
  tabindex="0"
  {onkeydown}
  onfocus={() => (active ??= days.length - 1)}
  onblur={() => (active = null)}
>
  {#if width > 0 && days.length > 0}
    <svg {width} {height} aria-hidden="true" {onpointermove} onpointerleave={() => (active = null)}>
      {#if active !== null}
        <rect class="band" x={LEFT + active * slot} y={TOP - 4} width={slot} height={plotH + 4} rx="4" />
      {/if}
      {#each ticks as tick, i (i)}
        <line class={tick === 0 ? 'base' : 'grid'} x1={LEFT} x2={width} y1={Math.round(yOf(tick)) + 0.5} y2={Math.round(yOf(tick)) + 0.5} />
        {#if peak > 0 || tick === 0}
          <text class="tick" x={LEFT - 8} y={yOf(tick)} text-anchor="end" dominant-baseline="central">{formatNumber(tick)}</text>
        {/if}
      {/each}
      {#each days as d, i (d.date)}
        {#if d.count > 0}
          {@const h = Math.max(2, (d.count / top) * plotH)}
          <path
            class={['bar', active === i && 'on', active !== null && active !== i && 'off']}
            d={barPath(LEFT + i * slot + (slot - bar) / 2, TOP + plotH - h, bar, h)}
          />
        {/if}
      {/each}
      <text class="tick" x={LEFT} y={height - 5}>{formatDay(days[0].date, false)}</text>
      <text class="tick" x={width} y={height - 5} text-anchor="end">{t('detail.today')}</text>
    </svg>
    {#if peak === 0 && empty}
      <p class="empty" style:top="{TOP + plotH / 2}px" style:left="{LEFT}px">{empty}</p>
    {/if}
    {#if active !== null}
      {@const d = days[active]}
      <div class="tip" bind:clientWidth={tipWidth} style:left="{tipLeft}px" style:top="{yOf(d.count)}px" aria-hidden="true">
        <strong>{t('chart.clicks', { n: d.count })}</strong>
        <span>{formatDay(d.date)}</span>
      </div>
    {/if}
  {/if}

  <table class="sr-only">
    <caption>{t('chart.table')}</caption>
    <thead><tr><th>{t('chart.date')}</th><th>{t('detail.clicks')}</th></tr></thead>
    <tbody>
      {#each days as d (d.date)}
        <tr><td>{d.date}</td><td>{d.count}</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .chart {
    position: relative;
    width: 100%;
    border-radius: var(--radius-sm);
    transition: opacity var(--normal) var(--ease);
  }

  .chart:focus-visible {
    outline-offset: 4px;
  }

  .dim {
    opacity: 0.45;
  }

  svg {
    display: block;
    overflow: visible;
    touch-action: pan-y;
  }

  .grid {
    stroke: var(--line);
    stroke-width: 1;
  }

  .base {
    stroke: var(--line-2);
    stroke-width: 1;
  }

  .band {
    fill: var(--surface-2);
  }

  .bar {
    fill: var(--accent);
    transition: opacity var(--fast) var(--ease);
  }

  .bar.off {
    opacity: 0.35;
  }

  .tick {
    fill: var(--text-3);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .empty {
    position: absolute;
    right: 0;
    transform: translateY(-50%);
    color: var(--text-3);
    font-size: 13px;
    text-align: center;
    pointer-events: none;
  }

  .tip {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-pop);
    white-space: nowrap;
    transform: translate(-50%, calc(-100% - 8px));
    pointer-events: none;
  }

  :global([data-theme='dark']) .tip {
    background: var(--surface-2);
    border-color: var(--line-2);
  }

  .tip strong {
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .tip span {
    color: var(--text-3);
    font-size: 12px;
  }
</style>
