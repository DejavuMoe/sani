<script lang="ts">
  import { t, type MessageKey } from '../lib/i18n.svelte';
  import { isMac, mod } from '../lib/keys';
  import { ui } from '../lib/ui.svelte';
  import Dialog from './Dialog.svelte';

  const rows: [string[], MessageKey][] = [
    [['N'], 'keys.new'],
    [[mod, 'V'], 'keys.paste'],
    [['/'], 'keys.search'],
    [['J', 'K'], 'keys.move'],
    [['↵'], 'keys.toggle'],
    [['C'], 'keys.copy'],
    [['E'], 'keys.edit'],
    [[mod, '↵'], 'keys.save'],
    [isMac ? ['⌘', '⌫'] : ['Del'], 'keys.delete'],
    [['X'], 'keys.pick'],
    [['Esc'], 'keys.escape'],
    [['?'], 'keys.help'],
  ];
</script>

<Dialog bind:open={ui.shortcuts} title={t('keys.title')} width={400}>
  <dl class="keys">
    {#each rows as [keys, label] (label)}
      <div>
        <dt>{t(label)}</dt>
        <dd>
          {#each keys as k, i (i)}
            {#if i > 0 && label === 'keys.move'}<span class="or">/</span>{/if}
            <kbd>{k}</kbd>
          {/each}
        </dd>
      </div>
    {/each}
  </dl>
</Dialog>

<style>
  .keys {
    display: grid;
    margin: 0;
  }

  .keys div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 0;
    border-top: 1px solid var(--line);
  }

  .keys div:first-child {
    border-top: 0;
  }

  dt {
    color: var(--text-2);
    font-size: 13px;
  }

  dd {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0;
  }

  kbd {
    min-width: 22px;
    height: 22px;
    font-size: 11.5px;
  }

  .or {
    color: var(--text-4);
    font-size: 12px;
  }
</style>
