<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon, { type IconName } from './Icon.svelte';

  type Props = HTMLButtonAttributes & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
    size?: 'sm' | 'md' | 'lg';
    icon?: IconName;
    iconEnd?: IconName;
    loading?: boolean;
    children?: Snippet;
    el?: HTMLButtonElement;
  };

  let {
    variant = 'secondary',
    size = 'md',
    icon,
    iconEnd,
    loading = false,
    children,
    class: cls = '',
    type = 'button',
    disabled,
    el = $bindable(),
    ...rest
  }: Props = $props();

  const iconSize = $derived(size === 'sm' ? 14 : 16);
  let busyWidth = $state<number>();
  // Preserve the idle width even when a caller changes its label during a request.
  $effect.pre(() => { busyWidth = loading && el ? el.getBoundingClientRect().width : undefined; });
</script>

<button
  bind:this={el}
  {type}
  class={['btn', variant, size, !children && 'square', cls]}
  disabled={disabled || loading}
  aria-busy={loading || undefined}
  style:width={busyWidth === undefined ? undefined : `${busyWidth}px`}
  {...rest}
>
  {#if loading}
    <span class="spinner" style:width="{iconSize - 2}px" style:height="{iconSize - 2}px" aria-hidden="true"></span>
  {/if}
  {#if icon}
    <Icon name={icon} size={iconSize} />
  {/if}
  {#if children}<span class="text">{@render children()}</span>{/if}
  {#if iconEnd}<Icon name={iconEnd} size={iconSize} class="end" />{/if}
</button>

<style>
  .btn {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: max(var(--control-size), calc(1lh + 8px));
    max-width: 100%;
    padding: 3px 10px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    font-size: 13px;
    font-weight: 500;
    line-height: 1.5;
    white-space: normal;
    text-align: center;
    user-select: none;
    transition:
      background-color var(--fast) var(--ease),
      border-color var(--fast) var(--ease),
      color var(--fast) var(--ease),
      transform 80ms var(--ease);
  }

  .btn:active:not(:disabled) {
    transform: translateY(1px);
  }

  .btn:disabled {
    color: var(--text-3);
    background: var(--surface-2);
    border-color: var(--line);
  }

  .btn[aria-busy='true'] {
    cursor: progress;
  }
  .ghost:disabled, .danger:disabled { background: transparent; border-color: transparent; }
  .btn[aria-busy='true'] > .spinner { position: absolute; inset: 0; margin: auto; }
  .btn[aria-busy='true'] > .text, .btn[aria-busy='true'] :global(.icon) { opacity: 0; }
  .btn[aria-busy='true'] > .text { white-space: nowrap; }

  .text {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .primary {
    background: var(--ink);
    color: var(--on-ink);
  }

  .primary:hover:not(:disabled) {
    background: var(--ink-hover);
  }

  .accent {
    background: var(--accent);
    color: #fff;
  }

  :global([data-theme='dark']) .accent {
    color: #0d0f1c;
  }

  .accent:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .secondary {
    border-color: var(--line-2);
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 0 rgb(28 27 25 / 0.03);
  }

  .secondary:hover:not(:disabled) {
    background: var(--surface-2);
  }

  .ghost {
    color: var(--text-2);
  }

  .ghost:hover:not(:disabled),
  .ghost[aria-expanded='true'] {
    background: var(--surface-2);
    color: var(--text);
  }

  .danger {
    color: var(--danger);
  }

  .danger:hover:not(:disabled) {
    background: var(--danger-soft);
  }

  .lg { --control-size: var(--control-large); }
  .square { width: var(--control-size); min-width: var(--control-size); padding: 0; }

  .btn :global(.end) {
    margin-right: -3px;
    color: var(--text-3);
  }

  .spinner {
    border: 1.5px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
