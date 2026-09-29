<script lang="ts" module>
  // A 16px grid, 1.5px strokes, round joins. Every glyph is plain path data so
  // it renders crisply at 14, 16 and 20px without an icon font or library.
  const circle = (cx: number, cy: number, r: number) =>
    `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  const rect = (x: number, y: number, w: number, h: number, r: number) =>
    `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

  const icons = {
    link: [
      'M6.9 9.1l2.2-2.2',
      'M7.4 4.6l1-1a3 3 0 0 1 4.2 4.2l-1 1',
      'M8.6 11.4l-1 1a3 3 0 0 1-4.2-4.2l1-1',
    ],
    copy: [rect(5.25, 5.25, 8.5, 8.5, 2), 'M10.75 5.25V4.5a2.25 2.25 0 0 0-2.25-2.25h-4a2.25 2.25 0 0 0-2.25 2.25v4a2.25 2.25 0 0 0 2.25 2.25h.75'],
    check: ['M3.25 8.4l3.1 3.1 6.4-6.9'],
    x: ['M4.5 4.5l7 7', 'M11.5 4.5l-7 7'],
    plus: ['M8 3.25v9.5', 'M3.25 8h9.5'],
    search: [circle(7.25, 7.25, 4.5), 'M10.6 10.6l2.9 2.9'],
    open: ['M5.5 10.5l5-5', 'M6.5 5.5h4v4'],
    qr: [
      rect(2.25, 2.25, 4.5, 4.5, 1),
      rect(9.25, 2.25, 4.5, 4.5, 1),
      rect(2.25, 9.25, 4.5, 4.5, 1),
      'M9.5 9.5h1.75v1.75',
      'M13.5 9.5v.01',
      'M13.5 13.5h-2.25v-.75',
      'M9.5 13.5v.01',
    ],
    edit: ['M10.2 3.3l2.5 2.5', 'M3 13l.6-2.9 7.3-7.3a1.2 1.2 0 0 1 1.7 0l.6.6a1.2 1.2 0 0 1 0 1.7L5.9 12.4z'],
    trash: [
      'M2.75 4.25h10.5',
      'M6.25 4.25v-1.5h3.5v1.5',
      'M4.25 4.25l.55 8.25a1.25 1.25 0 0 0 1.25 1.25h3.9a1.25 1.25 0 0 0 1.25-1.25l.55-8.25',
    ],
    sliders: ['M2.75 5h5.25', 'M11.5 5h1.75', 'M2.75 11h1.75', 'M8 11h5.25', circle(9.75, 5, 1.75), circle(6.25, 11, 1.75)],
    sun: [
      circle(8, 8, 2.75),
      'M8 1.75v1.25',
      'M8 13v1.25',
      'M1.75 8H3',
      'M13 8h1.25',
      'M3.6 3.6l.9.9',
      'M11.5 11.5l.9.9',
      'M3.6 12.4l.9-.9',
      'M11.5 4.5l.9-.9',
    ],
    moon: ['M13.25 9.75A5.5 5.5 0 1 1 6.25 2.75a4.4 4.4 0 0 0 7 7z'],
    monitor: [rect(1.75, 2.75, 12.5, 8.5, 1.75), 'M5.75 13.75h4.5'],
    chevronDown: ['M4.5 6.25L8 9.75l3.5-3.5'],
    chevronRight: ['M6.25 4.5L9.75 8l-3.5 3.5'],
    arrowLeft: ['M12.75 8H3.5', 'M7.25 4.25L3.5 8l3.75 3.75'],
    clock: [circle(8, 8, 5.75), 'M8 5.25V8l1.9 1.2'],
    refresh: ['M13.2 8.6A5.25 5.25 0 1 1 11.8 4.4', 'M13.25 2.75v3h-3'],
    key: [circle(5.5, 10.5, 2.75), 'M7.45 8.55l5.3-5.3', 'M10.75 5.25l1.75 1.75'],
    download: ['M8 2.75v7.5', 'M4.75 7.25L8 10.5l3.25-3.25', 'M2.75 13.25h10.5'],
    upload: ['M8 10.5V3', 'M4.75 6.25L8 3l3.25 3.25', 'M2.75 13.25h10.5'],
    logout: ['M9.25 2.75H5a2.25 2.25 0 0 0-2.25 2.25v6A2.25 2.25 0 0 0 5 13.25h4.25', 'M6.75 8h6.75', 'M10.75 5.25L13.5 8l-2.75 2.75'],
    pause: ['M5.75 4.25v7.5', 'M10.25 4.25v7.5'],
    power: ['M8 2.25v5', 'M4.7 4.4a5.25 5.25 0 1 0 6.6 0'],
    gauge: ['M2.75 11.75a5.25 5.25 0 1 1 10.5 0', 'M8 11.75l2.4-3.1'],
    more: ['M3.5 8h.01', 'M8 8h.01', 'M12.5 8h.01'],
    enter: ['M12.75 3.25V7a2.25 2.25 0 0 1-2.25 2.25H3.25', 'M5.75 6.75L3.25 9.25l2.5 2.5'],
    undo: ['M5.75 3.75l-2.5 2.5 2.5 2.5', 'M3.25 6.25h6.5a3.25 3.25 0 0 1 0 6.5H7.25'],
    keyboard: [rect(1.75, 3.75, 12.5, 8.5, 1.75), 'M4.75 6.75h.01', 'M7.25 6.75h.01', 'M9.75 6.75h.01', 'M11.25 6.75h.01', 'M5.25 9.25h5.5'],
    globe: [circle(8, 8, 5.75), 'M2.25 8h11.5', 'M8 2.25c1.55 1.6 2.35 3.5 2.35 5.75S9.55 12.15 8 13.75C6.45 12.15 5.65 10.25 5.65 8S6.45 3.85 8 2.25z'],
    alert: [circle(8, 8, 5.75), 'M8 5.25v3.25', 'M8 10.75v.01'],
    bookmark: ['M4.25 2.75h7.5v10.5L8 10.5l-3.75 2.75z'],
    phone: [rect(4.25, 1.75, 7.5, 12.5, 1.75), 'M7.25 11.75h1.5'],
    terminal: ['M3.25 4.75L6.5 8l-3.25 3.25', 'M8.5 11.25h4.25'],
    lock: [rect(3.25, 7.25, 9.5, 6.5, 1.5), 'M5.25 7.25v-1.5a2.75 2.75 0 0 1 5.5 0v1.5'],
    file: ['M9 1.75H4.75A2 2 0 0 0 2.75 3.75v8.5a2 2 0 0 0 2 2h6.5a2 2 0 0 0 2-2V6z', 'M9 1.75V6h4.25'],
    sort: ['M5.25 3.25v9.5', 'M2.75 10.25l2.5 2.5 2.5-2.5', 'M10.75 12.75v-9.5', 'M8.25 5.75l2.5-2.5 2.5 2.5'],
    dot: ['M8 8h.01'],
  } satisfies Record<string, string[]>;

  export type IconName = keyof typeof icons;
</script>

<script lang="ts">
  import type { ClassValue } from 'svelte/elements';

  let {
    name,
    size = 16,
    stroke = 1.5,
    class: cls = '',
  }: { name: IconName; size?: number; stroke?: number; class?: ClassValue } = $props();
</script>

<svg
  class={['icon', cls]}
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width={name === 'more' || name === 'dot' ? 2.25 : stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {#each icons[name] as d, i (i)}
    <path {d} />
  {/each}
</svg>

<style>
  .icon {
    flex: none;
  }
</style>
