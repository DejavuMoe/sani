<script lang="ts">
  import { expiryLabel, presets, presetLabel, toLocalInput, type Expiry } from '../lib/expiry';
  import { t } from '../lib/i18n.svelte';
  import DateEditor from './DateEditor.svelte';
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import MenuItem from './MenuItem.svelte';

  let {
    value = $bindable<Expiry>({ preset: 'never' }),
    triggerClass = 'picker',
    showLabel = true,
    id,
  }: { value?: Expiry; triggerClass?: string; showLabel?: boolean; id?: string } = $props();

  const custom = $derived('at' in value);

  function pickCustom() {
    const tomorrow = new Date(Date.now() + 24 * 3_600_000);
    tomorrow.setMinutes(0, 0, 0);
    value = { at: 'at' in value ? value.at : toLocalInput(tomorrow) };

  }
</script>

<span class="expiry">
  <Menu triggerClass={triggerClass} label={t('composer.expiry')} minWidth={176}>
    {#snippet button()}
      {#if showLabel}<span class="k">{t('composer.expiry')}</span>{/if}
      <span class="v">{custom ? t('expiry.custom').replace('…', '') : expiryLabel(value)}</span>
      <Icon name="chevronDown" size={14} class="chev" />
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
  {#if 'at' in value}
    <DateEditor value={value.at} onchange={at => value = { at }} {id} />
  {/if}
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
    height: 1px;
    margin: 4px 6px;
    background: var(--line);
  }

  .expiry:has(:global(.date-editor)) { flex-direction: column; align-items: flex-start; width: min(280px, 100%); }
</style>
