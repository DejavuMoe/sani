<script lang="ts" generics="T extends string | number">
  import Icon, { type IconName } from './Icon.svelte';

  let {
    value,
    options,
    onchange,
    label,
    size = 'md',
  }: {
    value: T;
    options: { value: T; label: string; icon?: IconName }[];
    onchange: (v: T) => void;
    label: string;
    /** `lg` matches the 36px text fields of a form. */
    size?: 'sm' | 'md' | 'lg';
  } = $props();

  let root = $state<HTMLDivElement>();

  function onkeydown(e: KeyboardEvent) {
    const i = options.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % options.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + options.length) % options.length;
    if (next < 0) return;
    e.preventDefault();
    onchange(options[next].value);
    root?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  }
</script>

<div bind:this={root} class={['seg', size]} role="radiogroup" aria-label={label} tabindex="-1" {onkeydown}>
  {#each options as o (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={o.value === value}
      tabindex={o.value === value ? 0 : -1}
      onclick={() => onchange(o.value)}
    >
      {#if o.icon}<Icon name={o.icon} size={14} />{/if}
      {o.label}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--line);
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 11px;
    border-radius: 6px;
    color: var(--text-2);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    transition:
      background-color var(--fast) var(--ease),
      color var(--fast) var(--ease),
      box-shadow var(--fast) var(--ease);
  }

  .sm button {
    height: 24px;
    padding: 0 9px;
    font-size: 12.5px;
  }

  .lg button {
    height: 32px;
  }

  button:hover {
    color: var(--text);
  }

  button[aria-checked='true'] {
    background: var(--surface);
    color: var(--text);
    box-shadow:
      0 0 0 1px var(--line-2),
      0 1px 2px rgb(28 27 25 / 0.06);
  }

  :global([data-theme='dark']) button[aria-checked='true'] {
    background: var(--surface-3);
  }
</style>
