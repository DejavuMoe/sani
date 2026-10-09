<script lang="ts">
  import { tooltip } from '../lib/tooltip';
  import { t } from '../lib/i18n.svelte';
  import { prefs } from '../lib/prefs.svelte';
  import { router } from '../lib/router.svelte';
  import { ui } from '../lib/ui.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import Logo from './Logo.svelte';

  const themeIcon: Record<string, IconName> = { system: 'monitor', light: 'sun', dark: 'moon' };
  const themeName = $derived(t(`theme.${prefs.theme}`));

  let scrolled = $state(false);
</script>

<svelte:window onscroll={() => (scrolled = scrollY > 4)} />

<header class={['top', scrolled && 'scrolled']}>
  <div class="inner">
    <a class="brand" href="/admin/" onclick={router.link}>
      <Logo />
    </a>
    <nav class="tools" aria-label={t('menu.label')}>
      <button class="tool hide-touch" use:tooltip={`${t('menu.shortcuts')} (?)`} aria-label={t('menu.shortcuts')} onclick={() => (ui.shortcuts = true)}>
        <Icon name="keyboard" />
      </button>
      <button
        class="tool"
        use:tooltip={`${t('menu.theme')}: ${themeName}`}
        aria-label="{t('menu.theme')}: {themeName}"
        onclick={() => prefs.cycleTheme()}
      >
        <Icon name={themeIcon[prefs.theme]} />
      </button>
      <a
        class={['tool', router.current.name === 'settings' && 'on']}
        href="/admin/settings"
        onclick={router.link}
        use:tooltip={t('menu.settings')}
        aria-label={t('menu.settings')}
        aria-current={router.current.name === 'settings' ? 'page' : undefined}
      >
        <Icon name="sliders" />
      </a>
    </nav>
  </div>
</header>

<style>
  .top {
    position: sticky;
    z-index: 20;
    top: 0;
    background: var(--bg);
    box-shadow: 0 1px 0 transparent;
    transition: box-shadow var(--normal) var(--ease);
  }

  .top.scrolled {
    box-shadow: 0 1px 0 var(--line);
  }

  .inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: min(100%, calc(var(--page) + 2 * var(--gutter)));
    height: 56px;
    margin: 0 auto;
    padding: 0 var(--gutter);
  }

  .brand {
    display: inline-flex;
    margin-left: -4px;
    padding: 4px;
    border-radius: var(--radius);
  }

  .tools {
    display: flex;
    gap: 2px;
    margin-right: -6px;
  }

  .tool {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border-radius: var(--radius);
    color: var(--text-3);
    transition:
      background-color var(--fast) var(--ease),
      color var(--fast) var(--ease);
  }

  .tool:hover,
  .tool.on {
    background: var(--surface-2);
    color: var(--text);
  }

  @media (hover: none) {
    .hide-touch {
      display: none;
    }
  }
</style>
