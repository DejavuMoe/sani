<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError, type Link, type LinkInput } from '../lib/api';
  import { fromISO, sameExpiry, toISO, type Expiry } from '../lib/expiry';
  import { errorText, t } from '../lib/i18n.svelte';
  import { mod, modEnter } from '../lib/keys';
  import { links } from '../lib/links.svelte';
  import { session } from '../lib/session.svelte';
  import { toasts } from '../lib/toast.svelte';
  import { hostOf, sameSlug } from '../lib/url';
  import Button from './Button.svelte';
  import ExpiryPicker from './ExpiryPicker.svelte';
  import Segmented from './Segmented.svelte';
  import SlugField, { blocking, type SlugStatus } from './SlugField.svelte';
  import Switch from './Switch.svelte';

  let { link }: { link: Link } = $props();

  function initial() {
    return {
      url: link.url,
      slug: link.slug,
      title: link.meta === 'manual' || link.meta === 'ok' ? link.title : '',
      expiry: fromISO(link.expiresAt) as Expiry,
      maxClicks: link.maxClicks ? String(link.maxClicks) : '',
      redirect: link.redirect,
      enabled: link.enabled,
    };
  }

  const start = initial();
  let form = $state(initial());
  let slugStatus = $state<SlugStatus>('idle');
  let saving = $state(false);
  let errors = $state<{ url?: string; slug?: string; maxClicks?: string; other?: string }>({});
  let urlField = $state<HTMLTextAreaElement>();

  const prefix = $derived(hostOf(session.origin));
  const renamed = $derived(form.slug.trim() !== '' && !sameSlug(form.slug.trim(), start.slug));

  function patch(): LinkInput {
    const p: LinkInput = {};
    if (form.url.trim() !== start.url) p.url = form.url.trim();
    if (form.slug.trim() !== start.slug) p.slug = form.slug.trim();
    if (form.title.trim() !== start.title) p.title = form.title.trim();
    if (!sameExpiry(form.expiry, start.expiry)) p.expiresAt = toISO(form.expiry);
    const limit = form.maxClicks.trim();
    if (limit !== start.maxClicks) p.maxClicks = limit ? Number(limit) : null;
    if (form.redirect !== start.redirect) p.redirect = form.redirect;
    if (form.enabled !== start.enabled) p.enabled = form.enabled;
    return p;
  }

  const dirty = $derived(Object.keys(patch()).length > 0);

  function autosize() {
    if (!urlField) return;
    urlField.style.height = 'auto';
    urlField.style.height = `${urlField.scrollHeight + 2}px`;
  }

  onMount(() => {
    autosize();
    urlField?.focus();
    urlField?.setSelectionRange(urlField.value.length, urlField.value.length);
  });

  function cancel() {
    links.editingId = null;
  }

  async function save() {
    if (saving) return;
    errors = {};
    if (!form.url.trim()) return void (errors = { url: t('err.url_required') });
    if (!form.slug.trim()) return void (errors = { slug: t('err.slug_invalid') });
    if (blocking.includes(slugStatus)) return void (errors = { slug: t(`slug.${slugStatus}` as 'slug.taken') });
    if (form.maxClicks.trim() && !/^[1-9]\d*$/.test(form.maxClicks.trim()))
      return void (errors = { maxClicks: t('err.max_clicks_invalid') });
    const p = patch();
    if (!Object.keys(p).length) return cancel();
    saving = true;
    try {
      await links.update(link.id, p);
      links.editingId = null;
      toasts.success(t('detail.saved'));
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'unknown';
      const text = errorText(code);
      if (code.startsWith('url_')) errors = { url: text };
      else if (code.startsWith('slug_')) errors = { slug: text };
      else if (code === 'max_clicks_invalid') errors = { maxClicks: text };
      else errors = { other: text };
    } finally {
      saving = false;
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (modEnter(e)) {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form
  class="editor"
  onsubmit={(e) => {
    e.preventDefault();
    save();
  }}
  {onkeydown}
  novalidate
>
  <div class="cell wide">
    <label class="label" for="edit-url-{link.id}">{t('detail.destination')}</label>
    <textarea
      bind:this={urlField}
      id="edit-url-{link.id}"
      class="field mono url"
      rows="1"
      bind:value={form.url}
      oninput={autosize}
      spellcheck="false"
      autocapitalize="off"
      aria-invalid={!!errors.url || undefined}
    ></textarea>
    {#if errors.url}<p class="error-text">{errors.url}</p>{/if}
  </div>

  <div class="cell">
    <label class="label" for="edit-slug-{link.id}">{t('composer.slug')}</label>
    <SlugField
      id="edit-slug-{link.id}"
      variant="boxed"
      bind:value={form.slug}
      bind:status={slugStatus}
      {prefix}
      current={link.slug}
    />
    {#if errors.slug}
      <p class="error-text">{errors.slug}</p>
    {:else if renamed}
      <p class="hint warn">{t('slug.renameWarn')}</p>
    {/if}
  </div>

  <div class="cell">
    <label class="label" for="edit-title-{link.id}">{t('composer.title')}</label>
    <input id="edit-title-{link.id}" class="field" bind:value={form.title} placeholder={t('composer.titleAuto')} maxlength="300" />
  </div>

  <div class="cell">
    <span class="label">{t('composer.expiry')}</span>
    <ExpiryPicker bind:value={form.expiry} triggerClass="field picker-field" showLabel={false} />
  </div>

  <div class="cell">
    <label class="label" for="edit-limit-{link.id}">{t('composer.maxClicks')}</label>
    <input
      id="edit-limit-{link.id}"
      class="field tnum"
      bind:value={form.maxClicks}
      inputmode="numeric"
      placeholder={t('composer.noLimit')}
      aria-invalid={!!errors.maxClicks || undefined}
    />
    {#if errors.maxClicks}<p class="error-text">{errors.maxClicks}</p>{/if}
  </div>

  <div class="cell">
    <span class="label">{t('composer.redirect')}</span>
    <Segmented
      label={t('composer.redirect')}
      value={form.redirect === 308 ? 301 : form.redirect === 307 ? 302 : form.redirect}
      onchange={(v) => (form.redirect = v)}
      options={[
        { value: 302, label: t('redirect.302') },
        { value: 301, label: t('redirect.301') },
      ]}
    />
    <p class="hint">{t('redirect.hint')}</p>
  </div>

  <div class="cell switch-row">
    <Switch id="edit-enabled-{link.id}" checked={form.enabled} onchange={(v) => (form.enabled = v)} label={t('detail.enabled')} />
    <label for="edit-enabled-{link.id}">
      <span class="switch-label">{t('detail.enabled')}</span>
      <span class="hint">{t('detail.enabledHint')}</span>
    </label>
  </div>

  <footer class="wide">
    {#if errors.other}<p class="error-text">{errors.other}</p>{/if}
    <span class="spacer"></span>
    <span class="kbd-hint"><kbd>{mod}</kbd><kbd>↵</kbd></span>
    <Button size="sm" variant="ghost" onclick={cancel}>{t('act.cancel')}</Button>
    <Button size="sm" variant="primary" type="submit" loading={saving} disabled={!dirty}>{t('act.save')}</Button>
  </footer>
</form>

<style>
  .editor {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 20px;
    padding: 18px 16px 14px;
  }

  .wide {
    grid-column: 1 / -1;
  }

  .url {
    min-height: 36px;
    font-size: 13px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .editor :global(.picker-field) {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    text-align: left;
  }

  .editor :global(.picker-field .chev) {
    color: var(--text-3);
  }

  .editor :global(.expiry) {
    display: flex;
    width: 100%;
  }

  .editor :global(.expiry > button) {
    flex: 1;
  }

  .warn {
    color: var(--warning);
  }

  .switch-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding-top: 22px;
  }

  .switch-row label {
    display: flex;
    flex-direction: column;
    cursor: pointer;
  }

  .switch-label {
    font-size: 13px;
    font-weight: 500;
    line-height: 20px;
  }

  .switch-row .hint {
    margin-top: 0;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }

  footer .error-text {
    margin: 0;
  }

  .spacer {
    flex: 1;
  }

  .kbd-hint {
    display: inline-flex;
    gap: 3px;
    margin-right: 6px;
  }

  @media (max-width: 640px) {
    .editor {
      grid-template-columns: 1fr;
      padding: 16px 14px 12px;
    }

    .switch-row {
      padding-top: 0;
    }

    .kbd-hint {
      display: none;
    }
  }
</style>
