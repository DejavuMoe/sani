<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n.svelte';
  import Icon from './Icon.svelte';

  let {
    open = $bindable(false),
    title,
    width = 440,
    children,
    dismissible = true,
    onclose,
  }: { open?: boolean; title: string; width?: number; children: Snippet; dismissible?: boolean; onclose?: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class="dialog"
  style:width="min({width}px, calc(100vw - 32px))"
  aria-label={title}
  onclose={() => { open = false; onclose?.(); }}
  oncancel={(e) => { if (!dismissible) e.preventDefault(); }}
  onclick={(e) => {
    // A click on the backdrop lands on the dialog element itself.
    if (e.target === dialog && dismissible) open = false;
  }}
>
  <!-- svelte-ignore a11y_autofocus -->
  <div class="inner" tabindex="-1" autofocus>
    <header>
      <h2>{title}</h2>
      <button class="close dialog-close" disabled={!dismissible} aria-label={t('act.close')} onclick={() => (open = false)}><Icon name="x" /></button>
    </header>
    {@render children()}
  </div>
</dialog>

<style>
  .dialog {
    max-height: calc(100dvh - 48px);
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-pop);
    opacity: 1;
    transform: none;
    transition:
      opacity 120ms var(--ease),
      transform 120ms var(--ease),
      overlay 120ms allow-discrete,
      display 120ms allow-discrete;
  }

  .dialog:not([open]) {
    opacity: 0;
    transform: translateY(6px) scale(0.99);
  }

  @starting-style {
    .dialog[open] {
      opacity: 0;
      transform: translateY(6px) scale(0.99);
    }
  }

  .dialog::backdrop {
    background: var(--scrim);
    opacity: 1;
    transition:
      opacity 120ms var(--ease),
      overlay 120ms allow-discrete,
      display 120ms allow-discrete;
  }

  .dialog:not([open])::backdrop {
    opacity: 0;
  }

  @starting-style {
    .dialog[open]::backdrop {
      opacity: 0;
    }
  }

  .inner {
    padding: 18px 20px 20px;
  }

  .inner:focus {
    outline: none;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: -4px -8px 14px 0;
  }

  h2 {
    font-size: 15px;
    font-weight: 600;
  }

  .close {
    display: grid;
    width: 30px;
    height: 30px;
    place-items: center;
    border-radius: var(--radius-sm);
    color: var(--text-3);
  }

  .close:hover {
    background: var(--surface-2);
    color: var(--text);
  }
</style>
