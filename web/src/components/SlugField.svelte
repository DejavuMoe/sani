<script lang="ts" module>
  export type SlugStatus = 'idle' | 'checking' | 'available' | 'taken' | 'reserved' | 'invalid' | 'tooLong';

  /** Statuses that block saving. */
  export const blocking: SlugStatus[] = ['taken', 'reserved', 'invalid', 'tooLong'];
</script>

<script lang="ts">
  import { api } from '../lib/api';
  import { t } from '../lib/i18n.svelte';
  import { sameSlug, slugProblem } from '../lib/url';
  import Icon from './Icon.svelte';

  let {
    value = $bindable(''),
    status = $bindable<SlugStatus>('idle'),
    prefix,
    current = '',
    placeholder = '',
    id,
    variant = 'inline',
    onenter,
  }: {
    value?: string;
    status?: SlugStatus;
    prefix: string;
    /** The link's own slug when editing; it is never reported as taken. */
    current?: string;
    placeholder?: string;
    id?: string;
    variant?: 'inline' | 'boxed';
    onenter?: () => void;
  } = $props();

  $effect(() => {
    const v = value.trim().replace(/^\//, '');
    if (!v || (current && sameSlug(v, current))) {
      status = 'idle';
      return;
    }
    const problem = slugProblem(v);
    if (problem) {
      status = problem;
      return;
    }
    status = 'checking';
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await api.checkSlug(v, ctrl.signal);
        status = r.available
          ? 'available'
          : r.reason === 'slug_reserved'
            ? 'reserved'
            : r.reason === 'slug_taken'
              ? 'taken'
              : r.reason === 'slug_too_long'
                ? 'tooLong'
                : 'invalid';
      } catch {
        if (!ctrl.signal.aborted) status = 'idle';
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  });

  const message = $derived(
    {
      idle: '',
      checking: '',
      available: t('slug.available'),
      taken: t('slug.taken'),
      reserved: t('slug.reserved'),
      invalid: t('slug.invalid'),
      tooLong: t('slug.tooLong'),
    }[status],
  );

  // The inline field grows with the slug instead of clipping it; wide
  // characters take two columns, and the stylesheet caps it at 32ch.
  const width = $derived.by(() => {
    if (variant !== 'inline') return undefined;
    const cols = [...value].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/.test(ch) ? 2 : 1), 0);
    return `${Math.max(11, cols + 1)}ch`;
  });
</script>

<span class={['slug', variant, status !== 'idle' && status]}>
  <label class="box" for={id}>
    <span class="prefix">{prefix}/</span>
    <input
      {id}
      bind:value
      {placeholder}
      style:width
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
      enterkeyhint="go"
      maxlength="128"
      aria-invalid={blocking.includes(status) || undefined}
      aria-describedby={id ? `${id}-status` : undefined}
      onkeydown={(e) => {
        if (e.key === 'Enter' && onenter) {
          e.preventDefault();
          onenter();
        }
      }}
    />
  </label>
  {#if variant === 'inline' || message}
    <span class="status" id={id ? `${id}-status` : undefined} aria-live="polite">
      {#if status === 'available'}<Icon name="check" size={14} stroke={2} />{:else if blocking.includes(status)}<Icon
          name="alert"
          size={14}
        />{/if}
      {message}
    </span>
  {/if}
</span>

<style>
  .slug {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .box {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    font-family: var(--font-mono);
    cursor: text;
  }

  .prefix {
    flex: none;
    color: var(--text-3);
    white-space: nowrap;
  }

  input {
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font-family: var(--font-mono);
  }

  input:focus {
    outline: none;
  }

  input::placeholder {
    color: var(--text-4);
    font-family: var(--font-sans);
  }

  /* Inline: part of the composer's option row. */
  .inline .box {
    height: 28px;
    padding: 0 8px;
    margin-left: -8px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    transition: background-color var(--fast) var(--ease);
  }

  .inline .box:hover {
    background: var(--surface-2);
  }

  .inline .box:focus-within {
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--line-2);
  }

  .inline input {
    width: 11ch;
    max-width: 32ch;
    height: 100%;
    font-size: 13px;
  }

  /* Field: a full text field in forms. */
  .boxed .box {
    /* Not flex: 1. In this column box that collapses the field to its text
       height beside the 36px fields around it. */
    flex: none;
    height: 36px;
    padding: 0 11px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: 13.5px;
    transition:
      border-color var(--fast) var(--ease),
      box-shadow var(--fast) var(--ease);
  }

  .boxed .box:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent);
  }

  .boxed input {
    flex: 1;
    height: 100%;
    font-size: 13.5px;
  }

  .boxed {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .taken .box,
  .reserved .box,
  .invalid .box,
  .tooLong .box {
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--danger) 55%, transparent);
  }

  .boxed.taken .box,
  .boxed.reserved .box,
  .boxed.invalid .box,
  .boxed.tooLong .box {
    border-color: var(--danger);
    box-shadow: none;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-3);
    font-size: 12px;
    white-space: nowrap;
  }


  /* --success is 4.39:1 on --surface in the light theme, under AA for text,
     so the words take --text-2 and the check keeps the color. */
  .available .status {
    color: var(--text-2);
  }

  .available .status :global(.icon) {
    color: var(--success);
  }

  .taken .status,
  .reserved .status,
  .invalid .status,
  .tooLong .status {
    color: var(--danger);
  }
</style>
