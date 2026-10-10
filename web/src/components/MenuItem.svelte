<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon, { type IconName } from './Icon.svelte';

  let {
    icon,
    checked,
    hint,
    danger = false,
    onclick,
    children,
  }: {
    icon?: IconName;
    /** Set for choices in a group; renders a check when true. */
    checked?: boolean;
    hint?: string;
    danger?: boolean;
    onclick: () => void;
    children: Snippet;
  } = $props();
</script>

<button
  type="button"
  class={['item', danger && 'danger']}
  role={checked === undefined ? 'menuitem' : 'menuitemradio'}
  aria-checked={checked}
  tabindex="-1"
  {onclick}
>
  {#if icon}<Icon name={icon} class="lead" />{/if}
  <span class="label">{@render children()}</span>
  {#if hint}<span class="hint">{hint}</span>{/if}
  {#if checked !== undefined}
    <span class="check" aria-hidden="true">{#if checked}<Icon name="check" stroke={2} />{/if}</span>
  {/if}
</button>

<style>
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: var(--control-option);
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 13px;
    text-align: left;
    white-space: normal;
    line-height: 1.4;
  }

  .item:hover,
  .item:focus-visible {
    background: var(--surface-2);
  }
  .item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

  :global([data-theme='dark']) .item:hover,
  :global([data-theme='dark']) .item:focus-visible {
    background: var(--surface-3);
  }

  .item :global(.lead) {
    color: var(--text-3);
  }

  .label {
    flex: 1;
    margin: 0;
    font-weight: 400;
  }

  .hint {
    margin: 0;
    color: var(--text-3);
    font-size: 12px;
  }

  .check {
    display: grid;
    width: 16px;
    place-items: center;
    color: var(--text);
  }

  .danger,
  .danger :global(.lead) {
    color: var(--danger);
  }
</style>
