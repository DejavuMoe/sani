<script lang="ts">
  import { onDestroy } from 'svelte';
  import AuthShell from '../components/AuthShell.svelte';
  import Button from '../components/Button.svelte';
  import { api, ApiError } from '../lib/api';
  import { errorText, t } from '../lib/i18n.svelte';
  import { session } from '../lib/session.svelte';

  let password = $state('');
  let busy = $state(false);
  let error = $state('');
  let wait = $state(0);
  let shake = $state(false);
  let field = $state<HTMLInputElement>();
  let timer: ReturnType<typeof setInterval> | undefined;

  onDestroy(() => clearInterval(timer));

  function countdown(seconds: number) {
    wait = seconds;
    clearInterval(timer);
    timer = setInterval(() => {
      wait -= 1;
      if (wait <= 0) {
        clearInterval(timer);
        error = '';
      } else {
        error = t('auth.rateLimited', { s: wait });
      }
    }, 1000);
    error = t('auth.rateLimited', { s: wait });
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy || wait > 0 || !password) return;
    busy = true;
    error = '';
    try {
      await api.login(password);
      await session.enter();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'unknown';
      if (code === 'rate_limited' && err instanceof ApiError) countdown(err.retryAfter ?? 60);
      else error = code === 'wrong_password' ? t('auth.wrong') : errorText(code);
      shake = true;
      field?.select();
    } finally {
      busy = false;
    }
  }
</script>

<AuthShell>
  <form novalidate class="form" onsubmit={submit}>
    <h1 class="sr-only">Sani</h1>
    {#if session.expired}<p class="notice">{t('auth.expired')}</p>{/if}
    <!-- Lets password managers file the credential under a stable name. -->
    <input class="sr-only" type="text" name="username" autocomplete="username" value="sani" readonly tabindex="-1" aria-hidden="true" />
    <label class="label" for="password">{t('auth.password')}</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      bind:this={field}
      bind:value={password}
      id="password"
      name="password"
      class={['field', shake && 'shake']}
      type="password"
      autocomplete="current-password"
      autofocus
      aria-invalid={!!error || undefined}
      aria-describedby={error ? 'login-error' : undefined}
      onanimationend={() => (shake = false)}
    />
    {#if error}<p class="error-text" id="login-error" role="alert">{error}</p>{/if}
    <Button type="submit" variant="primary" size="lg" loading={busy} disabled={wait > 0}>
      {busy ? t('auth.signingIn') : t('auth.signIn')}
    </Button>
  </form>
</AuthShell>

<style>
  .form {
    display: flex;
    flex-direction: column;
    margin-top: 32px;
  }

  .notice {
    margin-bottom: 18px;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 13px;
  }

  .field {
    height: 40px;
    font-size: 15px;
  }

  .form :global(.btn) {
    margin-top: 16px;
  }

  .shake {
    animation: shake 360ms var(--ease);
  }

  @keyframes shake {
    20% {
      transform: translateX(-5px);
    }
    40% {
      transform: translateX(4px);
    }
    60% {
      transform: translateX(-3px);
    }
    80% {
      transform: translateX(2px);
    }
  }
</style>
