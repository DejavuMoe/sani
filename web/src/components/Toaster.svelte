<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, fly } from 'svelte/transition';
  import { t } from '../lib/i18n.svelte';
  import { toasts } from '../lib/toast.svelte';
  import Icon from './Icon.svelte';
</script>

<div class="toaster" role="status" aria-live="polite">
  {#each toasts.items as toast (toast.id)}
    <div
      class={['toast', toast.tone]}
      role="presentation"
      animate:flip={{ duration: 220 }}
      in:fly={{ y: 14, duration: 240, opacity: 0 }}
      out:fade={{ duration: 140 }}
      onpointerenter={() => toasts.pause(toast.id)}
      onpointerleave={() => toasts.resume(toast.id)}
    >
      {#if toast.tone === 'success'}
        <Icon name="check" class="tone" stroke={2} />
      {:else if toast.tone === 'error'}
        <Icon name="alert" class="tone" />
      {/if}
      <span class="msg">
        {toast.message}
        {#if toast.detail}<span class="detail">{toast.detail}</span>{/if}
      </span>
      {#if toast.action}
        {@const action = toast.action}
        <button
          class="action"
          onclick={() => {
            toasts.dismiss(toast.id);
            action.run();
          }}>{action.label}</button
        >
      {/if}
      <button class="dismiss" aria-label={t('act.close')} onclick={() => toasts.dismiss(toast.id)}>
        <Icon name="x" size={14} />
      </button>
    </div>
  {/each}
</div>

<style>
  .toaster {
    position: fixed;
    z-index: 50;
    right: 0;
    bottom: max(20px, env(safe-area-inset-bottom));
    left: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(520px, 100%);
    min-height: 40px;
    padding: 6px 6px 6px 14px;
    border-radius: 10px;
    background: var(--toast);
    color: var(--on-toast);
    font-size: 13px;
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.12),
      0 10px 30px -8px rgb(0 0 0 / 0.35);
    pointer-events: auto;
  }

  :global([data-theme='dark']) .toast {
    box-shadow:
      0 0 0 1px var(--line-2),
      0 12px 30px -8px rgb(0 0 0 / 0.7);
  }

  .toast :global(.tone) {
    margin-left: -2px;
  }

  .success :global(.tone) {
    color: #6fd39b;
  }

  .error :global(.tone) {
    color: #ff8a7a;
  }

  .msg {
    display: flex;
    flex: 1;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    padding: 4px 0;
    line-height: 1.4;
  }

  .detail {
    overflow: hidden;
    color: color-mix(in oklab, var(--on-toast) 62%, transparent);
    font-family: var(--font-mono);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .action {
    height: 28px;
    padding: 0 10px;
    border-radius: 6px;
    color: var(--on-toast);
    font-weight: 600;
    background: rgb(255 255 255 / 0.1);
    white-space: nowrap;
  }

  .action:hover {
    background: rgb(255 255 255 / 0.18);
  }

  .dismiss {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border-radius: 6px;
    color: color-mix(in oklab, var(--on-toast) 55%, transparent);
  }

  .dismiss:hover {
    color: var(--on-toast);
    background: rgb(255 255 255 / 0.08);
  }
</style>
