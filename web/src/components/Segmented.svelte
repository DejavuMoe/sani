<script lang="ts" generics="T extends string | number">
  import Icon, { type IconName } from './Icon.svelte';

  let {
    value,
    options,
    onchange,
    label,
    size = 'md',
    disabled = false,
  }: {
    value: T;
    options: { value: T; label: string; icon?: IconName }[];
    onchange: (v: T) => void;
    label: string;
    /** `lg` matches the text fields of a form. */
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
  } = $props();

  let root = $state<HTMLDivElement>();

  function onkeydown(e: KeyboardEvent) {
    if (disabled) return;
    const i = options.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % options.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + options.length) % options.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = options.length - 1;
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
      {disabled}
      role="radio"
      aria-checked={o.value === value}
      tabindex={o.value === value || !options.some(x => x.value === value) && o === options[0] ? 0 : -1}
      onclick={() => onchange(o.value)}
    >
      {#if o.icon}<Icon name={o.icon} size={14} />{/if}
      {o.label}
    </button>
  {/each}
</div>

<style>
  .seg {
    --seg-height: var(--control-size);
    min-height: var(--seg-height);
    width: max-content;
    min-width: 0;
    max-width: 100%;
    flex-wrap: wrap;
    flex-shrink: 0;
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
    justify-content: center;
    line-height: 1.25;
    gap: 6px;
    height: calc(var(--seg-height) - 4px);
    min-height: max(calc(var(--seg-height) - 4px), calc(1lh + 4px));
    padding: 0 10px;
    border-radius: var(--radius-sm);
    color: var(--text-2);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    transition:
      background-color var(--fast) var(--ease),
      color var(--fast) var(--ease),
      box-shadow var(--fast) var(--ease);
  }

  .lg {
    --seg-height: var(--control-field);
  }

  button:hover {
    color: var(--text);
  }
  button:focus-visible { outline-offset: -2px; }
  button:disabled { color: var(--text-3); cursor: default; }
  @media (max-width: 640px), (pointer: coarse) { button { min-width: 44px; } }

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
