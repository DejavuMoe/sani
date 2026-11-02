<script lang="ts">
  import { expiryLabel, presets, presetLabel, toLocalInput, type Expiry } from '../lib/expiry';
  import { t } from '../lib/i18n.svelte';
  import AccessPopover from './AccessPopover.svelte';
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
  let pop: AccessPopover;
  // The editor works on a copy; only Apply writes it back to `value`.
  let draft = $state('');

  function pickCustom() {
    const tomorrow = new Date(Date.now() + 24 * 3_600_000);
    tomorrow.setMinutes(0, 0, 0);
    draft = 'at' in value ? value.at : toLocalInput(tomorrow);
    pop.show();
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
  <AccessPopover bind:this={pop} anchor={() => host.querySelector('button')} label={t('expiry.custom').replace('…', '')} popClass="expiry-pop" width={304}>
    {#snippet children(close)}
      <DateEditor value={draft} onchange={at => { value = { at }; close(); }} oncancel={close} {id} />
    {/snippet}
  </AccessPopover>
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
</style>
