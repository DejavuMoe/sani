<script lang="ts">
  import type { Snippet } from 'svelte';
  import { i18n, t } from '../lib/i18n.svelte';
  import { prefs } from '../lib/prefs.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import Logo from './Logo.svelte';

  let { children }: { children: Snippet } = $props();
  const themeIcon: Record<string, IconName> = { system: 'monitor', light: 'sun', dark: 'moon' };
</script>

<main class="shell">
  <div class="panel">
    <div class="brand">
      <Logo size={26} />
      <span class="host">{location.host}</span>
    </div>
    {@render children()}
  </div>
  <footer>
    <button onclick={() => i18n.set(i18n.lang === 'zh' ? 'en' : 'zh')}>{t('menu.language')}</button>
    <span class="dot" aria-hidden="true"></span>
    <button onclick={() => prefs.cycleTheme()} aria-label="{t('menu.theme')}: {t(`theme.${prefs.theme}`)}">
      <Icon name={themeIcon[prefs.theme]} size={14} />
      {t(`theme.${prefs.theme}`)}
    </button>
  </footer>
</main>

<style>
  .shell {
    display: grid;
    min-height: 100dvh;
    grid-template-rows: 1fr auto;
    padding: 24px;
  }

  .panel {
    display: flex;
    flex-direction: column;
    align-self: center;
    width: min(100%, 340px);
    margin: -6vh auto 0;
  }

  .brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .host {
    overflow: hidden;
    color: var(--text-3);
    font-family: var(--font-mono);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding-bottom: max(8px, env(safe-area-inset-bottom));
  }

  footer button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    color: var(--text-3);
    font-size: 12.5px;
  }

  footer button:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .dot {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--text-4);
  }
</style>
