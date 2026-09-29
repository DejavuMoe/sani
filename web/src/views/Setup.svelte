<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import AuthShell from '../components/AuthShell.svelte';
  import Button from '../components/Button.svelte';
  import { api, ApiError } from '../lib/api';
  import { errorText, t } from '../lib/i18n.svelte';
  import { session } from '../lib/session.svelte';

  // The startup log can print a link carrying the code in the fragment,
  // which never reaches a server. Take it, then drop it from the address bar.
  function codeFromHash() {
    const found = new URLSearchParams(location.hash.slice(1)).get('setup') ?? '';
    if (found) history.replaceState(history.state, '', location.pathname + location.search);
    return found;
  }

  let code = $state(codeFromHash());
  let password = $state('');
  let confirm = $state('');
  let busy = $state(false);
  let wait = $state(0);
  let error = $state<{ field: 'code' | 'password' | 'confirm' | 'other'; text: string } | null>(null);
  let codeField = $state<HTMLInputElement>();
  let passwordField = $state<HTMLInputElement>();
  let timer: ReturnType<typeof setInterval> | undefined;

  onMount(() => (code ? passwordField : codeField)?.focus());
  onDestroy(() => clearInterval(timer));

  function countdown(seconds: number) {
    wait = seconds;
    const show = () => (error = wait > 0 ? { field: 'other', text: t('auth.rateLimited', { s: wait }) } : null);
    clearInterval(timer);
    timer = setInterval(() => {
      wait -= 1;
      if (wait <= 0) clearInterval(timer);
      show();
    }, 1000);
    show();
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy || wait > 0) return;
    if (!code.trim()) return void (error = { field: 'code', text: t('setup.codeMissing') });
    if ([...password].length < 8) return void (error = { field: 'password', text: t('setup.short') });
    if (password !== confirm) return void (error = { field: 'confirm', text: t('setup.mismatch') });
    busy = true;
    error = null;
    try {
      await api.setup(password, code);
      await session.enter();
    } catch (err) {
      const c = err instanceof ApiError ? err.code : 'unknown';
      if (c === 'already_setup') session.state = 'login';
      else if (c === 'rate_limited' && err instanceof ApiError) countdown(err.retryAfter ?? 60);
      else if (c === 'setup_code') {
        error = { field: 'code', text: t('err.setup_code') };
        codeField?.select();
      } else error = { field: 'other', text: errorText(c) };
    } finally {
      busy = false;
    }
  }

  const hint = $derived(t('setup.codeHint').split(/(\{cmd\})/));
</script>

<AuthShell>
  <form class="form" onsubmit={submit} novalidate>
    <h1>{t('setup.title')}</h1>
    <p class="lead">{t('setup.lead')}</p>
    <input class="sr-only" type="text" name="username" autocomplete="username" value="sani" readonly tabindex="-1" aria-hidden="true" />

    <label class="label" for="setup-code">{t('setup.code')}</label>
    <input
      id="setup-code"
      class="field mono code"
      type="text"
      autocomplete="off"
      autocapitalize="none"
      spellcheck="false"
      maxlength="64"
      bind:this={codeField}
      bind:value={code}
      aria-invalid={error?.field === 'code' || undefined}
      aria-describedby="code-hint"
    />
    {#if error?.field === 'code'}
      <p class="error-text" id="code-hint" role="alert">{error.text}</p>
    {:else}
      <p class="hint" id="code-hint">
        {#each hint as part, i (i)}{#if part === '{cmd}'}<code>docker logs sani</code>{:else}{part}{/if}{/each}
      </p>
    {/if}

    <label class="label second" for="new-password">{t('setup.password')}</label>
    <input
      id="new-password"
      class="field"
      type="password"
      autocomplete="new-password"
      bind:this={passwordField}
      bind:value={password}
      aria-invalid={error?.field === 'password' || undefined}
      aria-describedby="password-hint"
    />
    {#if error?.field === 'password'}
      <p class="error-text" id="password-hint" role="alert">{error.text}</p>
    {:else}
      <p class="hint" id="password-hint">{t('setup.short')}</p>
    {/if}

    <label class="label second" for="confirm-password">{t('setup.confirm')}</label>
    <input
      id="confirm-password"
      class="field"
      type="password"
      autocomplete="new-password"
      bind:value={confirm}
      aria-invalid={error?.field === 'confirm' || undefined}
    />
    {#if error?.field === 'confirm' || error?.field === 'other'}
      <p class="error-text" role="alert">{error.text}</p>
    {/if}

    <Button type="submit" variant="primary" size="lg" loading={busy} disabled={wait > 0}>{t('setup.submit')}</Button>
  </form>
</AuthShell>

<style>
  .form {
    display: flex;
    flex-direction: column;
    margin-top: 28px;
  }

  h1 {
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .lead {
    margin: 6px 0 24px;
    color: var(--text-2);
    font-size: 13.5px;
    line-height: 1.6;
  }

  .field {
    height: 40px;
    font-size: 15px;
  }

  .code {
    letter-spacing: 0.04em;
  }

  .hint code {
    padding: 1px 5px;
    border-radius: var(--radius-xs);
    background: var(--surface-2);
    color: var(--text-2);
    font: 11.5px var(--font-mono);
    white-space: nowrap;
  }

  .second {
    margin-top: 16px;
  }

  .form :global(.btn) {
    margin-top: 20px;
  }
</style>
