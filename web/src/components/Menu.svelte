<script lang="ts">
  /*
   * A menu in the browser's top layer (the Popover API): it is never clipped
   * by a scrolling parent, closes on outside click and Escape for free, and
   * the invoking button toggles it without racing the light dismiss.
   */
  import type { Snippet } from 'svelte';
  import { onDestroy, tick } from 'svelte';

  let {
    button,
    children,
    label,
    triggerClass = '',
    align = 'start',
    minWidth = 180,
    disabled = false,
  }: {
    button: Snippet<[boolean]>;
    children: Snippet<[() => void]>;
    label?: string;
    triggerClass?: string;
    align?: 'start' | 'end';
    minWidth?: number;
    disabled?: boolean;
  } = $props();

  const id = `menu-${Math.random().toString(36).slice(2, 9)}`;
  let trigger = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();
  let open = $state(false);

  function place() {
    if (!trigger || !pop) return;
    const r = trigger.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.max(8, Math.min(top, innerHeight - h - 8))}px`;
  }

  function items(): HTMLElement[] {
    return pop ? [...pop.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])')] : [];
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
      place();
      addEventListener('resize', reposition);
      addEventListener('scroll', reposition, true);
      await tick();
      if (!open || !pop?.isConnected) return;
      const list = items();
      (list.find((el) => el.getAttribute('aria-checked') === 'true') ?? list[0])?.focus();
    } else {
      stopReposition();
      if (pop?.contains(document.activeElement) || document.activeElement === document.body) trigger?.focus();
    }
  }

  function onkeydown(e: KeyboardEvent) {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'Tab') close();
    if (next >= 0) {
      e.preventDefault();
      list[next]?.focus();
    }
  }
</script>

<button
  bind:this={trigger}
  type="button"
  class={triggerClass}
  popovertarget={id}
  aria-haspopup="menu"
  aria-expanded={open}
  aria-label={label}
  {disabled}
>
  {@render button(open)}
</button>

<div bind:this={pop} {id} popover="auto" role="menu" tabindex="-1" class="menu" style:min-width="{minWidth}px" {ontoggle} {onkeydown}>
  {@render children(close)}
</div>

<style>
  .menu {
    position: fixed;
    inset: auto;
    margin: 0;
    padding: 4px;
    max-width: calc(100vw - 16px);
    max-height: calc(100dvh - 16px);
    overflow: auto;
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

  .menu:not(:popover-open) {
    opacity: 0;
    transform: translateY(-3px);
  }

  @starting-style {
    .menu:popover-open {
      opacity: 0;
      transform: translateY(-3px);
    }
  }

  :global([data-theme='dark']) .menu {
    background: var(--surface-2);
    border-color: var(--line-2);
  }
</style>
