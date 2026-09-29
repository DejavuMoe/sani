<script lang="ts">
// The admin app's icons (web/src/components/Icon.svelte): a 16px grid,
// 1.5px strokes, round joins. Only the ones the docs use are copied here.
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const rect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

export const icons = {
  link: ['M6.9 9.1l2.2-2.2', 'M7.4 4.6l1-1a3 3 0 0 1 4.2 4.2l-1 1', 'M8.6 11.4l-1 1a3 3 0 0 1-4.2-4.2l1-1'],
  copy: [
    rect(5.25, 5.25, 8.5, 8.5, 2),
    'M10.75 5.25V4.5a2.25 2.25 0 0 0-2.25-2.25h-4a2.25 2.25 0 0 0-2.25 2.25v4a2.25 2.25 0 0 0 2.25 2.25h.75',
  ],
  check: ['M3.25 8.4l3.1 3.1 6.4-6.9'],
  enter: ['M12.75 3.25V7a2.25 2.25 0 0 1-2.25 2.25H3.25', 'M5.75 6.75L3.25 9.25l2.5 2.5'],
  alert: [circle(8, 8, 5.75), 'M8 5.25v3.25', 'M8 10.75v.01'],
  download: ['M8 2.75v7.5', 'M4.75 7.25L8 10.5l3.25-3.25', 'M2.75 13.25h10.5'],
  refresh: ['M13.2 8.6A5.25 5.25 0 1 1 11.8 4.4', 'M13.25 2.75v3h-3'],
  chevronRight: ['M6.25 4.5L9.75 8l-3.5 3.5'],
  arrowRight: ['M3.25 8h9.25', 'M8.75 4.25L12.5 8l-3.75 3.75'],
  clock: [circle(8, 8, 5.75), 'M8 5.25V8l1.9 1.2'],
  terminal: ['M3.25 4.75L6.5 8l-3.25 3.25', 'M8.5 11.25h4.25'],
  lock: [rect(3.25, 7.25, 9.5, 6.5, 1.5), 'M5.25 7.25v-1.5a2.75 2.75 0 0 1 5.5 0v1.5'],
  keyboard: [
    rect(1.75, 3.75, 12.5, 8.5, 1.75),
    'M4.75 6.75h.01',
    'M7.25 6.75h.01',
    'M9.75 6.75h.01',
    'M11.25 6.75h.01',
    'M5.25 9.25h5.5',
  ],
  globe: [
    circle(8, 8, 5.75),
    'M2.25 8h11.5',
    'M8 2.25c1.55 1.6 2.35 3.5 2.35 5.75S9.55 12.15 8 13.75C6.45 12.15 5.65 10.25 5.65 8S6.45 3.85 8 2.25z',
  ],
  gauge: ['M2.75 11.75a5.25 5.25 0 1 1 10.5 0', 'M8 11.75l2.4-3.1'],
  upload: ['M8 10.5V3', 'M4.75 6.25L8 3l3.25 3.25', 'M2.75 13.25h10.5'],
  x: ['M4.5 4.5l7 7', 'M11.5 4.5l-7 7'],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof icons;
</script>

<script setup lang="ts">
withDefaults(defineProps<{ name: IconName; size?: number; stroke?: number }>(), { size: 16, stroke: 1.5 });
</script>

<template>
  <svg
    class="sn-icon"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(d, i) in icons[name]" :key="i" :d="d" />
  </svg>
</template>

<style>
.sn-icon {
  display: block;
  flex: none;
}
</style>
