/*
 * Layer 3 — patterns, one per production component: Creator, Composer,
 * ShareComposer, Summary, LinkList, LinkRow, LinkDetail, LinkEditor,
 * AppHeader, AuthShell, ShortcutsDialog. `store` is useLinksStore();
 * `initial` seeds local state so boards can show a given state.
 */
const { useState: useS, useRef: useR, useEffect: useE, forwardRef, useImperativeHandle } = React;

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* ---- Composer.svelte ---- */

const composerFieldFor = {
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

const Composer = forwardRef(function Composer({ store, toasts, reuse = false, autofocus = false, onCreated, initial = {} }, handle) {
  const { t, errorText, lang } = useI18n();
  const [url, setUrl] = useS(initial.url ?? '');
  const [slug, setSlug] = useS(initial.slug ?? '');
  const slugStatus = useSlugStatus(slug);
  const [title, setTitle] = useS(initial.title ?? '');
  const [tags, setTags] = useS(initial.tags ?? []);
  const [expiry, setExpiry] = useS(initial.expiry ?? { preset: 'never' });
  const [maxClicks, setMaxClicks] = useS(initial.maxClicks ?? '');
  const [redirect, setRedirect] = useS(302);
  const [more, setMore] = useS(!!initial.more);
  const [busy, setBusy] = useS(!!initial.busy);
  const [error, setError] = useS(initial.error ?? null);
  const [note, setNote] = useS(initial.note ?? '');
  const [pulse, setPulse] = useS(false);
  const input = useR(null);
  const prefix = shortHost;

  function fill(text, how, pageTitle = '') {
    if (busy) return;
    setUrl(text.trim());
    if (pageTitle) setTitle(pageTitle.trim());
    setError(null);
    setNote(how === 'paste' ? t('composer.pasted') : how === 'drop' ? t('composer.dropped') : '');
    setPulse(false);
    requestAnimationFrame(() => setPulse(how !== 'prefill'));
    input.current?.focus();
  }

  async function submit(e, value = url) {
    e?.preventDefault();
    if (busy) return;
    if (!value.trim()) {
      setError({ field: 'url', text: t('err.url_required') });
      input.current?.focus();
      return;
    }
    if (blocking.includes(slugStatus)) {
      setError({ field: 'slug', text: errorText(slugStatus === 'tooLong' ? 'slug_too_long' : `slug_${slugStatus}`) });
      return;
    }
    const limit = maxClicks.trim();
    if (limit && !/^[1-9]\d*$/.test(limit)) {
      setMore(true);
      setError({ field: 'more', text: t('err.max_clicks_invalid') });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const link = await store.create({
        url: value.trim(),
        slug: slug.trim() || undefined,
        title: title.trim() || undefined,
        tags,
        maxClicks: limit ? Number(limit) : undefined,
        redirect: redirect === 302 ? undefined : redirect,
        reuse: reuse || undefined,
      });
      const ok = await copyText(link.shortUrl);
      toasts.success(t(link.reused ? 'created.existing' : ok ? 'created.copied' : 'created.ready'), { detail: stripScheme(link.shortUrl) });
      setUrl('');
      setSlug('');
      setTitle('');
      setTags([]);
      setMaxClicks('');
      setNote('');
      setExpiry({ preset: 'never' });
      setRedirect(302);
      onCreated?.(link, ok);
    } catch (err) {
      const code = err.code ?? 'unknown';
      const field = composerFieldFor[code] ?? 'other';
      if (field === 'more') setMore(true);
      setError({ field, text: errorText(code) });
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  useImperativeHandle(handle, () => ({
    fill,
    focus: () => (input.current?.focus(), input.current?.select()),
    submitNow: (value) => submit(undefined, value),
  }));

  return (
    <>
      <form className={cx('cmp', error?.field === 'url' && 'invalid', pulse && 'pulse')} onSubmit={submit} noValidate>
        <fieldset className="r7-lock" disabled={busy}><legend className="sr-only">{t("create.label")}</legend>
        <div className="cmp-main">
          <Icon name="link" className="lead" />
          <label className="sr-only" htmlFor="composer-url">
            {t('composer.label')}
          </label>
          <input
            ref={input}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error?.field === 'url') setError(null);
              setNote('');
            }}
            id="composer-url"
            className="cmp-url"
            type="text"
            inputMode="url"
            placeholder={t('composer.placeholder')}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck="false"
            enterKeyHint="go"
            autoFocus={autofocus}
            aria-invalid={error?.field === 'url' || undefined}
            aria-describedby={error ? 'composer-error' : note ? 'composer-note' : undefined}
            onAnimationEnd={() => setPulse(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                input.current?.blur();
              }
            }}
          />
          <button className="cmp-go" type="submit" disabled={busy} aria-busy={busy || undefined}>
            {busy && <span className="cmp-spinner" aria-hidden="true"></span>}
            <span className="go-label">{t('composer.submit')}</span>
            <kbd className="cmp-go-kbd" aria-hidden="true">
              <Icon name="enter" size={12} />
            </kbd>
          </button>
        </div>
        <div className="cmp-options">
          <SlugField id="composer-slug" value={slug} onChange={setSlug} status={slugStatus} prefix={prefix} placeholder={t('composer.slugAuto')} onEnter={() => submit()} />
          <span className="cmp-gap"></span>
          <ExpiryPicker value={expiry} onChange={setExpiry} triggerClass="opt" />
          <button type="button" className="opt" aria-expanded={more} aria-controls="composer-more" onClick={() => setMore(!more)}>
            {more ? t('composer.less') : t('composer.more')}{!more && (title || maxClicks) && <span className="r7-more-count"> · {[title,maxClicks].filter(Boolean).length}</span>}
            <Icon name="chevronDown" size={14} className={cx('chev', more && 'up')} />
          </button>
        </div>
        <TagPicker value={tags} onChange={setTags} store={store} disabled={busy} />
        {more && (
          <div className="cmp-more" id="composer-more">
            <label className="cmp-cell cmp-grow">
              <span className="k">{t('composer.title')}</span>
              <input className="cmp-inline" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('composer.titleAuto')} maxLength={300} />
            </label>
            <label className="cmp-cell">
              <span className="k">{t('composer.maxClicks')}</span>
              <input
                className="cmp-inline cmp-num"
                value={maxClicks}
                onChange={(e) => setMaxClicks(e.target.value)}
                inputMode="numeric"
                placeholder={t('composer.noLimit')}
                aria-invalid={error?.field === 'more' || undefined}
              />
            </label>
            <span className="cmp-cell">
              <span className="k" id="composer-redirect">
                {t('composer.redirect')}
              </span>
              <Segmented
                size="sm"
                label={t('composer.redirect')}
                value={redirect}
                onChange={setRedirect}
                options={[
                  { value: 302, label: t('redirect.302') },
                  { value: 301, label: t('redirect.301') },
                ]}
              />
            </span>
          </div>
        )}
        <div className="r7-rules" hidden={expiry.preset === "never" && redirect !== 301}><p>{lang === 'zh' ? '到期后停止访问，内容仍保留，可续期或删除。' : 'Expiry stops access. Content stays available to extend or delete.'}</p>{redirect === 301 && <p>{lang === 'zh' ? '永久跳转可能被浏览器缓存，目标变更、停用和统计不会总是立即反映。' : 'Permanent redirects may be cached. Changes, disabling and statistics may not take effect immediately.'}</p>}</div>
        </fieldset>
        {busy && <p className="r7-rules" role="status">{lang === "zh" ? "正在提交，输入内容已暂时锁定。" : "Submitting. Inputs are temporarily locked."}</p>}
      </form>
      {error ? (
        <p className="cmp-problem" id="composer-error" role="alert">
          <Icon name="alert" size={14} />
          {error.text}
        </p>
      ) : note ? (
        <p className="cmp-note" id="composer-note">
          {note}
        </p>
      ) : null}
    </>
  );
});

/* ---- ShareComposer.svelte ---- */

const shareFieldFor = {
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

const ShareComposer = forwardRef(function ShareComposer({ mode, store, toasts, config = FIX.config, initial = {} }, handle) {
  const { t, errorText, lang } = useI18n();
  const [text, setText] = useS(initial.text ?? '');
  const [format, setFormat] = useS(initial.format ?? 'plain');
  const [file, setFile] = useS(initial.file ?? null);
  const [slug, setSlug] = useS('');
  const slugStatus = useSlugStatus(slug);
  const [title, setTitle] = useS('');
  const [tags, setTags] = useS(initial.tags ?? []);
  const [expiry, setExpiry] = useS({ preset: 'never' });
  const [maxClicks, setMaxClicks] = useS('');
  const [more, setMore] = useS(!!initial.more);
  const [busy, setBusy] = useS(!!initial.busy);
  const [progress, setProgress] = useS(initial.progress ?? null);
  const [dragging, setDragging] = useS(!!initial.dragging);
  const [error, setError] = useS(initial.error ?? null);
  const [note, setNote] = useS(initial.note ?? '');
  const area = useR(null);
  const picker = useR(null);
  const chooser = useR(null);
  const upload = useR(null);

  const id = `share-${mode}`;
  const prefix = shortHost + '/p';
  const maxText = config.maxTextSize ?? 1 << 20;
  const maxFile = config.maxFileSize ?? 64 << 20;
  const filesOn = !!config.filesUrl;
  const bytes = mode === 'text' ? byteLength(text) : 0;
  const pct = progress === null ? 0 : Math.round(progress * 100);

  function autosize() {
    const a = area.current;
    if (!a) return;
    a.style.height = 'auto';
    a.style.height = `${Math.min(a.scrollHeight + 2, innerHeight * 0.6)}px`;
  }
  // Production sizes the field on input and fill only; an empty one keeps rows="5".
  const sized = useR(false);
  useE(() => {
    if (!sized.current && !text) return;
    sized.current = true;
    autosize();
  }, [text, format]);

  function fillFile(f) {
    if (busy) return;
    setFile(f);
    setError(null);
    setNote(t('share.dropped'));
  }

  useImperativeHandle(handle, () => ({
    fillText(s) {
      if (busy) return;
      setText(s);
      setError(null);
      setNote(t('share.pasted', { keys: `${mod} ↵` }));
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.setSelectionRange(0, 0);
      });
    },
    fillFile,
    focus: () => (mode === 'text' ? area.current?.focus() : chooser.current?.focus()),
  }));

  function fail(code) {
    const field = shareFieldFor[code] ?? 'other';
    if (field === 'more') setMore(true);
    setError({ field, text: errorText(code) });
  }

  function problem() {
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

  async function submit(e) {
    e?.preventDefault();
    if (busy) return;
    const p = problem();
    if (p) return fail(p);
    setBusy(true);
    setError(null);
    const options = { slug: slug.trim() || undefined, title: title.trim() || undefined, tags, maxClicks: maxClicks.trim() ? Number(maxClicks.trim()) : undefined };
    try {
      let link;
      if (mode === 'text') link = await store.createText({ ...options, text, format });
      else {
        upload.current = new AbortController();
        setProgress(0);
        link = await store.createFile(file, options, (sent, total) => setProgress(sent / total), upload.current.signal);
      }
      const ok = await copyText(link.shortUrl);
      toasts.success(t(ok ? 'created.copied' : 'created.ready'), { detail: stripScheme(link.shortUrl) });
      setText('');
      setFile(null);
      setSlug('');
      setTitle('');
      setTags([]);
      setMaxClicks('');
      setNote('');
      setExpiry({ preset: 'never' });
    } catch (err) {
      if (err.name === 'AbortError') toasts.show(t('share.canceled'));
      else fail(err.code ?? 'unknown');
    } finally {
      setBusy(false);
      setProgress(null);
      upload.current = null;
    }
  }

  const hasFiles = (e) => e.dataTransfer?.types.includes('Files') ?? false;

  return (
    <>
      <form className={cx('cmp', 'cmp-share', mode, error?.field === 'main' && 'invalid', dragging && 'dragging')} onSubmit={submit} noValidate>
        <fieldset className="r7-lock" disabled={busy}><legend className="sr-only">{t("create.label")}</legend>
        {mode === 'text' ? (
          <>
            <label className="sr-only" htmlFor={`${id}-body`}>
              {t('share.textLabel')}
            </label>
            <textarea
              ref={area}
              value={text}
              id={`${id}-body`}
              className={cx('cmp-body', format === 'code' && 'mono')}
              rows={5}
              placeholder={t('share.textPlaceholder')}
              spellCheck={format === 'plain'}
              autoCapitalize="off"
              aria-invalid={error?.field === 'main' || undefined}
              aria-describedby={error ? `${id}-error` : note ? `${id}-note` : undefined}
              onChange={(e) => {
                setText(e.target.value);
                if (error?.field === 'main') setError(null);
                setNote('');
              }}
              onKeyDown={(e) => {
                if (modEnter(e)) {
                  e.preventDefault();
                  submit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  area.current?.blur();
                }
              }}
            ></textarea>
          </>
        ) : (
          <div
            className="cmp-drop"
            role="group"
            aria-label={t('create.file')}
            onDragEnter={(e) => hasFiles(e) && setDragging(true)}
            onDragOver={(e) => {
              if (!hasFiles(e) || !filesOn) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
            }}
            onDrop={(e) => {
              setDragging(false);
              const f = e.dataTransfer?.files[0];
              if (!f || !filesOn) return;
              e.preventDefault();
              e.stopPropagation();
              fillFile(f);
            }}
          >
            {!filesOn ? (
              <p className="cmp-off">
                <Icon name="lock" size={16} />
                {t('share.fileDisabled')} <a href={lang==='zh'?'https://sani.zsh.moe/guide/deploy#files-domain':'https://sani.zsh.moe/en/guide/deploy#files-domain'} target="_blank" rel="noopener">{lang==='zh'?'查看配置方法':'Configuration guide'}</a>
              </p>
            ) : file ? (
              <>
                <div className="cmp-picked">
                  <span className="cmp-ficon">
                    <Icon name="file" size={18} />
                  </span>
                  <span className="cmp-finfo">
                    <span className="cmp-fname">{file.name}</span>
                    <span className="cmp-fmeta">
                      {`${+(file.size / 1000000).toFixed(2)} MB`}
                      {file.size > 25000000 ? (lang === 'zh' ? ' · 自动分片' : ' · Chunked upload') : ''}
                    </span>
                  </span>
                  {busy && progress !== null ? null : (
                    <button
                      type="button"
                      className="cmp-x"
                      aria-label={t('share.fileRemove')}
                      disabled={busy}
                      onClick={() => {
                        setFile(null);
                        setNote('');
                        requestAnimationFrame(() => chooser.current?.focus());
                      }}
                    >
                      <Icon name="x" />
                    </button>
                  )}
                </div>
                {progress !== null && (
                  <div className="cmp-progress" role="progressbar" aria-label={t('share.uploading', { pct })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                    <span style={{ width: `${pct}%` }}></span>
                  </div>
                )}
              </>
            ) : (
              <div className="cmp-empty">
                <Icon name="upload" size={18} />
                <span>
                  {t('share.fileDrop')}{' '}
                  <button ref={chooser} type="button" className="cmp-choose" onClick={() => picker.current?.click()}>
                    {t('share.fileChoose')}
                  </button>
                </span>
                <span className="cmp-limit">{t('share.fileLimit', { max: `${maxFile / 1000000} MB` })}</span>
              </div>
            )}
            <input
              ref={picker}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) fillFile(f);
                e.target.value = '';
              }}
            />
          </div>
        )}
        <div className="cmp-options">
          {mode === 'text' && (
            <Segmented
              size="sm"
              label={t('share.format')}
              value={format}
              onChange={setFormat}
              options={[
                { value: 'plain', label: t('format.plain') },
                { value: 'code', label: t('format.code') },
              ]}
            />
          )}
          <SlugField id={`${id}-slug`} value={slug} onChange={setSlug} status={slugStatus} prefix={prefix} placeholder={t('composer.slugAuto')} onEnter={() => submit()} />
          <span className="cmp-gap"></span>
          {mode === 'text' && text && (
            <span className={cx('cmp-count', bytes > maxText && 'over')}>
              {formatSize(bytes)} / {formatSize(maxText)}
            </span>
          )}
          <ExpiryPicker value={expiry} onChange={setExpiry} triggerClass="opt" />
          <button type="button" className="opt" aria-expanded={more} aria-controls={`${id}-more`} onClick={() => setMore(!more)}>
            {more ? t('composer.less') : t('composer.more')}{!more && (title || maxClicks) && <span className="r7-more-count"> · {[title,maxClicks].filter(Boolean).length}</span>}
            <Icon name="chevronDown" size={14} className={cx('chev', more && 'up')} />
          </button>
          <button className="cmp-go" type="submit" disabled={busy || (mode === 'file' && !filesOn)} aria-busy={busy || undefined}>
            {busy && <span className="cmp-spinner" aria-hidden="true"></span>}
            {busy && progress !== null ? t('share.uploading', { pct }) : mode === 'file' && error?.text === errorText('network') ? (lang === 'zh' ? '重试上传' : 'Retry upload') : t('share.submit')}
            {mode === 'text' && !busy && (
              <kbd className="cmp-go-kbd" aria-hidden="true">
                {mod}↵
              </kbd>
            )}
          </button>
        </div>
        <TagPicker value={tags} onChange={setTags} store={store} disabled={busy || (mode === 'file' && !filesOn)} />
        {more && (
          <div className="cmp-more" id={`${id}-more`}>
            <label className="cmp-cell cmp-grow">
              <span className="k">{t('composer.title')}</span>
              <input className="cmp-inline" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('share.optional')} maxLength={300} />
            </label>
            <label className="cmp-cell">
              <span className="k">{t('composer.maxClicks')}</span>
              <input
                className="cmp-inline cmp-num"
                value={maxClicks}
                onChange={(e) => setMaxClicks(e.target.value)}
                inputMode="numeric"
                placeholder={t('composer.noLimit')}
                aria-invalid={error?.field === 'more' || undefined}
              />
            </label>
          </div>
        )}
        {maxClicks && <div className="r7-rules"><p>{mode === 'text' ? lang === 'zh' ? '打开分享页与访问原始文本分别消耗次数。' : 'Opening the share page and raw text each uses one visit.' : lang === 'zh' ? '按有效下载请求计数，不等同于完整下载人数。' : 'Counts eligible download requests, not completed downloads.'}</p>{maxClicks === '1' && <p>{lang === 'zh' ? '一次有效访问，不会自动销毁内容。' : 'One visit does not destroy the content.'}</p>}</div>}
        </fieldset>
        {busy && <div className="r7-rules" role="status">{lang === 'zh' ? '正在提交，输入内容已暂时锁定。' : 'Submitting. Inputs are temporarily locked.'}{mode === 'file' && <Button size="sm" onClick={() => upload.current?.abort()}>{t('share.cancel')}</Button>}</div>}
      </form>
      {error ? (
        <p className="cmp-problem" id={`${id}-error`} role="alert">
          <Icon name="alert" size={14} />
          {error.text}
        </p>
      ) : note ? (
        <p className="cmp-note" id={`${id}-note`}>
          {note}
        </p>
      ) : null}
    </>
  );
});

/* ---- Creator.svelte ---- */

const creatorModes = [
  { kind: 'url', icon: 'link' },
  { kind: 'text', icon: 'text' },
  { kind: 'file', icon: 'file' },
];

const Creator = forwardRef(function Creator({ store, toasts, config, initialMode = 'url', initial = {} }, handle) {
  const { t } = useI18n();
  const [mode, setMode] = useS(initialMode);
  const url = useR(null);
  const texts = useR(null);
  const files = useR(null);
  const show = (kind) => new Promise((r) => (setMode(kind), requestAnimationFrame(r)));

  useImperativeHandle(handle, () => ({
    fill: async (u, how) => (await show('url'), url.current?.fill(u, how)),
    fillText: async (s) => (await show('text'), texts.current?.fillText(s)),
    fillFile: async (f) => (await show('file'), files.current?.fillFile(f)),
    focus: () => (mode === 'url' ? url.current : mode === 'text' ? texts.current : files.current)?.focus(),
  }));

  function onKeyDown(e) {
    const i = creatorModes.findIndex((m) => m.kind === mode);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % creatorModes.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + creatorModes.length) % creatorModes.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = creatorModes.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setMode(creatorModes[next].kind);
    requestAnimationFrame(() => document.getElementById(`create-tab-${creatorModes[next].kind}`)?.focus());
  }

  return (
    <section className="creator" aria-label={t('create.label')}>
      <div className="cr-tabs" role="tablist" aria-label={t('create.label')} tabIndex={-1} onKeyDown={onKeyDown}>
        {creatorModes.map((m) => (
          <button
            key={m.kind}
            type="button"
            role="tab"
            id={`create-tab-${m.kind}`}
            aria-selected={mode === m.kind}
            aria-controls={`create-panel-${m.kind}`}
            tabIndex={mode === m.kind ? 0 : -1}
            onClick={() => setMode(m.kind)}
          >
            <Icon name={m.icon} size={14} />
            {t(`create.${m.kind}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="create-panel-url" aria-labelledby="create-tab-url" hidden={mode !== 'url'} inert={mode !== 'url' ? "" : undefined} aria-hidden={mode !== 'url' ? true : undefined}>
        <Composer ref={url} store={store} toasts={toasts} initial={initialMode === 'url' ? initial : {}} />
      </div>
      <div role="tabpanel" id="create-panel-text" aria-labelledby="create-tab-text" hidden={mode !== 'text'} inert={mode !== 'text' ? "" : undefined} aria-hidden={mode !== 'text' ? true : undefined}>
        <ShareComposer ref={texts} mode="text" store={store} toasts={toasts} config={config} initial={initialMode === 'text' ? initial : {}} />
      </div>
      <div role="tabpanel" id="create-panel-file" aria-labelledby="create-tab-file" hidden={mode !== 'file'} inert={mode !== 'file' ? "" : undefined} aria-hidden={mode !== 'file' ? true : undefined}>
        <ShareComposer ref={files} mode="file" store={store} toasts={toasts} config={config} initial={initialMode === 'file' ? initial : {}} />
      </div>
    </section>
  );
});

/* ---- Summary.svelte ---- */

function Summary({ overview: o }) {
  const { t, formatNumber } = useI18n();
  if (o && o.links === 0) return null;
  return (
    <section className="sum" aria-label={t('summary.chart')}>
      <dl>
        <div>
          <dt>{t('summary.links')}</dt>
          <dd>{o ? formatNumber(o.links) : '–'}</dd>
        </div>
        <div>
          <dt>{t('summary.clicks')}</dt>
          <dd>{o ? formatNumber(o.clicks) : '–'}</dd>
        </div>
        <div>
          <dt>{t('summary.today')}</dt>
          <dd>{o ? formatNumber(o.today) : '–'}</dd>
        </div>
        {o && o.clicks > 0 && (
          <div className="sum-trend">
            <dt>{t('summary.last30')}</dt>
            <dd>
              <MiniBars days={o.days} label={t('summary.chart')} />
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/* ---- LinkRow.svelte ---- */

const statusIcon = { disabled: 'pause', expired: 'clock', exhausted: 'gauge' };

function LinkRow({ link, store, toasts }) {
  const { t, formatCompact, formatNumber } = useI18n();
  const expanded = store.expandedId === link.id;
  const selected = store.selectedId === link.id;
  const picked = store.picked.has(link.id);
  const fresh = store.fresh.has(link.id);
  const parts = displayParts(link.url);
  const spark = link.spark ?? new Array(14).fill(0);
  const sparkTotal = spark.reduce((a, b) => a + b, 0);
  const shared = link.kind !== 'url' && link.content ? link.content : null;
  const sharedTitle = link.title || shared?.preview || shared?.name || link.slug;
  let sharedInfo = '';
  if (shared) {
    if (link.kind === 'text') sharedInfo = [shared.format === 'code' ? t('format.code') : t('format.plain'), t('share.lines', { n: shared.lines ?? 0 }), formatSize(shared.size)].join(' · ');
    else sharedInfo = [link.title ? shared.name : mediaType(shared.type), formatSize(shared.size)].filter(Boolean).join(' · ');
  }
  const [copied, setCopied] = useS(false);

  function toggle(e) {
    if (getSelection()?.toString()) return;
    store.setSelected(link.id);
    if (store.picking) return store.togglePick(link.id, e.shiftKey);
    if (expanded) {
      store.setExpanded(null);
      store.setEditing(null);
    } else store.setExpanded(link.id);
  }

  async function copy() {
    if (await copyText(link.shortUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      toasts.success(t('act.copied'), { detail: stripScheme(link.shortUrl) });
    }
  }

  return (
    <div className={cx('lr', expanded && 'expanded', selected && 'selected', fresh && 'fresh', picked && 'picked', link.status !== 'active' && 'inactive')} data-link={link.id}>
      <div className="lr-line" onClick={toggle}>
        {store.picking && (
          <span className={cx('lr-box', picked && 'on')} aria-hidden="true">
            {picked && <Icon name="check" size={12} stroke={2.25} />}
          </span>
        )}
        <button
          className="lr-main"
          role={store.picking ? 'checkbox' : undefined}
          aria-checked={store.picking ? picked : undefined}
          aria-expanded={store.picking ? undefined : expanded}
          aria-controls={store.picking ? undefined : `detail-${link.id}`}
          onFocus={() => store.setSelected(link.id)}
        >
          <span className="lr-slug">
            <span className={cx('lr-slash', shared && 'shared')}>{shared ? '/p/' : '/'}</span>
            {link.slug}
          </span>
          <span className="lr-target">
            <span className="lr-title-line">
              {shared ? (
                <>
                  <span className="lr-kind">
                    <Icon name={link.kind === 'text' ? 'text' : 'file'} size={14} />
                  </span>
                  <span className={cx('lr-title', !link.title && link.kind === 'text' && 'lr-excerpt')}>{sharedTitle}</span>
                </>
              ) : (
                <>
                  <Favicon host={link.host} icon={link.icon} size={14} />
                  {link.title ? (
                    <span className="lr-title">{link.title}</span>
                  ) : link.meta === 'pending' ? (
                    <span className="lr-title lr-pending" aria-label={t('detail.fetching')}></span>
                  ) : (
                    <span className="lr-title lr-untitled">{parts.host || link.url}</span>
                  )}
                </>
              )}
              {link.status !== 'active' && (
                <span className="lr-badge">
                  <Icon name={statusIcon[link.status]} size={12} />
                  {t(`status.${link.status}`)}
                </span>
              )}
            </span>
            <span className="lr-dest">
              {shared ? (
                sharedInfo
              ) : link.title || link.meta === 'pending' ? (
                <>
                  <span className="host">{parts.host}</span>
                  <span className="rest">{parts.rest}</span>
                </>
              ) : parts.host ? (
                <span className="rest">{parts.rest || '/'}</span>
              ) : null}
            </span>
          </span>
          <span className="lr-tags"><TagList ids={link.tags} tags={store.tags} limit={2} /></span>
        </button>
        <span className="lr-spark">
          <Sparkline values={spark} label={t('list.spark', { n: sparkTotal })} />
        </span>
        <span className="lr-clicks">
          {formatCompact(link.clicks)}
        </span>
        <button
          className={cx('lr-copy', copied && 'done')}
          aria-label={t('list.copyShort')}
          onClick={(e) => {
            e.stopPropagation();
            copy();
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} stroke={copied ? 2 : 1.5} />
        </button>
      </div>
      {expanded && <LinkDetail link={link} store={store} toasts={toasts} />}
    </div>
  );
}

/* ---- LinkDetail.svelte ---- */

function LinkDetail({ link, store, toasts, initialRange = 30 }) {
  const { t, lang, formatNumber, formatRelative, formatDateTime } = useI18n();
  const editing = store.editingId === link.id;
  const [range, setRange] = useS(initialRange);
  const stats = store.linkStats(link.id, range);
  const body = link.kind === 'text' ? store.linkText(link.id) : null;
  const today = stats.days[stats.days.length - 1].count;
  const visitsLabel = link.kind === 'text' ? t('detail.views') : link.kind === 'file' ? t('detail.downloads') : t('detail.clicks');
  const redirectLabel = link.redirect === 301 || link.redirect === 308 ? t('redirect.301') : t('redirect.302');
  const [refetching, setRefetching] = useS(false);
  const copy = async (text, msg = t('act.copied'), detail = stripScheme(text)) => (await copyText(text)) && toasts.success(msg, { detail });

  if (editing)
    return (
      <div className="ld" id={`detail-${link.id}`}>
        <LinkEditor link={link} store={store} toasts={toasts} />
      </div>
    );

  return (
    <div className="ld" id={`detail-${link.id}`}>
      <div className="ld-grid">
        <div className="ld-main">
          <div className="ld-short">
            <a className="ld-short-url" href={link.shortUrl} target="_blank" rel="noopener">
              {stripScheme(link.shortUrl)}
            </a>
            <div className="ld-short-actions">
              <Button size="sm" icon="copy" onClick={() => copy(link.shortUrl)}>
                {t('act.copy')}
              </Button>
              <Button size="sm" icon="open" onClick={() => open(link.shortUrl, '_blank', 'noopener')}>
                {t('act.open')}
              </Button>
            </div>
          </div>
          {link.kind === 'text' && link.content ? (
            <section className="ld-content" aria-label={t('detail.text')}>
              <div className="ld-content-head">
                <span className="ld-content-meta">
                  {link.content.format === 'code' ? t('format.code') : t('format.plain')} · {t('share.lines', { n: link.content.lines ?? 0 })} · {formatSize(link.content.size)}
                </span>
                <Button size="sm" variant="ghost" icon="copy" disabled={body === null} onClick={async () => (await copyText(body)) && toasts.success(t('share.textCopied'))}>
                  {t('share.copyText')}
                </Button>
              </div>
              <pre className={cx('ld-preview', link.content.format === 'code' && 'code')} tabIndex={0}>
                {body ?? t('share.loading')}
              </pre>
            </section>
          ) : link.kind === 'file' && link.content ? (
            <section className="ld-content file" aria-label={t('detail.file')}>
              <span className="ld-ficon">
                <Icon name="file" size={18} />
              </span>
              <span className="ld-finfo">
                <span className="ld-fname">{link.content.name}</span>
                <span className="ld-fmeta">
                  {mediaType(link.content.type)} · {formatSize(link.content.size)}
                </span>
                <span className="ld-sum">
                  SHA-256 {link.content.sha256?.slice(0, 16)}…
                </span>
              </span>
              {link.content.rawUrl && (
                <Button size="sm" variant="ghost" icon="link" onClick={() => copy(link.content.rawUrl)}>
                  {t('share.copyRaw')}
                </Button>
              )}
            </section>
          ) : (
            <p className="ld-dest">
              <span className="ld-dest-k">{t('detail.destination')}</span>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.url}
              </a>
            </p>
          )}

          {!!link.tags?.length && <div className="tag-detail"><span>{tagText(lang, 'label')}</span><TagList ids={link.tags} tags={store.tags} /></div>}
          <div className="ld-stats-head">
            <dl className="ld-figs">
              <div>
                <dt>{visitsLabel}</dt>
                <dd>{formatNumber(link.clicks)}</dd>
              </div>
              <div>
                <dt>{t('detail.today')}</dt>
                <dd>{formatNumber(today)}</dd>
              </div>
              <div>
                <dt>{t('detail.lastVisit')}</dt>
                <dd className="soft">{link.lastClickAt ? formatRelative(link.lastClickAt) : t('detail.never')}</dd>
              </div>
            </dl>
            <Segmented size="sm" label={t('detail.chart')} value={range} onChange={setRange} options={[7, 30, 90].map((n) => ({ value: n, label: t('detail.days', { n }) }))} />
          </div>

          <BarChart days={stats.days} label={t('detail.chart')} empty={t('detail.noVisits')} />
          {stats.referrers.length > 0 && (
            <section className="ld-refs">
              <h2>{t('detail.referrers')}</h2>
              <ul>
                {stats.referrers.map((r) => {
                  const share = stats.referrersTotal ? r.count / stats.referrersTotal : 0;
                  return (
                    <li key={r.host}>
                      <span className={cx('host', (!r.host || r.host === '*') && 'direct')}>{r.host === '*' ? t('detail.otherSites') : r.host || t('detail.direct')}</span>
                      <span className="n">{formatNumber(r.count)}</span>
                      <span className="pct">{Math.round(share * 100)}%</span>
                      <span className="ld-track" aria-hidden="true">
                        <span className="ld-fill" style={{ width: `${Math.max(1, share * 100)}%` }}></span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <aside className="ld-side">
          <div className="ld-qr">
            <QRCode value={link.shortUrl} size={116} label={t('detail.qrLabel', { url: stripScheme(link.shortUrl) })} />
            <div className="ld-qr-actions">
              <Button size="sm" variant="ghost" icon="download">
                PNG
              </Button>
              <Button size="sm" variant="ghost">
                SVG
              </Button>
            </div>
          </div>
          <dl className="ld-meta">
            <div>
              <dt>{t('detail.created')}</dt>
              <dd>{formatDateTime(link.createdAt)}</dd>
            </div>
            <div>
              <dt>{t('detail.expires')}</dt>
              <dd className={link.status === 'expired' ? 'warn' : ''}>{link.expiresAt ? formatDateTime(link.expiresAt) : t('expiry.never')}</dd>
            </div>
            <div>
              <dt>{t('detail.limit')}</dt>
              <dd className={link.status === 'exhausted' ? 'warn' : ''}>
                {link.maxClicks ? t('detail.used', { n: formatNumber(Math.min(link.clicks, link.maxClicks)), max: formatNumber(link.maxClicks) }) : t('composer.noLimit')}
              </dd>
            </div>
            {link.kind === 'url' && (
              <div>
                <dt>{t('detail.redirect')}</dt>
                <dd>
                  {redirectLabel} <span className="ld-code">{link.redirect}</span>
                </dd>
              </div>
            )}
          </dl>
        </aside>
      </div>

      <footer className="ld-actions">
        <Button size="sm" icon="edit" onClick={() => store.setEditing(link.id)}>
          {t('act.edit')}
          <kbd>E</kbd>
        </Button>
        <Button size="sm" variant="ghost" icon={link.enabled ? 'pause' : 'power'} onClick={() => store.setEnabled(link, !link.enabled)}>
          {link.enabled ? t('detail.disable') : t('detail.enable')}
        </Button>
        {link.meta !== 'manual' && (
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            loading={refetching}
            onClick={() => {
              setRefetching(true);
              setTimeout(() => setRefetching(false), 900);
            }}
          >
            {refetching ? t('detail.fetching') : t('detail.refetch')}
          </Button>
        )}
        <span className="ld-spacer"></span>
        <Button size="sm" variant="danger" icon="trash" onClick={() => store.remove(link)}>
          {t('act.delete')}
        </Button>
      </footer>
    </div>
  );
}

/* ---- LinkEditor.svelte ---- */

function LinkEditor({ link, store, toasts }) {
  const { t } = useI18n();
  const isURL = link.kind === 'url';
  const isText = link.kind === 'text';
  const start = React.useMemo(
    () => ({
      url: link.url,
      text: isText ? store.linkText(link.id) : '',
      format: link.content?.format ?? 'plain',
      slug: link.slug,
      title: link.meta === 'manual' || link.meta === 'ok' ? link.title : '',
      tags: [...(link.tags ?? [])],
      expiry: fromISO(link.expiresAt),
      maxClicks: link.maxClicks ? String(link.maxClicks) : '',
      redirect: link.redirect,
      enabled: link.enabled,
    }),
    [link.id],
  );
  const [form, setForm] = useS(start);
  const upd = (patch) => setForm((f) => ({ ...f, ...patch }));
  const slugStatus = useSlugStatus(form.slug, link.slug);
  const [saving, setSaving] = useS(false);
  const [errors, setErrors] = useS({});
  const field = useR(null);
  const prefix = shortHost + (isURL ? '' : '/p');
  const renamed = form.slug.trim() !== '' && !sameSlug(form.slug.trim(), start.slug);

  function patch() {
    const p = {};
    if (isURL && form.url.trim() !== start.url) p.url = form.url.trim();
    if (isText && form.text !== start.text) p.text = form.text;
    if (isText && form.format !== start.format) p.format = form.format;
    if (form.slug.trim() !== start.slug) p.slug = form.slug.trim();
    if (form.title.trim() !== start.title) p.title = form.title.trim();
    if (JSON.stringify(form.tags) !== JSON.stringify(start.tags)) p.tags = form.tags;
    if (JSON.stringify(form.expiry) !== JSON.stringify(start.expiry)) p.expiresAt = 'at' in form.expiry ? new Date(form.expiry.at).toISOString() : null;
    const limit = form.maxClicks.trim();
    if (limit !== start.maxClicks) p.maxClicks = limit ? Number(limit) : null;
    if (isURL && form.redirect !== start.redirect) p.redirect = form.redirect;
    if (form.enabled !== start.enabled) p.enabled = form.enabled;
    return p;
  }
  const dirty = Object.keys(patch()).length > 0;

  function autosize() {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, isText ? innerHeight * 0.5 : Infinity)}px`;
  }
  useE(() => {
    autosize();
    field.current?.focus();
  }, []);

  React.useEffect(() => { if (store.editorGuard) store.editorGuard.current = {dirty, save}; return () => { if (store.editorGuard) store.editorGuard.current = null; }; });
  const cancel = () => store.setEditing(null);
  async function save() {
    if (saving) return;
    setErrors({});
    if (isURL && !form.url.trim()) return setErrors({ url: t('err.url_required') });
    if (isText && !form.text.trim()) return setErrors({ text: t('err.text_required') });
    if (!form.slug.trim()) return setErrors({ slug: t('err.slug_invalid') });
    if (blocking.includes(slugStatus)) return setErrors({ slug: t(`slug.${slugStatus}`) });
    if (form.maxClicks.trim() && !/^[1-9]\d*$/.test(form.maxClicks.trim())) return setErrors({ maxClicks: t('err.max_clicks_invalid') });
    const p = patch();
    if (!Object.keys(p).length) { store.finishEdit?.(); return true; }
    setSaving(true);
    try {
      await store.update(link.id, p);
      store.finishEdit ? store.finishEdit() : store.setEditing(null);
      toasts.success(t('detail.saved'));
      return true;
    } catch (e) {
      const code = e.code ?? 'unknown';
      const text = store.errorText(code);
      if (code.startsWith('url_')) setErrors({ url: text });
      else if (code.startsWith('text_')) setErrors({ text });
      else if (code.startsWith('slug_')) setErrors({ slug: text });
      else if (code === 'max_clicks_invalid') setErrors({ maxClicks: text });
      else setErrors({ other: text });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="le"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => {
        if (modEnter(e)) {
          e.preventDefault();
          save();
        } else if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
    >
      {isURL ? (
        <div className="le-cell le-wide">
          <label className="label" htmlFor={`edit-url-${link.id}`}>
            {t('detail.destination')}
          </label>
          <textarea
            ref={field}
            id={`edit-url-${link.id}`}
            className="field mono le-url"
            rows={1}
            value={form.url}
            onChange={(e) => (upd({ url: e.target.value }), autosize())}
            spellCheck="false"
            autoCapitalize="off"
            aria-invalid={!!errors.url || undefined}
          ></textarea>
          {errors.url && <p className="error-text">{errors.url}</p>}
        </div>
      ) : isText ? (
        <div className="le-cell le-wide">
          <div className="le-text-head">
            <label className="label" htmlFor={`edit-text-${link.id}`}>
              {t('detail.text')}
            </label>
            <Segmented
              size="sm"
              label={t('share.format')}
              value={form.format}
              onChange={(v) => upd({ format: v })}
              options={[
                { value: 'plain', label: t('format.plain') },
                { value: 'code', label: t('format.code') },
              ]}
            />
          </div>
          <textarea
            ref={field}
            id={`edit-text-${link.id}`}
            className={cx('field', 'le-body', form.format === 'code' && 'mono')}
            rows={6}
            value={form.text}
            onChange={(e) => (upd({ text: e.target.value }), autosize())}
            spellCheck={form.format === 'plain'}
            aria-invalid={!!errors.text || undefined}
          ></textarea>
          {errors.text && <p className="error-text">{errors.text}</p>}
        </div>
      ) : null}

      <div className="le-cell">
        <label className="label" htmlFor={`edit-slug-${link.id}`}>
          {t('composer.slug')}
        </label>
        <SlugField id={`edit-slug-${link.id}`} variant="boxed" value={form.slug} onChange={(v) => upd({ slug: v })} status={slugStatus} prefix={prefix} />
        {errors.slug ? <p className="error-text">{errors.slug}</p> : renamed ? <p className="hint warn">{t('slug.renameWarn')}</p> : null}
      </div>

      <div className="le-cell">
        <label className="label" htmlFor={`edit-title-${link.id}`}>
          {t('composer.title')}
        </label>
        <input id={`edit-title-${link.id}`} className="field" value={form.title} onChange={(e) => upd({ title: e.target.value })} placeholder={isURL ? t('composer.titleAuto') : t('share.optional')} maxLength={300} />
      </div>

      <div className="le-wide"><TagPicker value={form.tags} onChange={tags => upd({ tags })} store={store} disabled={saving} framed /></div>
      <div className="le-cell">
        <span className="label">{t('composer.expiry')}</span>
        <ExpiryPicker value={form.expiry} onChange={(v) => upd({ expiry: v })} triggerClass="field picker-field" showLabel={false} />
      </div>

      <div className="le-cell">
        <label className="label" htmlFor={`edit-limit-${link.id}`}>
          {t('composer.maxClicks')}
        </label>
        <input
          id={`edit-limit-${link.id}`}
          className="field tnum"
          value={form.maxClicks}
          onChange={(e) => upd({ maxClicks: e.target.value })}
          inputMode="numeric"
          placeholder={t('composer.noLimit')}
          aria-invalid={!!errors.maxClicks || undefined}
        />
        {errors.maxClicks && <p className="error-text">{errors.maxClicks}</p>}
      </div>

      {isURL && (
        <div className="le-cell">
          <span className="label">{t('composer.redirect')}</span>
          <Segmented
            size="field"
            label={t('composer.redirect')}
            value={form.redirect === 308 ? 301 : form.redirect === 307 ? 302 : form.redirect}
            onChange={(v) => upd({ redirect: v })}
            options={[
              { value: 302, label: t('redirect.302') },
              { value: 301, label: t('redirect.301') },
            ]}
          />
          <p className="hint">{t('redirect.hint')}</p>
        </div>
      )}

      <div className="le-cell le-switch-row">
        <div className="le-switch-line">
          <Switch id={`edit-enabled-${link.id}`} checked={form.enabled} onChange={(v) => upd({ enabled: v })} label={t('detail.enabled')} />
          <label className="le-switch-label" htmlFor={`edit-enabled-${link.id}`}>
            {t('detail.enabled')}
          </label>
        </div>
        <p className="hint">{t('detail.enabledHint')}</p>
      </div>

      <footer className="le-foot le-wide">
        {errors.other && <p className="error-text">{errors.other}</p>}
        <span className="le-spacer"></span>
        <span className="le-kbd-hint">
          <kbd>{mod}</kbd>
          <kbd>↵</kbd>
        </span>
        <Button size="sm" variant="ghost" onClick={cancel}>
          {t('act.cancel')}
        </Button>
        <Button size="sm" variant="primary" type="submit" loading={saving} disabled={!dirty}>
          {t('act.save')}
        </Button>
      </footer>
    </form>
  );
}

/* ---- LinkList.svelte ---- */

const listSorts = ['created', 'clicks', 'visited'];
const listKinds = [null, 'url', 'text', 'file'];
const kindIcon = { url: 'link', text: 'text', file: 'file' };

function withKeys(text, keys) {
  return text.split(/(\{\w+\})/).map((part) => {
    const m = part.match(/^\{(\w+)\}$/);
    return m && keys[m[1]] ? { keys: keys[m[1]] } : { text: part };
  });
}

const LinkList = forwardRef(function LinkList({ store, toasts, slowLoad = true }, handle) {
  const { t, lang } = useI18n();
  const search = useR(null);
  const [focused, setFocused] = useS(false);
  useImperativeHandle(handle, () => ({ focusSearch: () => (search.current?.focus(), search.current?.select()) }));

  const s = store;
  const pickable = s.items.slice(0, MAX_PICK);
  const allPicked = pickable.length > 0 && pickable.every((l) => s.picked.has(l.id));
  const nonePicked = s.picked.size === 0;
  const empty = s.loaded && s.items.length === 0;
  const blank = empty && !s.query && !s.kind && !s.tag;
  const keyed = (text, keys) =>
    withKeys(text, keys).map((part, i) => (part.keys ? part.keys.map((k) => <kbd key={`${i}${k}`}>{k}</kbd>) : <React.Fragment key={i}>{part.text}</React.Fragment>));

  return (
    <section className="ll" aria-label={t('list.label')}>
      <TagFilters store={s} />
      <ListStatus store={s}/>
      {!blank && (
        <div className="ll-toolbar">
          <label className={cx('ll-search', (focused || s.query) && 'active')}>
            <Icon name="search" />
            <span className="sr-only">{t('list.search')}</span>
            <input
              ref={search}
              type="search"
              placeholder={t('list.search')}
              value={s.query}
              onChange={(e) => s.search(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  if (s.query) s.search('');
                  else search.current?.blur();
                } else if (e.key === 'ArrowDown' && s.items.length) {
                  e.preventDefault();
                  s.setSelected(s.items[0].id);
                  search.current?.blur();
                  document.querySelector(`[data-link="${s.items[0].id}"] .lr-main`)?.focus();
                }
              }}
              autoComplete="off"
              spellCheck="false"
            />
            {s.query ? (
              <button className="ll-clear" aria-label={t('list.clearSearch')} onClick={() => (s.search(''), search.current?.focus())}>
                <Icon name="x" size={14} />
              </button>
            ) : (
              !focused && (
                <kbd className="ll-slash" aria-hidden="true">
                  /
                </kbd>
              )
            )}
          </label>
          {(s.query || s.tag || s.kind) && s.loaded && !s.queryFailed && !s.loading && (
            <span className="ll-count" aria-live="polite">
              {t('list.results', { n: s.total })}
            </span>
          )}
          <button
            className={cx('ll-pick', s.picking && 'on')}
            disabled={s.queryFailed || s.loading}
            aria-pressed={s.picking}
            aria-label={t('bulk.startLabel')}
            onClick={() => (s.picking ? s.stopPicking() : s.startPicking())}
          >
            <Icon name="select" size={14} />
            <span className="ll-pick-text">{t('bulk.start')}</span>
          </button>
          <Menu
            triggerClass={cx('kind', s.kind && 'on')}
            label={t('filter.label')}
            align="end"
            minWidth={160}
            button={() => (
              <>
                <Icon name={s.kind ? kindIcon[s.kind] : 'sliders'} size={14} />
                <span className="ll-kind-text">{t(`filter.${s.kind ?? 'all'}`)}</span>
              </>
            )}
          >
            {(close) =>
              listKinds.map((k) => (
                <MenuItem
                  key={k ?? 'all'}
                  icon={k ? kindIcon[k] : undefined}
                  checked={s.kind === k}
                  onClick={() => {
                    s.setKind(k);
                    close();
                  }}
                >
                  {t(`filter.${k ?? 'all'}`)}
                </MenuItem>
              ))
            }
          </Menu>
          <Menu
            triggerClass="sort"
            label={t('list.sortBy')}
            align="end"
            minWidth={160}
            button={() => (
              <>
                <Icon name="sort" size={14} />
                {t(`sort.${s.sort}`)}
              </>
            )}
          >
            {(close) =>
              listSorts.map((x) => (
                <MenuItem
                  key={x}
                  checked={s.sort === x}
                  onClick={() => {
                    s.setSort(x);
                    close();
                  }}
                >
                  {t(`sort.${x}`)}
                </MenuItem>
              ))
            }
          </Menu>
        </div>
      )}

      {s.picking && !empty && !s.queryFailed && !s.loading && (
        <div className="ll-bulkbar" role="group" aria-label={t('bulk.label')}>
          <button className="all" role="checkbox" aria-checked={allPicked ? true : nonePicked ? false : 'mixed'} aria-label={t('bulk.all')} onClick={() => s.togglePickAll()}>
            <span className={cx('ll-box', !nonePicked && 'on')} aria-hidden="true">
              {allPicked ? <Icon name="check" size={12} stroke={2.25} /> : !nonePicked ? <span className="ll-dash"></span> : null}
            </span>
          </button>
          <span className="ll-picked-count" aria-live="polite">
            {nonePicked ? t('bulk.none') : t('bulk.count', { n: s.picked.size })}
          </span>
          <span className="ll-actions">
            <button disabled={nonePicked || s.busy} aria-label={t('bulk.enable')} onClick={() => s.bulk('enable')}>
              <Icon name="power" size={14} />
              <span className="name">{t('bulk.enable')}</span>
            </button>
            <button disabled={nonePicked || s.busy} aria-label={t('bulk.disable')} onClick={() => s.bulk('disable')}>
              <Icon name="pause" size={14} />
              <span className="name">{t('bulk.disable')}</span>
            </button>
            <button className="danger" disabled={nonePicked || s.busy} aria-label={t('bulk.delete')} onClick={() => s.bulk('delete')}>
              <Icon name="trash" size={14} />
              <span className="name">{t('bulk.delete')}</span>
            </button>
          </span>
          <button className="done" onClick={() => s.stopPicking()}>
            {t('bulk.done')}
          </button>
        </div>
      )}

      {s.queryFailed && !s.items.length ? <div className="ll-blank"><p>{lang === 'zh' ? '本次筛选尚未取得结果。' : 'No results have been loaded for this query.'}</p></div> : blank ? (
        <div className="ll-blank">
          {/* r1: a quiet outline of the list to come. */}
          <div className="ll-blank-art" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i}>
                <i></i>
                <i></i>
                <i></i>
              </span>
            ))}
          </div>
          <h2>{t('list.emptyTitle')}</h2>
          <p>{keyed(t('list.emptyBody'), { enter: ['↵'] })}</p>
          <p className="soft">{keyed(t('list.emptyPaste'), { key: [mod, 'V'] })}</p>
        </div>
      ) : empty && s.tag ? (
        <div className="ll-blank">
          <p>{lang === 'zh' ? `标签“${s.tags.find(t=>t.id===s.tag)?.name ?? '未标记'}”${s.query || s.kind ? '下没有符合当前条件的内容' : '下暂无内容'}。` : `No items ${s.query || s.kind ? 'match these filters in' : 'in'} “${s.tags.find(t=>t.id===s.tag)?.name ?? 'Untagged'}”.`}</p>
          <div className="r7-empty-actions">{s.query && <button className="ll-text-btn" onClick={()=>s.search('')}>{lang==='zh'?'清除搜索词':'Clear search'}</button>}{s.kind && <button className="ll-text-btn" onClick={()=>s.setKind(null)}>{lang==='zh'?'移除类型条件':'Remove type filter'}</button>}<button className="ll-text-btn" onClick={()=>s.setTag(null)}>{lang==='zh'?'清除此标签筛选':'Clear this tag filter'}</button></div>
        </div>
      ) : empty && s.query ? (
        <div className="ll-blank">
          <p>{t('list.noResults', { q: s.query })}</p>
          <button className="ll-text-btn" onClick={() => s.search('')}>
            {t('list.clearSearch')}
          </button>
        </div>
      ) : empty ? (
        <div className="ll-blank">
          <p>{t(s.kind === 'text' ? 'list.noneText' : s.kind === 'file' ? 'list.noneFile' : 'list.noneUrl')}</p>
          <button className="ll-text-btn" onClick={() => s.setKind(null)}>
            {t('list.showAll')}
          </button>
        </div>
      ) : s.failed && !s.loaded ? (
        <div className="ll-blank">
          <p>{t('list.loadError')}</p>
          <button className="ll-text-btn" onClick={() => s.load()}>
            {t('act.retry')}
          </button>
        </div>
      ) : !s.loaded ? (
        slowLoad && (
          <div className="ll-card" role="status" aria-busy="true" aria-label={t('list.loading')}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="ll-ghost-row" style={{ '--d': `${i * 90}ms` }}>
                <span className="ll-g ll-g1"></span>
                <span className="ll-g ll-g2"></span>
                <span className="ll-g ll-g3"></span>
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          <div className={cx('ll-card', (s.loading || s.queryFailed) && 'stale')} inert={s.queryFailed || s.loading ? "" : undefined}>
            <div className="ll-head" aria-hidden="true">
              {s.picking && <span className="ll-h-pick"></span>}
              <span className="ll-h-slug">{t('list.col.link')}</span>
              <span className="ll-h-target">{t('list.col.target')}</span>
              <span className="ll-h-tags">{tagText(lang, 'label')}</span>
              <span className="ll-h-spark">{t('list.col.activity')}</span>
              <button className={cx('ll-h-clicks', s.sort === 'clicks' && 'on')} tabIndex={-1} onClick={() => s.setSort('clicks')}>
                {t('list.col.clicks')}
                {s.sort === 'clicks' && <Icon name="chevronDown" size={12} />}
              </button>
              <span className="ll-h-copy"></span>
            </div>
            <ul>
              {s.items.map((link) => (
                <li key={link.id}>
                  <LinkRow link={link} store={s} toasts={toasts} />
                </li>
              ))}
            </ul>
          </div>
          <ListMore store={s}/>
          <div className="ll-sentinel" aria-hidden="true"></div>
        </>
      )}
    </section>
  );
});

/* ---- AppHeader.svelte ---- */

const themeIcon = { system: 'monitor', light: 'sun', dark: 'moon' };

function AppHeader({ route = 'dashboard', theme = 'system', onCycleTheme, onShortcuts, onNavigate, scrolled: forceScrolled }) {
  const { t } = useI18n();
  const [scrolled, setScrolled] = useS(false);
  useE(() => {
    const on = () => setScrolled(scrollY > 4);
    addEventListener('scroll', on);
    return () => removeEventListener('scroll', on);
  }, []);
  const themeName = t(`theme.${theme}`);
  const go = (to) => (e) => {
    if (!onNavigate) return;
    e.preventDefault();
    onNavigate(to);
  };
  return (
    <header className={cx('hd', (forceScrolled ?? scrolled) && 'scrolled')}>
      <div className="hd-inner">
        <a className="hd-brand" href="#dashboard" onClick={go('dashboard')}>
          <Logo />
        </a>
        <nav className="hd-tools" aria-label={t('menu.label')}>
          <button className="hd-tool hd-hide-touch" aria-label={t('menu.shortcuts')} onClick={onShortcuts}>
            <Icon name="keyboard" />
          </button>
          <button className="hd-tool" aria-label={`${t('menu.theme')}: ${themeName}`} onClick={onCycleTheme}>
            <Icon name={themeIcon[theme]} />
          </button>
          <a
            className={cx('hd-tool', route === 'settings' && 'on')}
            href="#settings"
            onClick={go('settings')}
            aria-label={t('menu.settings')}
            aria-current={route === 'settings' ? 'page' : undefined}
          >
            <Icon name="sliders" />
          </a>
        </nav>
      </div>
    </header>
  );
}

/* ---- AuthShell.svelte ---- */

function AuthShell({ theme = 'system', onToggleLang, onCycleTheme, children }) {
  const { t, host } = useI18n();
  return (
    <main className="auth">
      <div className="auth-panel">
        <div className="auth-brand">
          <Logo size={26} />
          <span className="auth-host">{host}</span>
        </div>
        {children}
      </div>
      <footer className="auth-foot">
        <button onClick={onToggleLang}>{t('menu.language')}</button>
        <span className="auth-dot" aria-hidden="true"></span>
        <button onClick={onCycleTheme} aria-label={`${t('menu.theme')}: ${t(`theme.${theme}`)}`}>
          <Icon name={themeIcon[theme]} size={14} />
          {t(`theme.${theme}`)}
        </button>
      </footer>
    </main>
  );
}

/* ---- ShortcutsDialog.svelte ---- */

function ShortcutsDialog({ open, onClose, staticOpen = false }) {
  const { t } = useI18n();
  const rows = [
    [['N'], 'keys.new'],
    [[mod, 'V'], 'keys.paste'],
    [['/'], 'keys.search'],
    [['J', 'K'], 'keys.move'],
    [['↵'], 'keys.toggle'],
    [['C'], 'keys.copy'],
    [['E'], 'keys.edit'],
    [[mod, '↵'], 'keys.save'],
    [isMac ? ['⌘', '⌫'] : ['Del'], 'keys.delete'],
    [['X'], 'keys.pick'],
    [['Esc'], 'keys.escape'],
    [['?'], 'keys.help'],
  ];
  return (
    <Dialog open={open} onClose={onClose} width={400} staticOpen={staticOpen}>
      <dl className="keys">
        {rows.map(([keys, label]) => (
          <div key={label}>
            <dt>{t(label)}</dt>
            <dd>
              {keys.map((k, i) => (
                <React.Fragment key={i}>
                  {i > 0 && label === 'keys.move' && <span className="keys-or">/</span>}
                  <kbd>{k}</kbd>
                </React.Fragment>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

Object.assign(window, {
  copyText,
  Composer,
  ShareComposer,
  Creator,
  Summary,
  LinkRow,
  LinkDetail,
  LinkEditor,
  LinkList,
  AppHeader,
  AuthShell,
  ShortcutsDialog,
  themeIcon,
});
