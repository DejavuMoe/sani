<script lang="ts">
  import { tick } from 'svelte';
  import { expiryLabel, presets, presetLabel, toLocalInput, type Expiry } from '../lib/expiry';
  import { t } from '../lib/i18n.svelte';
  import DateEditor from './DateEditor.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import Menu from './Menu.svelte';
  import MenuItem from './MenuItem.svelte';

  let {
    value = $bindable<Expiry>({ preset: 'never' }),
    triggerClass = 'picker',
    showLabel = true,
    icon,
    id,
  }: { value?: Expiry; triggerClass?: string; showLabel?: boolean; icon?: IconName; id?: string } = $props();

  const custom = $derived('at' in value);
  let host: HTMLSpanElement;
  let pop: HTMLDivElement;
  let draft = $state<string | null>(null);

  async function pickCustom() {
    const tomorrow = new Date(Date.now() + 24 * 3_600_000);
    tomorrow.setMinutes(0, 0, 0);
    draft = 'at' in value ? value.at : toLocalInput(tomorrow);
    await tick();
    pop.showPopover();
    place();
    pop.querySelector('input')?.focus();
  }

  function place() {
    const trigger = host.querySelector('button');
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`;
    pop.style.top = `${Math.max(8, Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 8))}px`;
  }

  $effect(() => {
    if (draft === null) return;
    const observer = new ResizeObserver(place);
    observer.observe(pop);
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      removeEventListener('resize', place);
      removeEventListener('scroll', place, true);
    };
  });

  function close() { pop.hidePopover(); }
  function ontoggle(e: Event) {
    if ((e as ToggleEvent).newState !== 'closed') return;
    if (pop.contains(document.activeElement) || document.activeElement === document.body) host.querySelector('button')?.focus();
    draft = null;
  }
</script>

<span class="expiry" bind:this={host}>
  <Menu triggerClass={triggerClass} label={t('composer.expiry')} minWidth={176}>
    {#snippet button()}
      {#if icon}<Icon name={icon} size={14} />{/if}
      {#if showLabel}<span class="k">{t('composer.expiry')}</span>{/if}
      <span class="v">{expiryLabel(value)}</span>
      {#if !icon}<Icon name="chevronDown" size={14} class="chev" />{/if}
    {/snippet}
    {#snippet children(close)}
      {#each presets as p (p)}
        <MenuItem
          checked={'preset' in value && value.preset === p}
          onclick={() => {
            value = { preset: p };
            close();
          }}>{presetLabel(p)}</MenuItem
        >
      {/each}
      <div class="sep" role="separator"></div>
      <MenuItem
        checked={custom}
        onclick={() => {
          close();
          pickCustom();
        }}>{t('expiry.custom')}</MenuItem
      >
    {/snippet}
  </Menu>
  <div bind:this={pop} popover="auto" role="dialog" aria-label={t('expiry.custom').replace('…', '')} class="expiry-pop" {ontoggle}>
    {#if draft !== null}
      <DateEditor value={draft} onchange={at => { value = { at }; close(); }} oncancel={close} {id} />
    {/if}
  </div>
</span>

<style>
  .expiry {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .sep {
    height: 0.5px;
    margin: 4px 6px;
    background: var(--line);
  }

  .v { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .expiry-pop {
    position: fixed; inset: auto; margin: 0; padding: 4px; width: 304px;
    max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px);
    overflow: auto; overscroll-behavior: contain;
    border: 0; --hbt: var(--line-2); --hbr: var(--line-2); --hbb: var(--line-2); --hbl: var(--line-2);
    border-radius: var(--radius-lg); background: var(--surface); color: var(--text);
    box-shadow: var(--hair-shadow), var(--shadow-pop);
    transition: opacity var(--normal) var(--ease), transform var(--normal) var(--ease), overlay var(--normal) allow-discrete, display var(--normal) allow-discrete;
  }
  .expiry-pop:not(:popover-open) { opacity: 0; transform: translateY(-4px); }
  @starting-style { .expiry-pop:popover-open { opacity: 0; transform: translateY(-4px); } }
  :global([data-theme='dark']) .expiry-pop { background: var(--surface-2); }
</style>
