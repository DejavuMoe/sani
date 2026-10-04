<script lang="ts">
  import Button from './components/Button.svelte';
  import ShortcutsDialog from './components/ShortcutsDialog.svelte';
  import Toaster from './components/Toaster.svelte';
  import { t } from './lib/i18n.svelte';
  import { router } from './lib/router.svelte';
  import { session } from './lib/session.svelte';
  import Dashboard from './views/Dashboard.svelte';
  import Login from './views/Login.svelte';
  import NewLink from './views/NewLink.svelte';
  import Settings from './views/Settings.svelte';
  import Setup from './views/Setup.svelte';

  session.boot();
</script>

{#if session.state === 'setup'}
  <Setup />
{:else if session.state === 'login'}
  <Login />
{:else if session.state === 'offline'}
  <main class="offline">
    <h1 class="message">{t('err.network')}</h1>
    <Button onclick={() => session.boot()}>{t('act.retry')}</Button>
  </main>
{:else if session.state === 'ready'}
  {#if router.current.name === 'settings'}
    <Settings />
  {:else if router.current.name === 'new'}
    <NewLink />
  {:else}
    <Dashboard />
  {/if}
  <ShortcutsDialog />
{/if}

<Toaster />

<style>
  .offline {
    display: grid;
    min-height: 100dvh;
    place-content: center;
    gap: 14px;
    color: var(--text-2);
    text-align: center;
  }

  .message {
    font-size: inherit;
    font-weight: inherit;
  }
</style>
