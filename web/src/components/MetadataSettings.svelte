<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { api, ApiError, type MetadataProxyInput } from '../lib/api';
  import { errorText, t } from '../lib/i18n.svelte';
  import { session } from '../lib/session.svelte';
  import Button from './Button.svelte';
  import Segmented from './Segmented.svelte';
  import Switch from './Switch.svelte';

  type Mode = 'direct' | 'http' | 'socks' | 'environment';
  const config = $derived(session.config);
  function initial() {
    const c = session.config, p = c?.metaProxy;
    return { enabled: c?.metaMode !== 'off', mode: (c?.metaMode === 'environment' ? 'environment' : c?.metaMode === 'proxy' || c?.metaMode === 'off' && p ? p?.scheme === 'socks5' ? 'socks' : 'http' : 'direct') as Mode,
      tls: p ? p.scheme === 'https' : true, host: p?.host ?? '', port: String(p?.port ?? 443), auth: p?.auth ?? false, username: p?.username ?? '', password: '', passwordStored: p?.passwordSet ?? false };
  }
  let draft = $state(untrack(initial)), saved = $state(untrack(initial));
  let editPassword = $state(!untrack(() => draft.passwordStored)), showPassword = $state(false);
  let status = $state<'idle' | 'saving' | 'saved' | 'testing' | 'passed' | 'failed'>('idle');
  let error = $state(''), hostError = $state(''), portError = $state(''), authError = $state('');
  let controller: AbortController | undefined;
  onDestroy(() => controller?.abort());
  const modeLocked = $derived(config?.configSources.metaMode === 'env');
  const proxyLocked = $derived(modeLocked || config?.configSources.metaProxy === 'env');
  const busy = $derived(status === 'saving' || status === 'testing');
  const proxy = $derived(draft.enabled && (draft.mode === 'http' || draft.mode === 'socks'));
  const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(saved));
  const scheme = $derived(draft.mode === 'socks' ? 'socks5' : draft.tls ? 'https' : 'http');
  const canKeepPassword = $derived(draft.passwordStored && config?.metaProxy?.scheme === scheme && config?.metaProxy?.host.toLowerCase() === draft.host.trim().toLowerCase() && config?.metaProxy?.port === +draft.port && config?.metaProxy?.username === draft.username.trim());
  function change(patch: Partial<typeof draft>) {
    draft = { ...draft, ...patch }; status = 'idle'; error = hostError = portError = authError = '';
  }
  function validate() {
    hostError = portError = authError = '';
    if (proxy && !proxyLocked) {
      if (!draft.host.trim() || /[\s/@?#]/.test(draft.host) || draft.host.includes('://')) hostError = t('metadata.hostInvalid');
      if (!/^\d+$/.test(draft.port) || +draft.port < 1 || +draft.port > 65535) portError = t('metadata.portInvalid');
      if (draft.auth && (!draft.username.trim() || !draft.password && !canKeepPassword)) authError = t('metadata.authInvalid');
    }
    return !hostError && !portError && !authError;
  }
  function proxyInput(): MetadataProxyInput {
    return { scheme, host: draft.host.trim(), port: +draft.port, auth: draft.auth, username: draft.username.trim(),
      ...(draft.password ? { password: draft.password } : !canKeepPassword ? { password: '' } : {}) };
  }
  async function save(e: SubmitEvent) {
    e.preventDefault(); if (!validate() || modeLocked) return;
    status = 'saving'; error = '';
    try {
      session.config = await api.setConfig({ metaMode: draft.enabled ? proxy ? 'proxy' : 'direct' : 'off', ...(proxy && !proxyLocked ? { metaProxy: proxyInput() } : {}) });
      draft = initial(); saved = initial(); editPassword = !draft.passwordStored; showPassword = false; status = 'saved';
    } catch (err) { error = errorText(err instanceof ApiError ? err.code : 'unknown'); status = 'idle'; }
  }
  async function test() {
    if (!validate()) return;
    controller?.abort(); controller = new AbortController(); status = 'testing'; error = '';
    try { await api.testMetadataProxy(proxyInput(), controller.signal); status = 'passed'; }
    catch (err) {
      if (controller.signal.aborted) return;
      error = errorText(err instanceof ApiError ? err.code : 'unknown'); status = 'failed';
    }
  }
</script>

<form class="metadata-form" novalidate onsubmit={save}>
  <div class="setting">
    <div><label for="metadata-enabled">{t('metadata.enabled')}</label><p class="hint">{t('metadata.hint')}</p></div>
    <Switch id="metadata-enabled" label={t('metadata.enabled')} checked={draft.enabled} disabled={modeLocked || busy} onchange={enabled => change({ enabled })} />
  </div>
  {#if proxyLocked}<p class="hint">{t('metadata.locked')}</p>{/if}
  {#if draft.enabled}
    <fieldset class="connection" disabled={busy}>
      <legend class="sr-only">{t('metadata.legend')}</legend>
      <div class="row route">
        <span class="k">{t('metadata.connection')}</span>
        <Segmented value={draft.mode} label={t('metadata.connection')} disabled={proxyLocked || busy} onchange={(mode: Mode) => change({ mode })}
          options={[{ value: 'direct', label: t('settings.metaDirect') }, { value: 'http', label: 'HTTP(S)' }, { value: 'socks', label: 'SOCKS5' }]} />
      </div>
      {#if draft.mode === 'environment'}<p class="hint">{t('settings.metaEnvironmentHint')}</p>{/if}
      {#if proxy}
        <div class="address">
          <div class="input"><label for="metadata-host">{t('metadata.host')}</label><input id="metadata-host" class="field" value={draft.host} disabled={proxyLocked} autocomplete="off" spellcheck="false" placeholder="proxy.example.com" aria-invalid={!!hostError || undefined} aria-describedby={hostError ? 'metadata-host-error' : undefined} oninput={e => change({ host: e.currentTarget.value })} /></div>
          <div class="input"><label for="metadata-port">{t('metadata.port')}</label><input id="metadata-port" class="field" value={draft.port} disabled={proxyLocked} inputmode="numeric" autocomplete="off" aria-invalid={!!portError || undefined} aria-describedby={portError ? 'metadata-port-error' : undefined} oninput={e => change({ port: e.currentTarget.value })} /></div>
        </div>
        {#if hostError}<p id="metadata-host-error" class="error-text" role="alert">{hostError}</p>{/if}
        {#if portError}<p id="metadata-port-error" class="error-text" role="alert">{portError}</p>{/if}
        <div class="row option">
          {#if draft.mode === 'http'}<label class="k" for="metadata-tls">{t('metadata.tls')}</label><Switch id="metadata-tls" label={t('metadata.tls')} checked={draft.tls} disabled={proxyLocked} onchange={tls => change({ tls })} />
          {:else}<span class="k">{t('metadata.encryption')}</span><span class="hint">{t('metadata.socksEncryption')}</span>{/if}
        </div>
        <div class="row option"><label class="k" for="metadata-auth">{t('metadata.auth')}</label><Switch id="metadata-auth" label={t('metadata.auth')} checked={draft.auth} disabled={proxyLocked} onchange={auth => change({ auth })} /></div>
        {#if draft.auth}
          <div class="auth-fields">
            <div class="input"><label for="metadata-user">{t('metadata.user')}</label><input id="metadata-user" class="field" value={draft.username} disabled={proxyLocked} maxlength="255" autocomplete="off" oninput={e => change({ username: e.currentTarget.value })} /></div>
            <div class="input">
              <label for={canKeepPassword && !editPassword ? undefined : 'metadata-password'}>{t('metadata.password')}</label>
              {#if canKeepPassword && !editPassword}
                <div class="secret stored"><span class="hint">{t('settings.saved')}</span><Button size="sm" disabled={proxyLocked} onclick={() => editPassword = true}>{t('metadata.replace')}</Button><Button size="sm" variant="ghost" disabled={proxyLocked} onclick={() => { change({ password: '', passwordStored: false }); editPassword = true; }}>{t('metadata.remove')}</Button></div>
              {:else}
                <div class="secret"><input id="metadata-password" class="field" type={showPassword ? 'text' : 'password'} value={draft.password} disabled={proxyLocked} maxlength="255" autocomplete="new-password" placeholder={t(canKeepPassword ? 'metadata.keepPassword' : 'metadata.enterPassword')} oninput={e => change({ password: e.currentTarget.value })} /><Button variant="ghost" disabled={proxyLocked || !draft.password} aria-pressed={showPassword} onclick={() => showPassword = !showPassword}>{t(showPassword ? 'metadata.hide' : 'metadata.show')}</Button></div>
                {#if canKeepPassword}<Button size="sm" variant="ghost" disabled={proxyLocked} onclick={() => { change({ password: '' }); editPassword = false; showPassword = false; }}>{t('metadata.cancelReplace')}</Button>{/if}
              {/if}
            </div>
          </div>
        {/if}
        {#if authError}<p class="error-text" role="alert">{authError}</p>{/if}
      {/if}
      {#if draft.mode !== 'environment'}<p class="hint">{t(proxy ? 'metadata.proxyHint' : 'settings.metaDirectHint')}</p>{/if}
    </fieldset>
  {:else}<p class="hint">{t('settings.metaOffHint')}</p>{/if}
  <div class="actions"><Button type="submit" loading={status === 'saving'} disabled={!dirty || modeLocked || busy}>{t('act.save')}</Button>{#if proxy}<Button variant="ghost" disabled={proxyLocked || status === 'saving'} loading={status === 'testing'} onclick={test}>{t(status === 'testing' ? 'metadata.testing' : status === 'failed' ? 'metadata.retry' : 'metadata.test')}</Button>{/if}</div>
  <div role="status" aria-live="polite" class={error ? 'error-text' : 'hint'}>{error || (status === 'saved' ? t('metadata.saved') : status === 'passed' ? t('metadata.passed') : status === 'testing' ? t('metadata.progress') : dirty ? t('metadata.unsaved') : '')}</div>
</form>

<style>
  .metadata-form { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .hint, .error-text { margin: 0; line-height: 1.6; }
  .setting { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .setting label { font-size: 13px; font-weight: 500; }
  .setting .hint { margin-top: 6px; }
  .setting :global(.switch) { flex: none; margin-top: 2px; }
  .connection { display: grid; gap: 14px; padding: 0; margin: 0; min-width: 0; border: 0; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .k, .input label { font-size: 13px; color: var(--text-2); }
  .route :global(.seg) { flex: none; }
  .route :global(.seg button) { min-width: 72px; }
  .address { display: grid; grid-template-columns: minmax(0,1fr) 88px; gap: 12px; }
  .input { display: grid; gap: 6px; min-width: 0; align-content: start; }
  .input .field { min-width: 0; width: 100%; }
  .option { min-height: 28px; }
  .option .hint { text-align: right; }
  .auth-fields { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 12px; }
  .secret { display: flex; align-items: center; gap: 4px; min-height: 36px; }
  .secret .field { flex: 1; }
  .secret:not(.stored) :global(.btn) { height: 36px; }
  .stored .hint { margin-right: auto; }
  .actions { display: flex; align-items: center; gap: 8px; }
  [role='status']:empty { display: none; }
  @media (max-width: 720px) { .route { flex-direction: column; align-items: flex-start; gap: 8px; } }
  @media (max-width: 640px) {
    .route :global(.seg) { width: 100%; }
    .route :global(.seg button) { flex: 1; min-width: 0; }
    .address { grid-template-columns: minmax(0,1fr) 76px; }
    .auth-fields { grid-template-columns: minmax(0,1fr); }
  }
</style>
