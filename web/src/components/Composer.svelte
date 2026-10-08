<script lang="ts">
  import { slide } from 'svelte/transition';
  import { ApiError, type Link } from '../lib/api';
  import { copyLater } from '../lib/clipboard';
  import { toISO, type Expiry } from '../lib/expiry';
  import { errorText, t } from '../lib/i18n.svelte';
  import { links } from '../lib/links.svelte';
  import { session } from '../lib/session.svelte';
  import { toasts } from '../lib/toast.svelte';
  import { hostOf, stripScheme } from '../lib/url';
  import ExpiryPicker from './ExpiryPicker.svelte';
  import Icon from './Icon.svelte';
  import Segmented from './Segmented.svelte';
  import SlugField, { blocking, type SlugStatus } from './SlugField.svelte';
  import TagPicker from './TagPicker.svelte';

  let {
    reuse = false,
    autofocus = false,
    oncreated,
  }: {
    /** Return an existing plain link for the same URL ("shorten this page"). */
    reuse?: boolean;
    autofocus?: boolean;
    oncreated?: (link: Link, copied: boolean) => void;
  } = $props();

  let url = $state('');
  let slug = $state('');
  let slugStatus = $state<SlugStatus>('idle');
  let title = $state('');
  let tags = $state<number[]>([]);
  let tagBusy = $state(false);
  let expiry = $state<Expiry>({ preset: 'never' });
  let maxClicks = $state('');
  let redirect = $state(302);
  let more = $state(false);
  let busy = $state(false);
  let error = $state<{ field: 'url' | 'slug' | 'more' | 'other'; text: string } | null>(null);
  let note = $state('');
  let pulse = $state(false);
  let input = $state<HTMLInputElement>();

  const prefix = $derived(hostOf(session.origin));

  /** Called by the page for paste-anywhere, drops and ?url= prefills. */
  export function fill(text: string, how: 'paste' | 'drop' | 'prefill', pageTitle = '') {
    url = text.trim();
    if (pageTitle) title = pageTitle.trim();
    error = null;
    note = how === 'paste' ? t('composer.pasted') : how === 'drop' ? t('composer.dropped') : '';
    pulse = false;
    requestAnimationFrame(() => (pulse = how !== 'prefill'));
    input?.focus();
    input?.setSelectionRange(url.length, url.length);
  }

  export function focus() {
    input?.focus();
    input?.select();
  }

  function reset() {
    url = '';
    slug = '';
    title = '';
    tags = [];
    maxClicks = '';
    note = '';
    expiry = { preset: 'never' };
    redirect = 302;
  }

  const fieldFor: Record<string, 'url' | 'slug' | 'more' | 'other'> = {
    url_required: 'url',
    url_invalid: 'url',
    url_too_long: 'url',
    url_scheme: 'url',
    url_self: 'url',
    slug_taken: 'slug',
    slug_reserved: 'slug',
    slug_invalid: 'slug',
    slug_too_long: 'slug',
    max_clicks_invalid: 'more',
    expires_past: 'other',
    expires_invalid: 'other',
  };

  async function submit(e?: SubmitEvent) {
    e?.preventDefault();
    if (busy || tagBusy) return;
    if (!url.trim()) {
      error = { field: 'url', text: t('err.url_required') };
      input?.focus();
      return;
    }
    if (blocking.includes(slugStatus)) {
      error = { field: 'slug', text: errorText(slugStatus === 'tooLong' ? 'slug_too_long' : `slug_${slugStatus}`) };
      return;
    }
    const limit = maxClicks.trim();
    if (limit && !/^[1-9]\d*$/.test(limit)) {
      more = true;
      error = { field: 'more', text: t('err.max_clicks_invalid') };
      return;
    }

    busy = true;
    error = null;
    // The clipboard write starts inside the key press or click, before the
    // short URL exists; the promise delivers the text when it does.
    let deliver!: (s: string) => void;
    let fail!: (e: unknown) => void;
    const shortUrl = new Promise<string>((res, rej) => ((deliver = res), (fail = rej)));
    shortUrl.catch(() => {});
    const copied = copyLater(shortUrl);

    try {
      const link = await links.create({
        url: url.trim(),
        slug: slug.trim() || undefined,
        title: title.trim() || undefined,
        expiresAt: toISO(expiry) ?? undefined,
        maxClicks: limit ? Number(limit) : undefined,
        redirect: redirect === 302 ? undefined : redirect,
        reuse: reuse || undefined,
        tags: tags.length ? tags : undefined,
      });
      deliver(link.shortUrl);
      const ok = await copied;
      toasts.success(t(link.reused ? 'created.existing' : ok ? 'created.copied' : 'created.ready'), {
        detail: stripScheme(link.shortUrl),
      });
      reset();
      oncreated?.(link, ok);
    } catch (err) {
      fail(err);
      const code = err instanceof ApiError ? err.code : 'unknown';
      const field = fieldFor[code] ?? 'other';
      if (field === 'more') more = true;
      error = { field, text: errorText(code) };
    } finally {
      busy = false;
      input?.focus();
    }
  }
</script>

<form class={['composer', error?.field === 'url' && 'invalid', pulse && 'pulse']} onsubmit={submit} novalidate>
  <div class="main">
    <Icon name="link" class="lead" />
    <label class="sr-only" for="composer-url">{t('composer.label')}</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      bind:this={input}
      bind:value={url}
      id="composer-url"
      class="url"
      type="text"
      inputmode="url"
      placeholder={t('composer.placeholder')}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      enterkeyhint="go"
      autofocus={autofocus}
      aria-invalid={error?.field === 'url' || undefined}
      aria-describedby={error ? 'composer-error' : note ? 'composer-note' : undefined}
      oninput={() => {
        if (error?.field === 'url') error = null;
        note = '';
      }}
      onanimationend={() => (pulse = false)}
      onkeydown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          input?.blur();
        }
      }}
    />
    <button class="go" type="submit" disabled={busy || tagBusy} aria-busy={busy || undefined}>
      {#if busy}<span class="spinner" aria-hidden="true"></span>{/if}
      <span class="go-label">{t('composer.submit')}</span>
      <kbd class="go-kbd" aria-hidden="true"><Icon name="enter" size={12} /></kbd>
    </button>
  </div>

  <div class="options">
    <SlugField
      id="composer-slug"
      bind:value={slug}
      bind:status={slugStatus}
      {prefix}
      placeholder={t('composer.slugAuto')}
      onenter={() => submit()}
    />
    <span class="gap"></span>
    <ExpiryPicker bind:value={expiry} triggerClass="opt" />
    <button type="button" class="opt" aria-expanded={more} aria-controls="composer-more" onclick={() => (more = !more)}>
      {more ? t('composer.less') : t('composer.more')}
      <Icon name="chevronDown" size={14} class={['chev', more && 'up']} />
    </button>
  </div>

  <TagPicker bind:value={tags} bind:creating={tagBusy} disabled={busy} />
  {#if more}
    <div class="more" id="composer-more" transition:slide={{ duration: 180 }}>
      <label class="cell grow">
        <span class="k">{t('composer.title')}</span>
        <input class="inline" bind:value={title} placeholder={t('composer.titleAuto')} maxlength="300" />
      </label>
      <label class="cell">
        <span class="k">{t('composer.maxClicks')}</span>
        <input
          class="inline num"
          bind:value={maxClicks}
          inputmode="numeric"
          placeholder={t('composer.noLimit')}
          aria-invalid={error?.field === 'more' || undefined}
        />
      </label>
      <span class="cell">
        <span class="k" id="composer-redirect">{t('composer.redirect')}</span>
        <Segmented
          size="sm"
          label={t('composer.redirect')}
          value={redirect}
          onchange={(v) => (redirect = v)}
          options={[
            { value: 302, label: t('redirect.302') },
            { value: 301, label: t('redirect.301') },
          ]}
        />
      </span>
    </div>
  {/if}
</form>

{#if error}
  <p class="problem" id="composer-error" role="alert"><Icon name="alert" size={14} />{error.text}</p>
{:else if note}
  <p class="note" id="composer-note">{note}</p>
{/if}

<style>
  .composer {
    border: 1px solid var(--line-2);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: 0 1px 2px rgb(28 27 25 / 0.04);
    transition:
      border-color var(--normal) var(--ease),
      box-shadow var(--normal) var(--ease);
  }

  .composer:focus-within {
    border-color: color-mix(in oklab, var(--accent) 55%, var(--line-2));
    box-shadow:
      0 0 0 3px color-mix(in oklab, var(--accent) 12%, transparent),
      0 1px 2px rgb(28 27 25 / 0.04);
  }

  .composer.invalid {
    border-color: var(--danger);
  }

  .pulse {
    animation: pulse 700ms var(--ease);
  }

  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in oklab, var(--accent) 35%, transparent);
    }
    100% {
      box-shadow: 0 0 0 10px transparent;
    }
  }

  .main {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 56px;
    padding: 0 8px 0 16px;
  }

  .main :global(.lead) {
    color: var(--text-3);
  }

  .url {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    background: transparent;
    color: var(--text);
    font-size: 15.5px;
  }

  .url:focus {
    outline: none;
  }

  .go {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 8px 0 14px;
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--on-ink);
    font-size: 13.5px;
    font-weight: 550;
    transition:
      background-color var(--fast) var(--ease),
      transform 80ms var(--ease);
  }

  .go:hover:not(:disabled) {
    background: var(--ink-hover);
  }

  .go:active:not(:disabled) {
    transform: translateY(0.5px);
  }

  .go-kbd {
    min-width: 20px;
    height: 20px;
    border: 0;
    background: color-mix(in oklab, var(--on-ink) 16%, transparent);
    color: var(--on-ink);
  }

  .spinner {
    width: 13px;
    height: 13px;
    border: 1.5px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .options {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    min-height: 42px;
    padding: 6px 10px 6px 16px;
    border-top: 1px solid var(--line);
    font-size: 13px;
  }

  .gap {
    flex: 1;
  }

  .options :global(.opt) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    color: var(--text-2);
    font-size: 13px;
    white-space: nowrap;
    transition:
      background-color var(--fast) var(--ease),
      color var(--fast) var(--ease);
  }

  .options :global(.opt:hover),
  .options :global(.opt[aria-expanded='true']) {
    background: var(--surface-2);
    color: var(--text);
  }

  .options :global(.k) {
    color: var(--text-3);
  }

  .options :global(.chev) {
    color: var(--text-3);
    transition: transform var(--normal) var(--ease);
  }

  .options :global(.chev.up) {
    transform: rotate(180deg);
  }

  .more {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 20px;
    padding: 10px 16px 12px;
    border-top: 1px solid var(--line);
    font-size: 13px;
  }

  .cell {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .grow {
    flex: 1 1 260px;
  }

  .cell .k {
    color: var(--text-3);
    white-space: nowrap;
  }

  .inline {
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: 13px;
  }

  .grow .inline {
    flex: 1;
  }

  .inline:focus {
    outline: none;
    border-color: var(--accent);
  }

  .inline[aria-invalid='true'] {
    border-color: var(--danger);
  }

  .num {
    width: 88px;
    font-variant-numeric: tabular-nums;
  }

  .problem,
  .note {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 2px 0;
    font-size: 13px;
  }

  .problem {
    color: var(--danger);
  }

  .note {
    color: var(--text-3);
  }

  @media (max-width: 640px) {
    .main {
      height: 52px;
      padding-left: 14px;
    }

    .main :global(.lead) {
      display: none;
    }

    .url {
      font-size: 16px; /* keeps iOS from zooming the field */
    }

    .go {
      padding: 0 12px;
    }

    .go-kbd {
      display: none;
    }

    .options {
      padding-left: 14px;
    }

    .gap {
      flex-basis: 100%;
      height: 0;
    }
  }
</style>
