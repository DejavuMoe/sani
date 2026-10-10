<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  let { id, unit, value = $bindable(''), 'aria-describedby': describedBy, ...rest }:
    Omit<HTMLInputAttributes, 'value' | 'type'> & { id: string; unit: string; value?: string } = $props();
</script>

<div class="unit-input">
  <input {...rest} {id} class="field" type="text" inputmode="numeric" autocomplete="off" spellcheck="false"
    bind:value aria-describedby={[describedBy, `${id}-unit`].filter(Boolean).join(' ')} />
  <label for={id} id={`${id}-unit`}>{unit}</label>
</div>

<style>
  .unit-input { display: flex; align-items: center; gap: 7px; flex: none; }
  .field { width: var(--unit-width, 56px); flex: none; text-align: start; font-variant-numeric: tabular-nums; font-weight: 400; }
  label { min-width: 2.8em; color: var(--text-3); font-size: 12px; font-weight: 400; cursor: text; }
  @media (max-width: 640px), (pointer: coarse) {
    .unit-input { min-height: 44px; }
    .field { width: var(--unit-mobile-width, 54px); height: 36px; min-height: max(36px, calc(1lh + 8px)); }
    label { min-height: 44px; display: flex; align-items: center; }
  }
</style>
