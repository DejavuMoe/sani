<script lang="ts">
  import { tick } from 'svelte';
  import { slide } from 'svelte/transition';
  import { ApiError, type Link, type TextFormat } from '../lib/api';
  import { copyLater } from '../lib/clipboard';
  import { toISO, type Expiry } from '../lib/expiry';
  import { errorText, t } from '../lib/i18n.svelte';
  import { mod, modEnter } from '../lib/keys';
  import { links } from '../lib/links.svelte';
  import { session } from '../lib/session.svelte';
  import { byteLength, formatSize } from '../lib/size';
  import { toasts } from '../lib/toast.svelte';
  import { hostOf, stripScheme } from '../lib/url';
  import ExpiryPicker from './ExpiryPicker.svelte';
  import Icon from './Icon.svelte';
  import Segmented from './Segmented.svelte';
  import SlugField, { blocking, type SlugStatus } from './SlugField.svelte';

  let { mode }: { mode: 'text' | 'file' } = $props();

  type Field = 'main' | 'slug' | 'more' | 'other';

  let text = $state('');
  let format = $state<TextFormat>('plain');
  let file = $state<File | null>(null);
  let slug = $state('');
  let slugStatus = $state<SlugStatus>('idle');
  let title = $state('');
  let expiry = $state<Expiry>({ preset: 'never' });
  let maxClicks = $state('');
  let more = $state(false);
  let busy = $state(false);
  /** Share of the file sent so far, while uploading. */
  let progress = $state<number | null>(null);
  let dragging = $state(false);
  let error = $state<{ field: Field; text: string } | null>(null);
  let note = $state('');
  let area = $state<HTMLTextAreaElement>();
  let picker = $state<HTMLInputElement>();
  let chooser = $state<HTMLButtonElement>();
  let upload: AbortController | null = null;

  const id = $derived(`share-${mode}`);
  const prefix = $derived(hostOf(session.origin) + '/p');
  const maxText = $derived(session.config?.maxTextSize ?? 1 << 20);
  const maxFile = $derived(session.config?.maxFileSize ?? 64 << 20);
  const filesOn = $derived(!!session.config?.filesUrl);
  const bytes = $derived(mode === 'text' ? byteLength(text) : 0);
  const pct = $derived(progress === null ? 0 : Math.round(progress * 100));

  /** Called by the page for text pasted outside any field. */
  export async function fillText(s: string) {
    text = s;
    error = null;
    note = t('share.pasted', { keys: `${mod} ↵` });
    await tick();
    autosize();
    area?.focus();
    area?.setSelectionRange(0, 0);
    area?.scrollTo({ top: 0 });
  }

  /** Called by the page for files dropped or pasted anywhere. */
  export function fillFile(f: File) {
    if (busy) return;
    file = f;
    error = null;
    note = t('share.dropped');
  }

  export function focus() {
    if (mode === 'text') area?.focus();
    else chooser?.focus();
  }

  function autosize() {
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight + 2, innerHeight * 0.6)}px`;
  }

  function reset() {
    text = '';
    file = null;
    slug = '';
    title = '';
    maxClicks = '';
    note = '';
    expiry = { preset: 'never' };
    tick().then(autosize);
  }

  const fieldFor: Record<string, Field> = {
    text_required: 'main',
    text_too_large: 'main',
    file_required: 'main',
    file_too_large: 'main',
    files_disabled: 'main',
    upload_invalid: 'main',
    slug_taken: 'slug',
    slug_reserved: 'slug',
    slug_invalid: 'slug',
    slug_too_long: 'slug',
    max_clicks_invalid: 'more',
  };

  function fail(code: string) {
    const field = fieldFor[code] ?? 'other';
    if (field === 'more') more = true;
    error = { field, text: errorText(code) };
  }

  /** A problem the server would report, found before sending anything. */
  function problem(): string | null {
    if (mode === 'text') {
      if (!text.trim()) return 'text_required';
      if (bytes > maxText) return 'text_too_large';
    } else {
      if (!filesOn) return 'files_disabled';
      if (!file || file.size === 0) return 'file_required';
      if (file.size > maxFile) return 'file_too_large';
    }
    if (blocking.includes(slugStatus)) return slugStatus === 'tooLong' ? 'slug_too_long' : `slug_${slugStatus}`;
    if (maxClicks.trim() && !/^[1-9]\d*$/.test(maxClicks.trim())) return 'max_clicks_invalid';
    return null;
  }

  async function submit(e?: SubmitEvent) {
    e?.preventDefault();
    if (busy) return;
    const p = problem();
    if (p) {
      fail(p);
      if (fieldFor[p] === 'main') focus();
      return;
    }

    busy = true;
    error = null;
    // As in the link composer, the clipboard write starts during the gesture.
    let deliver!: (s: string) => void;
    let reject!: (e: unknown) => void;
    const shortUrl = new Promise<string>((res, rej) => ((deliver = res), (reject = rej)));
    shortUrl.catch(() => {});
    const copied = copyLater(shortUrl);

    const options = {
      slug: slug.trim() || undefined,
      title: title.trim() || undefined,
      expiresAt: toISO(expiry) ?? undefined,
      maxClicks: maxClicks.trim() ? Number(maxClicks.trim()) : undefined,
    };
    try {
      let link: Link;
      if (mode === 'text') {
        link = await links.createText({ ...options, text, format });
      } else {
        upload = new AbortController();
        progress = 0;
        link = await links.createFile(file!, options, (sent, total) => (progress = sent / total), upload.signal);
      }
      deliver(link.shortUrl);
      const ok = await copied;
      toasts.success(t(ok ? 'created.copied' : 'created.ready'), { detail: stripScheme(link.shortUrl) });
      reset();
    } catch (err) {
      reject(err);
      if (err instanceof DOMException && err.name === 'AbortError') toasts.show(t('share.canceled'));
      else fail(err instanceof ApiError ? err.code : 'unknown');
    } finally {
      busy = false;
      progress = null;
      upload = null;
    }
  }

  function onTextKey(e: KeyboardEvent) {
    if (modEnter(e)) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      area?.blur();
    }
  }

  function hasFiles(e: DragEvent) {
    return e.dataTransfer?.types.includes('Files') ?? false;
  }
</script>

<form
  class={['composer', mode, error?.field === 'main' && 'invalid', dragging && 'dragging']}
  onsubmit={submit}
  novalidate
>
  {#if mode === 'text'}
    <label class="sr-only" for="{id}-body">{t('share.textLabel')}</label>
    <textarea
      bind:this={area}
      bind:value={text}
      id="{id}-body"
      class={['body', format === 'code' && 'mono']}
      rows="5"
      placeholder={t('share.textPlaceholder')}
      spellcheck={format === 'plain'}
      autocapitalize="off"
      aria-invalid={error?.field === 'main' || undefined}
      aria-describedby={error ? `${id}-error` : note ? `${id}-note` : undefined}
      oninput={() => {
        autosize();
        if (error?.field === 'main') error = null;
        note = '';
      }}
      onkeydown={onTextKey}
    ></textarea>
  {:else}
    <div
      class="drop"
      role="group"
      aria-label={t('create.file')}
      ondragenter={(e) => hasFiles(e) && (dragging = true)}
      ondragover={(e) => {
        if (!hasFiles(e) || !filesOn) return;
        e.preventDefault();
        dragging = true;
      }}
      ondragleave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) dragging = false;
      }}
      ondrop={(e) => {
        dragging = false;
        const f = e.dataTransfer?.files[0];
        if (!f || !filesOn) return;
        e.preventDefault();
        e.stopPropagation();
        fillFile(f);
      }}
    >
      {#if !filesOn}
        <p class="off"><Icon name="lock" size={16} />{t('share.fileDisabled')}</p>
      {:else if file}
        <div class="picked">
          <span class="ficon"><Icon name="file" size={18} /></span>
          <span class="finfo">
            <span class="fname">{file.name}</span>
            <span class="fmeta">{formatSize(file.size)}{file.type ? ` · ${file.type}` : ''}</span>
          </span>
          {#if busy && progress !== null}
            <button type="button" class="x" aria-label={t('share.cancel')} title={t('share.cancel')} onclick={() => upload?.abort()}>
              <Icon name="x" />
            </button>
          {:else}
            <button
              type="button"
              class="x"
              aria-label={t('share.fileRemove')}
              title={t('share.fileRemove')}
              disabled={busy}
              onclick={() => {
                file = null;
                note = '';
                tick().then(() => chooser?.focus());
              }}
            >
              <Icon name="x" />
            </button>
          {/if}
        </div>
        {#if progress !== null}
          <div
            class="progress"
            role="progressbar"
            aria-label={t('share.uploading', { pct })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <span style:width="{pct}%"></span>
          </div>
        {/if}
      {:else}
        <div class="empty">
          <Icon name="upload" size={18} />
          <span>
            {t('share.fileDrop')}
            <button bind:this={chooser} type="button" class="choose" onclick={() => picker?.click()}>{t('share.fileChoose')}</button>
          </span>
          <span class="limit">{t('share.fileLimit', { max: formatSize(maxFile) })}</span>
        </div>
      {/if}
      <input
        bind:this={picker}
        type="file"
        class="sr-only"
        tabindex="-1"
        aria-hidden="true"
        onchange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) fillFile(f);
          e.currentTarget.value = '';
        }}
      />
    </div>
  {/if}

  <div class="options">
    {#if mode === 'text'}
      <Segmented
        size="sm"
        label={t('share.format')}
        value={format}
        onchange={(v) => (format = v)}
        options={[
          { value: 'plain', label: t('format.plain') },
          { value: 'code', label: t('format.code') },
        ]}
      />
    {/if}
    <SlugField
      id="{id}-slug"
      bind:value={slug}
      bind:status={slugStatus}
      {prefix}
      placeholder={t('composer.slugAuto')}
      onenter={() => submit()}
    />
    <span class="gap"></span>
    {#if mode === 'text' && text}
      <span class={['count', bytes > maxText && 'over']}>{formatSize(bytes)} / {formatSize(maxText)}</span>
    {/if}
    <ExpiryPicker bind:value={expiry} triggerClass="opt" />
    <button type="button" class="opt" aria-expanded={more} aria-controls="{id}-more" onclick={() => (more = !more)}>
      {more ? t('composer.less') : t('composer.more')}
      <Icon name="chevronDown" size={14} class={['chev', more && 'up']} />
    </button>
    <button class="go" type="submit" disabled={busy || (mode === 'file' && !filesOn)} aria-busy={busy || undefined}>
      {#if busy}<span class="spinner" aria-hidden="true"></span>{/if}
      {busy && progress !== null ? t('share.uploading', { pct }) : t('share.submit')}
      {#if mode === 'text' && !busy}<kbd class="go-kbd" aria-hidden="true">{mod}↵</kbd>{/if}
    </button>
  </div>

  {#if more}
    <div class="more" id="{id}-more" transition:slide={{ duration: 180 }}>
      <label class="cell grow">
        <span class="k">{t('composer.title')}</span>
        <input class="inline" bind:value={title} placeholder={t('share.optional')} maxlength="300" />
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
    </div>
  {/if}
</form>

{#if error}
  <p class="problem" id="{id}-error" role="alert"><Icon name="alert" size={14} />{error.text}</p>
{:else if note}
  <p class="note" id="{id}-note">{note}</p>
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

  .composer:focus-within,
  .composer.dragging {
    border-color: color-mix(in oklab, var(--accent) 55%, var(--line-2));
    box-shadow:
      0 0 0 3px color-mix(in oklab, var(--accent) 12%, transparent),
      0 1px 2px rgb(28 27 25 / 0.04);
  }

  .composer.invalid {
    border-color: var(--danger);
  }

  .body {
    display: block;
    width: 100%;
    min-height: 128px;
    padding: 14px 16px;
    border: 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: transparent;
    color: var(--text);
    font-size: 14.5px;
    line-height: 1.6;
    resize: none;
  }

  .body.mono {
    font-family: var(--font-mono);
    font-size: 13px;
    tab-size: 4;
    white-space: pre;
    overflow-x: auto;
  }

  .body:focus {
    outline: none;
  }

  .drop {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 112px;
    padding: 14px 16px;
  }

  .dragging .drop {
    background: color-mix(in oklab, var(--accent-soft) 60%, var(--surface));
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: 13.5px;
    text-align: center;
  }

  .empty :global(.icon) {
    color: var(--text-3);
  }

  .choose {
    color: var(--accent);
    font-weight: 500;
    text-decoration: underline;
    text-decoration-color: var(--accent-line);
    text-underline-offset: 3px;
  }

  .choose:hover {
    text-decoration-color: currentColor;
  }

  .limit {
    color: var(--text-3);
    font-size: 12px;
  }

  .off {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-2);
    font-size: 13px;
    text-align: center;
  }

  .off :global(.icon) {
    color: var(--text-3);
  }

  .picked {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .ficon {
    display: grid;
    flex: none;
    width: 40px;
    height: 40px;
    place-items: center;
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text-2);
  }

  .finfo {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .fname {
    overflow: hidden;
    color: var(--text);
    font-size: 14px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fmeta {
    overflow: hidden;
    color: var(--text-3);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .x {
    display: grid;
    flex: none;
    width: 30px;
    height: 30px;
    place-items: center;
    border-radius: var(--radius-sm);
    color: var(--text-3);
  }

  .x:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }

  .progress {
    height: 4px;
    margin-top: 14px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--surface-3);
  }

  .progress span {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--accent);
    transition: width 160ms linear;
  }

  .options {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    min-height: 48px;
    padding: 7px 8px 7px 16px;
    border-top: 1px solid var(--line);
    font-size: 13px;
  }

  .gap {
    flex: 1;
  }

  .count {
    color: var(--text-3);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .count.over {
    color: var(--danger);
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

  .go {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 8px 0 14px;
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--on-ink);
    font-size: 13.5px;
    font-weight: 550;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    transition:
      background-color var(--fast) var(--ease),
      transform 80ms var(--ease);
  }

  .go:not(:has(.go-kbd)) {
    padding-right: 14px;
  }

  .go:hover:not(:disabled) {
    background: var(--ink-hover);
  }

  .go:active:not(:disabled) {
    transform: translateY(0.5px);
  }

  .go:disabled:not([aria-busy]) {
    opacity: 0.45;
  }

  .go-kbd {
    min-width: 20px;
    height: 20px;
    border: 0;
    background: color-mix(in oklab, var(--on-ink) 16%, transparent);
    color: var(--on-ink);
    font-size: 11px;
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
    .body {
      font-size: 16px; /* keeps iOS from zooming the field */
    }

    .body.mono {
      font-size: 16px;
    }

    .options {
      padding-left: 14px;
    }

    .gap {
      flex-basis: 100%;
      height: 0;
    }

    .go {
      margin-left: auto;
    }

    .go-kbd {
      display: none;
    }
  }
</style>
