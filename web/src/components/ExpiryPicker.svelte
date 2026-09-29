<script lang="ts">
  import { expiryLabel, presets, presetLabel, toLocalInput, type Expiry } from '../lib/expiry';
  import { t } from '../lib/i18n.svelte';
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import MenuItem from './MenuItem.svelte';

  let {
    value = $bindable<Expiry>({ preset: 'never' }),
    triggerClass = 'picker',
    showLabel = true,
    id,
  }: { value?: Expiry; triggerClass?: string; showLabel?: boolean; id?: string } = $props();

  let input = $state<HTMLInputElement>();
  const custom = $derived('at' in value);
  const minLocal = toLocalInput(new Date(Date.now() + 60_000));

  function pickCustom() {
    const tomorrow = new Date(Date.now() + 24 * 3_600_000);
    tomorrow.setMinutes(0, 0, 0);
    value = { at: 'at' in value ? value.at : toLocalInput(tomorrow) };
    // Open the native picker once the input exists.
    requestAnimationFrame(() => {
      input?.focus();
      try {
        input?.showPicker();
      } catch {
        /* not supported or not allowed; the focused field still works */
      }
    });
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
    <input
      bind:this={input}
      {id}
      class="when"
      type="datetime-local"
      min={minLocal}
      value={value.at}
      aria-label={t('expiry.custom')}
      onchange={(e) => (value = { at: e.currentTarget.value })}
    />
  {/if}
</span>

<style>
  .expiry {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--line);
  }

  .when {
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }

  .when:focus {
    outline: none;
    border-color: var(--accent);
  }
</style>
