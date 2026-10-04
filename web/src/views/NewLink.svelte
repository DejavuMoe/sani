<script lang="ts">
  /*
   * The compact "shorten this page" window used by the bookmarklet and the
   * PWA share target. A shared URL is shortened right away; an existing
   * plain link to the same page is returned instead of a duplicate.
   */
  import { onMount } from 'svelte';
  import Button from '../components/Button.svelte';
  import Composer from '../components/Composer.svelte';
  import Logo from '../components/Logo.svelte';
  import QRCode from '../components/QRCode.svelte';
  import type { Link } from '../lib/api';
  import { copyText } from '../lib/clipboard';
  import { t } from '../lib/i18n.svelte';
  import { router } from '../lib/router.svelte';
  import { toasts } from '../lib/toast.svelte';
  import { extractURL, stripScheme } from '../lib/url';

  const params = router.current.params;
  const shared = extractURL(params.get('url') ?? '') ?? extractURL(params.get('text') ?? '') ?? '';
  const pageTitle = (params.get('title') ?? '').trim();
  const popup = !!window.opener || window.name === 'sani';

  let composer = $state<Composer>();
  let created = $state<Link | null>(null);
  let copied = $state(false);

  onMount(() => {
    if (!shared) return;
    composer?.fill(shared, 'prefill', pageTitle);
    composer?.submitNow();
  });

  async function copy() {
    if (!created) return;
    copied = await copyText(created.shortUrl);
    if (copied) toasts.success(t('act.copied'), { detail: stripScheme(created.shortUrl) });
  }
</script>

<main class="new">
  <header>
    <Logo size={18} />
    <h1 class="title">{t('new.title')}</h1>
  </header>

  {#if created}
    <div class="result">
      <QRCode value={created.shortUrl} size={120} label={t('detail.qrLabel', { url: stripScheme(created.shortUrl) })} />
      <a class="short" href={created.shortUrl} target="_blank" rel="noopener">{stripScheme(created.shortUrl)}</a>
      {#if created.title}<p class="page">{created.title}</p>{/if}
      <div class="actions">
        <Button variant="primary" icon={copied ? 'check' : 'copy'} onclick={copy}>{copied ? t('act.copied') : t('act.copy')}</Button>
        {#if popup}
          <Button variant="ghost" onclick={() => window.close()}>{t('new.closeWindow')}</Button>
        {:else}
          <Button variant="ghost" onclick={() => router.go('/', { replace: true })}>{t('act.back')}</Button>
        {/if}
      </div>
    </div>
  {:else}
    <Composer
      bind:this={composer}
      reuse
      autofocus
      oncreated={(link, ok) => {
        created = link;
        copied = ok;
      }}
    />
  {/if}
</main>

<style>
  .new {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: min(100%, 520px);
    margin: 0 auto;
    padding: 20px 20px 32px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .title {
    color: var(--text-3);
    font-size: 13px;
    font-weight: 400;
  }

  .result {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 26px 20px 22px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    text-align: center;
  }

  .result :global(.qr) {
    padding: 8px;
    border-radius: var(--radius);
    background: #fff;
    box-sizing: content-box;
  }

  .short {
    margin-top: 8px;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 17px;
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .page {
    max-width: 100%;
    overflow: hidden;
    color: var(--text-3);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
</style>
