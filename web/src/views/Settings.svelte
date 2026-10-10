<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { slide } from 'svelte/transition';
  import { prefersReducedMotion } from 'svelte/motion';
  import AppHeader from '../components/AppHeader.svelte';
  import Button from '../components/Button.svelte';
  import UnitInput from '../components/UnitInput.svelte';
  import Icon from '../components/Icon.svelte';
  import MetadataSettings from '../components/MetadataSettings.svelte';
  import Switch from '../components/Switch.svelte';
  import Segmented from '../components/Segmented.svelte';
  import { api, ApiError, type Config, type ImportResult, type Token } from '../lib/api';
  import { clock } from '../lib/clock.svelte';
  import { download } from '../lib/qr';
  import { copyText } from '../lib/clipboard';
  import { errorText, formatDate, formatRelative, i18n, t, type Lang, type MessageKey } from '../lib/i18n.svelte';
  import { links } from '../lib/links.svelte';
  import { prefs, type ThemePref } from '../lib/prefs.svelte';
  import { router } from '../lib/router.svelte';
  import { session } from '../lib/session.svelte';
  import { toasts } from '../lib/toast.svelte';

  const config = $derived(session.config);

  // Short domain
  let baseUrl = $state(session.config?.baseUrlSource === 'setting' ? session.config.baseUrl : '');
  let baseBusy = $state(false);
  let baseError = $state('');

  async function saveBase(e: SubmitEvent) {
    e.preventDefault();
    baseBusy = true;
    baseError = '';
    try {
      session.config = await api.setBaseUrl(baseUrl.trim() || null);
      baseUrl = session.config.baseUrlSource === 'setting' ? session.config.baseUrl : '';
      toasts.success(t('settings.domainSaved'));
      links.load();
    } catch (err) {
      baseError = errorText(err instanceof ApiError ? err.code : 'unknown');
    } finally {
      baseBusy = false;
    }
  }

  const lengthFields = [
    ['slugLength', 'settings.urlLength', 5, ''],
    ['textSlugLength', 'settings.textLength', 10, 'p/'],
    ['fileSlugLength', 'settings.fileLength', 10, 'p/'],
  ] as const;
  let lengths = $state(untrack(() => ({
    slugLength: String(session.config?.slugLength ?? 5),
    textSlugLength: String(session.config?.textSlugLength ?? 10),
    fileSlugLength: String(session.config?.fileSlugLength ?? 10),
  })));
  let excludeConfusable = $state(untrack(() => session.config?.excludeConfusable ?? true));
  let maxFileMB = $state(untrack(() => String((session.config?.maxFileSize ?? 99_000_000) / 1_000_000)));
  let defaultsBusy = $state(false);
  let defaultsError = $state('');
  let defaultsSaved = $state(false);
  const locked = (key: keyof Config['configSources']) => config?.configSources[key] === 'env';
  const validInteger = (value: string, min: number, max: number) => /^\d+$/.test(value) && +value >= min && +value <= max;
  const maxFileValid = $derived(locked('maxFileSize') || validInteger(maxFileMB, 1, 4096));
  const defaultsValid = $derived(lengthFields.every(([key]) => locked(key) || validInteger(lengths[key], 3, 32)) && maxFileValid);
  const defaultsPatch = $derived.by(() => {
    const values: Parameters<typeof api.setConfig>[0] = {};
    for (const [key] of lengthFields) {
      if (!locked(key) && +lengths[key] !== config?.[key]) values[key] = +lengths[key];
    }
    if (!locked('excludeConfusable') && excludeConfusable !== config?.excludeConfusable) values.excludeConfusable = excludeConfusable;
    if (!locked('maxFileSize') && +maxFileMB * 1_000_000 !== config?.maxFileSize) values.maxFileSize = +maxFileMB * 1_000_000;
    return values;
  });
  const defaultsChanged = $derived(Object.keys(defaultsPatch).length > 0);
  const shortShare = $derived(lengthFields.some(([key]) => key !== 'slugLength' && validInteger(lengths[key], 3, 32) && +lengths[key] < 10));
  function editDefaults() {
    defaultsError = ''; defaultsSaved = false;
  }
  async function saveDefaults(e: SubmitEvent) {
    e.preventDefault(); if (defaultsBusy || !defaultsValid || !defaultsChanged) return;
    defaultsBusy = true; defaultsError = ''; defaultsSaved = false;
    try {
      session.config = await api.setConfig(defaultsPatch); defaultsSaved = true;
    } catch (err) { defaultsError = errorText(err instanceof ApiError ? err.code : 'unknown'); }
    finally { defaultsBusy = false; }
  }
  // Tokens
  let tokens = $state<Token[] | null>(null);
  let tokenName = $state('');
  let tokenBusy = $state(false);
  let tokenError = $state('');
  let revealed = $state<Token | null>(null);
  let confirming = $state<number | null>(null);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  let tokensFailed = $state(false), tokensLoading = $state(false);
  async function loadTokens() {
    if (tokensLoading) return;
    tokensLoading = true; tokensFailed = false;
    try { tokens = (await api.tokens()).items; }
    catch { tokensFailed = true; }
    finally { tokensLoading = false; }
  }
  onMount(() => {
    void loadTokens();
    return () => clearTimeout(confirmTimer);
  });

  async function createToken(e: SubmitEvent) {
    e.preventDefault();
    if (tokens === null || tokensLoading || tokensFailed || tokenBusy) return;
    if (!tokenName.trim()) return void (tokenError = t('err.name_invalid'));
    tokenBusy = true;
    tokenError = '';
    try {
      const tok = await api.createToken(tokenName.trim());
      revealed = tok;
      tokens = [{ ...tok, token: undefined }, ...(tokens ?? [])];
      tokenName = '';
    } catch (err) {
      tokenError = errorText(err instanceof ApiError ? err.code : 'unknown');
    } finally {
      tokenBusy = false;
    }
  }

  async function revoke(tok: Token) {
    if (confirming !== tok.id) {
      confirming = tok.id;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => (confirming = null), 3500);
      return;
    }
    confirming = null;
    try {
      await api.deleteToken(tok.id);
      tokens = (tokens ?? []).filter((x) => x.id !== tok.id);
      if (revealed?.id === tok.id) revealed = null;
      toasts.show(t('settings.tokenRevoked', { name: tok.name }));
    } catch (err) {
      toasts.error(errorText(err instanceof ApiError ? err.code : 'unknown'));
    }
  }

  async function copy(text: string) {
    if (await copyText(text)) toasts.success(t('act.copied'));
  }

  const apiOrigin = location.origin;
  const curl = $derived(
    `curl -X POST ${apiOrigin}/api/v1/links \\\n  -H "Authorization: Bearer ${revealed?.token ?? 'sani_…'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"target_url": "https://example.com/some/long/path"}'`,
  );

  // Bookmarklet: opens the compact "shorten this page" window.
  const bookmarklet = `javascript:(()=>{window.open('${location.origin}/admin/new?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'sani','popup,width=480,height=560')})()`;

  // Import
  let importing = $state(false);
  let importResult = $state<ImportResult | null>(null);
  let importError = $state('');
  let dragOver = $state(false);
  let fileInput = $state<HTMLInputElement>();

  async function importFile(file: File | undefined) {
    if (!file) return;
    importing = true;
    importError = '';
    importResult = null;
    try {
      importResult = await api.importLinks(await file.text());
      links.load();
      links.refreshOverview();
    } catch (err) {
      importError = err instanceof ApiError && err.code === 'import_unreadable' ? `${t('err.import_unreadable')}: ${err.message}` : errorText(err instanceof ApiError ? err.code : 'unknown');
    } finally {
      importing = false;
      if (fileInput) fileInput.value = '';
    }
  }

  function reason(r: string): string {
    const key = `reason.${r}` as MessageKey;
    const s = t(key);
    return s === key ? errorText(r) : s;
  }

  // Password
  let current = $state('');
  let next = $state('');
  let pwBusy = $state(false);
  let pwError = $state('');

  async function changePassword(e: SubmitEvent) {
    e.preventDefault();
    pwError = '';
    if ([...next].length < 8) return void (pwError = t('err.password_short'));
    pwBusy = true;
    try {
      await api.changePassword(current, next);
      current = next = '';
      toasts.success(t('settings.passwordChanged'));
    } catch (err) {
      pwError = errorText(err instanceof ApiError ? err.code : 'unknown');
    } finally {
      pwBusy = false;
    }
  }

  async function revokeSessions() {
    try {
      await api.revokeOtherSessions();
      toasts.success(t('settings.sessionsRevoked'));
    } catch (err) {
      toasts.error(errorText(err instanceof ApiError ? err.code : 'unknown'));
    }
  }
</script>

<AppHeader />
<main class="page">
  <a class="back" href="/admin/" onclick={router.link}><Icon name="arrowLeft" size={14} />{t('act.back')}</a>
  <h1>{t('settings.title')}</h1>

  <section>
    <header><h2>{t('settings.appearance')}</h2></header>
    <div class="body">
      <div class="row">
        <span class="k">{t('settings.theme')}</span>
        <Segmented
          label={t('settings.theme')}
          value={prefs.theme}
          onchange={(v: ThemePref) => prefs.setTheme(v)}
          options={[
            { value: 'system', label: t('theme.system'), icon: 'monitor' },
            { value: 'light', label: t('theme.light'), icon: 'sun' },
            { value: 'dark', label: t('theme.dark'), icon: 'moon' },
          ]}
        />
      </div>
      <div class="row">
        <span class="k">{t('settings.language')}</span>
        <Segmented
          label={t('settings.language')}
          value={i18n.lang}
          onchange={(v: Lang) => i18n.set(v)}
          options={[
            { value: 'zh', label: '中文' },
            { value: 'en', label: 'English' },
          ]}
        />
      </div>
    </div>
  </section>

  <section>
    <header>
      <h2>{t('settings.domain')}</h2>
    </header>
    <div class="body">
      {#if config?.baseUrlSource === 'env'}
        <p class="text">{t('settings.domainEnv', { url: config.baseUrl })}</p>
      {:else}
        <form novalidate class="inline-form" onsubmit={saveBase}>
          <input
            class="field mono"
            bind:value={baseUrl}
            placeholder={config?.requestOrigin ?? location.origin}
            inputmode="url"
            autocomplete="off"
            spellcheck="false"
            aria-label={t('settings.domain')}
            aria-invalid={!!baseError || undefined}
          />
          <Button type="submit" loading={baseBusy}>{t('act.save')}</Button>
        </form>
        {#if baseError}
          <p class="error-text">{baseError}</p>
        {:else}
          <p class="hint">{t('settings.domainHint', { origin: config?.requestOrigin ?? location.origin })}</p>
        {/if}
      {/if}
    </div>
  </section>

  <section>
    <header><h2>{t('settings.defaults')}</h2></header>
    <form novalidate class="body defaults-form creation-form" onsubmit={saveDefaults} oninput={editDefaults} aria-busy={defaultsBusy}>
      <fieldset class="lengths" disabled={defaultsBusy}>
        <legend>{t('settings.slugLength')}</legend>
        <p class="hint length-help">{t('settings.slugLengthHint')}</p>
        {#each lengthFields as [key, label, fallback, prefix] (key)}
          {@const valid = validInteger(lengths[key], 3, 32)}
          <div class="length-row">
            <div class="length-label">
              <label id={'default-' + key + '-label'} for={'default-' + key}>{t(label)}</label>
              <p class="hint" id={'default-' + key + '-default'}>{t('settings.lengthDefault', { n: fallback })}{#if locked(key)}<span class="env-lock"><Icon name="lock" size={12} />{t('settings.envLocked')}</span>{/if}</p>
            </div>
            <UnitInput id={'default-' + key} aria-labelledby={'default-' + key + '-label'} unit={t('settings.lengthUnit')} bind:value={lengths[key]} disabled={locked(key)} aria-invalid={!valid} aria-describedby={'default-' + key + '-default default-' + key + '-help'} />
            <div id={'default-' + key + '-help'} class="length-example">
              {#if valid}
                <span>{t('settings.slugExample')}</span><code>/{prefix}{(key === 'slugLength' && !excludeConfusable ? 'k0mi9p1o2r6h8q3t' : 'k7mx9p4w2r6h8q3t').repeat(2).slice(0, +lengths[key])}</code>
              {:else}
                <span class="error-text" role="alert">{t('settings.lengthInvalid')}</span>
              {/if}
            </div>
          </div>
        {/each}
      </fieldset>
      {#if shortShare}<p class="hint short-help">{t('settings.shortShareHint')}</p>{/if}
      <div class="setting"><div><label for="default-exclude">{t('settings.exclude')}</label><p class="hint">{t('settings.excludeHint')}</p>{#if locked('excludeConfusable')}<p class="hint env-lock"><Icon name="lock" size={12} />{t('settings.envLocked')}</p>{/if}</div><Switch id="default-exclude" label={t('settings.exclude')} checked={excludeConfusable} onchange={v => { excludeConfusable = v; editDefaults(); }} disabled={locked('excludeConfusable') || defaultsBusy} /></div>
      <div class="setting"><div><label id="default-max-file-label" for="default-max-file">{t('settings.maxFile')}</label><p class="hint" id="default-max-file-help">{t('settings.maxFileHint')}{#if locked('maxFileSize')}<span class="env-lock"><Icon name="lock" size={12} />{t('settings.envLocked')}</span>{/if}</p></div><UnitInput id="default-max-file" aria-labelledby="default-max-file-label" unit="MB" bind:value={maxFileMB} disabled={locked('maxFileSize') || defaultsBusy} aria-invalid={!maxFileValid} aria-describedby={maxFileValid ? 'default-max-file-help' : 'default-max-file-help default-max-file-error'} /></div>
      {#if !maxFileValid}<p id="default-max-file-error" class="error-text" role="alert">{t('settings.maxFileInvalid')}</p>{/if}
      <div class="settings-save">
        <Button type="submit" loading={defaultsBusy} disabled={!defaultsValid || !defaultsChanged}>{t(defaultsError ? 'settings.retrySave' : 'act.save')}</Button>
        {#if defaultsError}<span class="error-text save-error" role="alert">{t('settings.defaultsSaveFailed')} {defaultsError}</span>{/if}
        <span class="saved" role="status">{defaultsSaved && !defaultsChanged ? t('settings.saved') : ''}</span>
      </div>
    </form>
  </section>
  <section>
    <header><h2>{t('settings.metadata')}</h2></header>
    <MetadataSettings />
  </section>

  <section>
    <header>
      <h2>{t('settings.tokens')}</h2>
      <p>{t('settings.tokensHint')}</p>
    </header>
    <div class="body">
      <form novalidate class="inline-form" onsubmit={createToken}>
        <input
          class="field"
          bind:value={tokenName}
          placeholder={t('settings.tokenNamePlaceholder')}
          maxlength="60"
          aria-label={t('settings.tokenName')}
          aria-invalid={!!tokenError || undefined}
        />
        <Button type="submit" icon="plus" loading={tokenBusy} disabled={tokens === null || tokensLoading || tokensFailed}>{t('settings.tokenCreate')}</Button>
      </form>
      {#if tokenError}<p class="error-text">{tokenError}</p>{/if}

      {#if revealed?.token}
        {@const secret = revealed.token}
        <div class="reveal" transition:slide={{ duration: prefersReducedMotion.current ? 0 : 180 }}>
          <p class="reveal-note"><Icon name="key" size={14} />{t('settings.tokenOnce')}</p>
          <div class="secret">
            <code>{secret}</code>
            <Button size="sm" icon="copy" onclick={() => copy(secret)}>{t('act.copy')}</Button>
          </div>
          <p class="k small">{t('settings.tokenExample')}</p>
          <div class="code">
            <!-- It scrolls sideways on phones, so it takes focus. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <pre tabindex="0" role="region" aria-label={t('settings.tokenExample')}>{curl}</pre>
            <button class="code-copy" aria-label={t('act.copy')} onclick={() => copy(curl)}>
              <Icon name="copy" size={14} />
            </button>
          </div>
        </div>
      {/if}

      {#if tokensFailed}<div class="state-notice error" role="alert"><span>{t('settings.tokensFailed')}</span><Button size="sm" onclick={loadTokens}>{t('act.retry')}</Button></div>
      {:else if tokensLoading}<p class="empty" role="status">{t('list.loading')}</p>{/if}
      {#if tokens && tokens.length > 0}
        <ul class="tokens">
          {#each tokens as tok (tok.id)}
            <li transition:slide={{ duration: prefersReducedMotion.current ? 0 : 160 }}>
              <Icon name="key" size={14} class="tok-icon" />
              <div class="tok-main">
                <span class="tok-name">{tok.name}</span>
                <span class="tok-meta">
                  <code>{tok.hint}…</code> · {formatDate(tok.createdAt, clock.now)} ·
                  {tok.usedAt ? t('settings.tokenUsed', { time: formatRelative(tok.usedAt, clock.now) }) : t('settings.tokenUnused')}
                </span>
              </div>
              <Button size="sm" variant={confirming === tok.id ? 'danger' : 'ghost'} onclick={() => revoke(tok)}>
                {confirming === tok.id ? t('settings.tokenConfirm') : t('settings.tokenRevoke')}
              </Button>
            </li>
          {/each}
        </ul>
      {:else if tokens}
        <p class="empty">{t('settings.tokensEmpty')}</p>
      {/if}
    </div>
  </section>

  <section>
    <header><h2>{t('settings.tools')}</h2></header>
    <div class="body">
      <div class="tool">
        <div>
          <h3>{t('settings.bookmarklet')}</h3>
          <p class="hint">{t('settings.bookmarkletHint')}</p>
        </div>
        <a
          class="bookmarklet"
          href={bookmarklet}
          onclick={(e) => {
            e.preventDefault();
            toasts.show(t('settings.bookmarkletDrag'));
          }}
          draggable="true"
        >
          <Icon name="bookmark" size={14} />{t('settings.bookmarkletButton')}
        </a>
      </div>
      <div class="tool">
        <div>
          <h3>{t('settings.install')}</h3>
          <p class="hint">{t('settings.installHint')}</p>
        </div>
      </div>
    </div>
  </section>

  <section>
    <header><h2>{t('settings.data')}</h2></header>
    <div class="body">
      <div class="tool">
        <div>
          <h3>{t('settings.export')}</h3>
          <p class="hint">{t('settings.exportHint')}</p>
        </div>
        <div class="pair">
          <a class="dl" href="/api/admin/v1/export" download>JSON</a>
          <a class="dl" href="/api/admin/v1/export?format=csv" download>CSV</a>
        </div>
      </div>
      <div class="tool column backup-help"><h3>{t('settings.backup')}</h3><p class="hint">{t('settings.backupHint')}</p><a href={i18n.lang === 'zh' ? 'https://sani.zsh.moe/guide/operations#backup-files' : 'https://sani.zsh.moe/en/guide/operations#backup-files'} target="_blank" rel="noopener">{t('settings.backupGuide')}</a></div>
      <div class="tool column">
        <div>
          <h3>{t('settings.import')}</h3>
          <p class="hint">{t('settings.importHint')}</p>
          <div class="examples"><span>{t('settings.examples')}</span><a href="/api/admin/v1/examples/sani.csv" download>CSV</a><a href="/api/admin/v1/examples/sani.json" download>JSON</a></div>
        </div>
        <label
          class={['drop', dragOver && 'over', importing && 'busy']}
          ondragover={(e) => {
            e.preventDefault();
            dragOver = true;
          }}
          ondragleave={() => (dragOver = false)}
          ondrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragOver = false;
            importFile(e.dataTransfer?.files[0]);
          }}
        >
          <input
            bind:this={fileInput}
            class="sr-only"
            type="file"
            accept=".json,.csv,application/json,text/csv"
            onchange={(e) => importFile(e.currentTarget.files?.[0])}
          />
          <Icon name="upload" />
          <span>{importing ? t('settings.importing') : t('settings.importDrop')}</span>
        </label>
        {#if importError}<p class="error-text">{importError}</p>{/if}
        {#if importResult}
          <div class="import-result" transition:slide={{ duration: prefersReducedMotion.current ? 0 : 160 }}>
            <p><Icon name="check" size={14} stroke={2} />{t('settings.imported', { n: importResult.created })}</p>
            {#if importResult.skipped.length > 0}
              <p class="k">{t('settings.importSkipped', { n: importResult.skipped.length })} {#if importResult.skipped.length > 20}{t('settings.previewSkipped')}{/if}</p>
              <Button size="sm" onclick={() => download('sani-import-skipped.json',new Blob([JSON.stringify(importResult?.skipped,null,2)],{type:'application/json'}))}>{t('settings.downloadSkipped',{n:importResult.skipped.length})}</Button>
              <ul>
                {#each importResult.skipped.slice(0, 20) as s, i (i)}
                  <li>
                    {#if s.slug}<code>/{s.slug}</code>{/if}
                    {#if s.row}<span class="k">{t('reason.row', { n: s.row })}</span>{/if}
                    <span>{reason(s.reason)}</span>
                  </li>
                {/each}
                {#if importResult.skipped.length > 20}<li class="k">…</li>{/if}
              </ul>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </section>

  <section>
    <header><h2>{t('settings.account')}</h2></header>
    <div class="body">
      {#if config?.passwordFromEnv}
        <p class="text">{t('settings.passwordEnv')}</p>
      {:else}
        <form novalidate class="password" onsubmit={changePassword}>
          <h3>{t('settings.passwordChange')}</h3>
          <input class="sr-only" type="text" autocomplete="username" value="sani" readonly tabindex="-1" aria-hidden="true" />
          <div class="pw-grid">
            <label>
              <span class="label">{t('settings.passwordCurrent')}</span>
              <input class="field" type="password" autocomplete="current-password" bind:value={current} />
            </label>
            <label>
              <span class="label">{t('settings.passwordNew')}</span>
              <input class="field" type="password" autocomplete="new-password" bind:value={next} />
            </label>
          </div>
          {#if pwError}<p class="error-text">{pwError}</p>{/if}
          <div class="actions">
            <Button type="submit" loading={pwBusy} disabled={!current || !next}>{t('settings.passwordChange')}</Button>
          </div>
        </form>
      {/if}
      <div class="actions spaced">
        <Button variant="ghost" icon="lock" onclick={revokeSessions}>{t('settings.sessionsRevoke')}</Button>
        <Button variant="ghost" icon="logout" onclick={() => session.signOut()}>{t('auth.signOut')}</Button>
      </div>
    </div>
  </section>

  <section>
    <header><h2>{t('settings.about')}</h2></header>
    <div class="body">
      <dl class="about">
        <div><dt>{t('settings.version')}</dt><dd class="mono">{config?.version ?? '–'}</dd></div>
        <div><dt>{t('settings.timezone')}</dt><dd class="mono">{config?.timezone ?? '–'}</dd></div>
        <div>
          <dt>{t('settings.files')}</dt>
          <dd class={config?.filesUrl ? 'mono' : ''}>{config?.filesUrl ?? t('settings.filesOff')}</dd>
        </div>
      </dl>
    </div>
  </section>
</main>

<style>
  .backup-help { flex-basis:100%; font-size:12px; margin-top:12px; }
  .backup-help a { color:var(--text-2); text-decoration:underline; text-underline-offset:3px; }
  .backup-help a:hover { color:var(--text); }
  .page {
    width: min(100%, calc(var(--page) + 2 * var(--gutter)));
    margin: 0 auto;
    padding: 12px var(--gutter) 96px;
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    margin-left: -8px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    color: var(--text-3);
    font-size: 13px;
  }

  .back:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  h1 {
    margin: 12px 0 24px;
    font-size: 21px;
    font-weight: 600;
    letter-spacing: -0.015em;
  }

  section {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    gap: 28px;
    padding: 24px 0;
    border-top: 1px solid var(--line);
  }

  section header h2 {
    font-size: 14px;
    font-weight: 600;
  }

  section header p {
    margin-top: 6px;
    color: var(--text-3);
    font-size: 12.5px;
    line-height: 1.6;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .k {
    color: var(--text-2);
    font-size: 13px;
  }

  .k.small {
    margin-top: 6px;
    font-size: 12px;
  }

  .text {
    color: var(--text-2);
    font-size: 13.5px;
    line-height: 1.6;
  }

  .inline-form {
    align-items: center;
    display: flex;
    gap: 8px;
  }

  .inline-form { --control-size: var(--control-field); }

  .inline-form .field {
    min-width: 0;
    flex: 1;
  }

  .hint,
  .error-text {
    margin-top: -6px;
  }

  h3 {
    font-size: 13.5px;
    font-weight: 500;
  }

  .tool {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }

  .tool.column {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .tool .hint {
    margin-top: 4px;
    max-width: 420px;
  }

  .tool + .tool {
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }

  .bookmarklet {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    min-height: var(--control-compact);
    padding: 0 12px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
    cursor: grab;
    box-shadow: 0 1px 0 rgb(28 27 25 / 0.04);
  }

  .bookmarklet:active {
    cursor: grabbing;
  }

  .pair {
    display: flex;
    flex: none;
    gap: 6px;
  }

  .dl {
    display: inline-flex;
    align-items: center;
    min-height: var(--control-compact);
    padding: 0 12px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
  }

  .dl:hover,
  .bookmarklet:hover {
    background: var(--surface-2);
  }

  .drop {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 76px;
    border: 1px dashed var(--line-2);
    border-radius: var(--radius-lg);
    color: var(--text-3);
    font-size: 13px;
    cursor: pointer;
    transition:
      background-color var(--fast) var(--ease),
      border-color var(--fast) var(--ease),
      color var(--fast) var(--ease);
  }

  .drop:hover,
  .drop.over {
    border-color: var(--text-3);
    background: var(--surface-2);
    color: var(--text);
  }

  .drop:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .drop.busy {
    pointer-events: none;
    opacity: 0.7;
  }

  .import-result {
    padding: 12px 14px;
    border-radius: var(--radius);
    background: var(--surface-2);
    font-size: 13px;
  }

  .import-result p {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .import-result p + p {
    margin-top: 8px;
  }

  .import-result ul {
    display: grid;
    gap: 3px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
    color: var(--text-2);
    font-size: 12.5px;
  }

  .import-result li {
    display: flex;
    gap: 8px;
  }

  code {
    font-family: var(--font-mono);
    font-size: 12.5px;
  }

  .reveal {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    border: 1px solid var(--accent-line);
    border-radius: var(--radius-lg);
    background: var(--accent-soft);
  }

  .reveal-note {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
  }

  .secret {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .secret code {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 13px;
    user-select: all;
  }

  .code {
    position: relative;
  }

  pre {
    margin: 0;
    padding: 12px 40px 12px 12px;
    overflow-x: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text-2);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
  }

  .code-copy {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border-radius: var(--radius-sm);
    color: var(--text-3);
  }

  .code-copy:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .tokens {
    margin: 0;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    list-style: none;
  }

  .tokens li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 8px 10px 14px;
  }

  .tokens li + li {
    border-top: 1px solid var(--line);
  }

  .tokens :global(.tok-icon) {
    color: var(--text-3);
  }

  .tok-main {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .tok-name {
    font-size: 13.5px;
    font-weight: 500;
  }

  .tok-meta {
    overflow: hidden;
    color: var(--text-3);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tok-meta code {
    font-size: 11.5px;
  }

  .empty {
    color: var(--text-3);
    font-size: 13px;
  }

  .password {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .pw-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .actions.spaced {
    margin-left: -10px;
    padding-top: 6px;
  }

  .about {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    margin: 0;
    font-size: 13px;
  }

  .about div {
    display: grid;
    grid-template-columns: minmax(100px, max-content) minmax(0,1fr);
    align-items: baseline;
    gap: 20px;
  }

  .about dt {
    min-width: 0;
    line-height: 1.6;
    color: var(--text-3);
  }

  .about dd {
    font-family: var(--font-mono);
    font-size: 12px;
    min-width: 0;
    overflow-wrap: anywhere;
    margin: 0;
    line-height: 1.6;
  }

  @media (max-width: 720px) {
    section {
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
    }

    .pw-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .tool {
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
    }

    .row { flex-wrap: wrap; gap: 8px 16px; }
  }
  .defaults-form { gap: 18px; }
  .lengths { min-width: 0; padding: 0; border: 0; margin: 0; }
  .lengths legend { padding: 0; font-size: 13px; font-weight: 500; }
  .length-help { margin: 6px 0 12px; line-height: 1.65; }
  .length-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 3px 16px; padding: 10px 0; border-top: 1px solid var(--line); }
  .length-label label { font-size: 13px; font-weight: 500; }
  .length-label .hint { margin: 2px 0 0; font-size: 12px; display: flex; flex-wrap: wrap; gap: 4px 12px; }
  .env-lock { display: inline-flex; align-items: center; gap: 4px; }
  .length-row :global(.unit-input) { grid-column: 2; grid-row: 1 / 3; }
  .length-label { min-width: 0; }
  .length-example { grid-column: 1; display: flex; align-items: baseline; gap: 7px; min-height: 18px; font-size: 12px; color: var(--text-3); }
  .length-example > span { flex: none; }
  .length-example code { font-size: 11.5px; min-width: 0; color: var(--text-2); overflow-wrap: anywhere; }
  .length-example .error-text { margin: 0; flex: 1; min-width: 0; }
  .setting { --unit-width: 64px; --unit-mobile-width: 62px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .setting > div { min-width: 0; }
  .setting label { display: block; font-size: 13px; font-weight: 500; }
  .setting .hint { margin: 6px 0 0; line-height: 1.6; }
  .defaults-form > .hint { margin: 0; line-height: 1.65; }
  .defaults-form > .short-help { margin-top: -6px; }
  .settings-save { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; min-height: var(--control-compact); }
  .save-error { margin: 0; }
  .saved { color: var(--success); font-size: 12px; }
  .examples { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; margin-top: 12px; }
  .examples a { display: inline-flex; align-items: center; min-height: 28px; color: var(--text-2); text-decoration: underline; text-underline-offset: 3px; padding: 5px 0; }
  @media (max-width: 640px) {
    .setting { gap: 12px; }
    .length-row { gap: 3px 10px; }
    .length-example { align-items: start; }
    section { padding-block: 20px; }
  }
  @media (max-width:640px) { .about div { grid-template-columns:108px minmax(0,1fr); gap:12px; } }
</style>
