<script lang="ts">
  /*
   * A small form in the browser's top layer, like Menu but with
   * role="dialog": it holds a field, so focus goes to the field, Enter
   * confirms and Escape or an outside click closes it.
   */
  import type { Snippet } from 'svelte';
  import { onDestroy, tick } from 'svelte';

  let {
    trigger,
    children,
    label,
    triggerClass = '',
    width = 288,
    onopen,
  }: {
    trigger: Snippet;
    children: Snippet<[() => void]>;
    label: string;
    triggerClass?: string;
    width?: number;
    onopen?: () => void;
  } = $props();

  const id = `pop-${Math.random().toString(36).slice(2, 9)}`;
  let button = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();
  let open = $state(false);

  function place() {
    if (!button || !pop) return;
    const r = button.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.max(8, top)}px`;
  }

  function close() {
    pop?.hidePopover();
  }

  const reposition = () => place();
  const stopReposition = () => {
    removeEventListener('resize', reposition);
    removeEventListener('scroll', reposition, true);
  };
  onDestroy(stopReposition);

  async function ontoggle(e: Event) {
    open = (e as ToggleEvent).newState === 'open';
    if (open) {
      onopen?.();
      addEventListener('resize', reposition);
      addEventListener('scroll', reposition, true);
      // The content mounts with `open`; measure and focus after it renders.
      await tick();
      if (!open || !pop?.isConnected) return;
      place();
      pop.querySelector('input')?.select();
    } else {
      stopReposition();
      if (pop?.contains(document.activeElement) || document.activeElement === document.body) button?.focus();
    }
  }
</script>

<button bind:this={button} type="button" class={triggerClass} popovertarget={id} aria-haspopup="dialog" aria-expanded={open}>
  {@render trigger()}
</button>

<div bind:this={pop} {id} popover="auto" role="dialog" aria-label={label} class="pop" style:width="{width}px" {ontoggle}>
  {#if open}{@render children(close)}{/if}
</div>

<style>
  /* 12px outside, 4px inset: fields and buttons inside use 8px. */
  .pop {
    position: fixed;
    inset: auto;
    margin: 0;
    padding: 4px;
    max-width: calc(100vw - 16px);
    border: 0; --hbt: var(--line-2); --hbr: var(--line-2); --hbb: var(--line-2); --hbl: var(--line-2);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--hair-shadow), var(--shadow-pop);
    opacity: 1;
    transform: none;
    transition:
      opacity var(--normal) var(--ease),
      transform var(--normal) var(--ease),
      overlay var(--normal) allow-discrete,
      display var(--normal) allow-discrete;
  }

  .pop:not(:popover-open) {
    opacity: 0;
    transform: translateY(-4px);
  }

  @starting-style {
    .pop:popover-open {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  :global([data-theme='dark']) .pop {
    background: var(--surface-2);
  }
</style>
