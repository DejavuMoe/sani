/*
 * R11 access controls: the visit limit and password pickers that sit next to
 * the expiry picker in every composer, the password field in the editor, and
 * the copy helper that puts link and password on the clipboard together.
 * Popovers use the Popover API with role="dialog", like Menu.svelte.
 */
const { useState: useAs, useRef: useAr, useEffect: useAe, useId: useAid } = React;

Object.assign(window.SANI_ICONS, {
  eye: ['M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z', 'M9.75 8a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0z'],
  eyeOff: ['M2.5 2.5l11 11', 'M6.6 4a5.7 5.7 0 0 1 1.4-.25C12 3.75 14.25 8 14.25 8a10 10 0 0 1-1.6 2.1M10.5 11.6A5.6 5.6 0 0 1 8 12.25C4 12.25 1.75 8 1.75 8a10.4 10.4 0 0 1 2.4-2.9', 'M6.8 6.8a1.75 1.75 0 0 0 2.4 2.4'],
});

// Readable characters only: no 0/O, 1/I/L.
const PW_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function genPassword(n = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => PW_ALPHABET[b % PW_ALPHABET.length]).join('');
}
function passwordProblem(s) {
  const n = [...s.trim()].length;
  return n === 0 || (n >= 4 && n <= 64) ? null : 'password_invalid';
}
const PRESET_MS = { '1h': 3600e3, '1d': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 };
function expiryISO(e) {
  if ('at' in e) return new Date(e.at).toISOString();
  return PRESET_MS[e.preset] ? new Date(Date.now() + PRESET_MS[e.preset]).toISOString() : undefined;
}
const limitProblem =(s) => (!s.trim() || /^[1-9]\d*$/.test(s.trim()) ? null : 'max_clicks_invalid');

/** The text that goes on the clipboard for a link, with its password when it has one. */
function shareText(link, t) {
  return link.password ? `${link.shortUrl}\n${t('access.clipPassword', { pw: link.password })}` : link.shortUrl;
}
async function copyShare(link, toasts, t, created = false) {
  const ok = await copyText(shareText(link, t));
  const detail = stripScheme(link.shortUrl) + (link.password ? `  ${t('access.clipPassword', { pw: link.password })}` : '');
  const message = ok ? t(link.password ? 'access.bothCopied' : created ? 'created.copied' : 'act.copied') : t('created.ready');
  toasts.success(message, { detail });
  return ok;
}

function AccessPop({ label, triggerClass, trigger, children, width = 288, onOpen }) {
  const id = 'pop-' + useAid().replace(/:/g, '');
  const btn = useAr(null);
  const pop = useAr(null);
  const [open, setOpen] = useAs(false);
  const close = () => pop.current?.hidePopover?.();
  useAe(() => {
    const el = pop.current;
    const place = () => {
      const r = btn.current.getBoundingClientRect();
      const w = el.offsetWidth, h = el.offsetHeight;
      const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
      let top = r.bottom + 6;
      if (top + h > innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
      el.style.left = `${left}px`;
      el.style.top = `${Math.max(8, top)}px`;
    };
    const ontoggle = (e) => {
      const isOpen = e.newState === 'open';
      setOpen(isOpen);
      if (isOpen) {
        onOpen?.();
        place();
        addEventListener('resize', place);
        addEventListener('scroll', place, true);
      } else {
        removeEventListener('resize', place);
        removeEventListener('scroll', place, true);
        if (el.contains(document.activeElement) || document.activeElement === document.body) btn.current?.focus();
      }
    };
    placeRef.current = place;
    el.addEventListener('toggle', ontoggle);
    return () => { el.removeEventListener('toggle', ontoggle); removeEventListener('resize', place); removeEventListener('scroll', place, true); };
  }, []);
  // The content mounts with `open`, so measure and focus after that commit.
  const placeRef = useAr(null);
  useAe(() => {
    if (!open) return;
    placeRef.current?.();
    pop.current.querySelector('input')?.select();
  }, [open]);
  return (
    <>
      <button ref={btn} type="button" className={triggerClass} popovertarget={id} aria-haspopup="dialog" aria-expanded={open}>
        {trigger}
      </button>
      <div ref={pop} id={id} popover="auto" role="dialog" aria-label={label} className="r11-pop" style={{ width }}>
        {open && children(close)}
      </div>
    </>
  );
}

function PasswordPicker({ value, onChange, id }) {
  const { t, errorText } = useI18n();
  const [draft, setDraft] = useAs(value);
  const [error, setError] = useAs(null);
  const label = t('access.password');
  return (
    <AccessPop
      label={label}
      triggerClass={cx('opt', value && 'set')}
      onOpen={() => { setDraft(value || genPassword()); setError(null); }}
      trigger={<><Icon name="lock" size={14} />{value ? <span className="r11-code">{value}</span> : t('access.noPassword')}</>}
    >
      {(close) => {
        const done = () => {
          const p = passwordProblem(draft);
          if (p) return setError(errorText(p));
          onChange(draft.trim());
          close();
        };
        return (
          <div className="r11-pop-body" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.stopPropagation(); done(); } }}>
            <label className="r11-pop-title" htmlFor={`${id}-pw`}>{label}</label>
            <div className={cx('r11-pw', error && 'invalid')}>
              <input id={`${id}-pw`} className="r11-code" value={draft} maxLength={64} spellCheck="false" autoComplete="off" autoCapitalize="off"
                aria-invalid={!!error || undefined} aria-describedby={error ? `${id}-pw-error` : undefined}
                onChange={(e) => { setDraft(e.target.value); setError(null); }} />
              <Button size="sm" variant="ghost" icon="refresh" aria-label={t('access.regenerate')} onClick={() => { setDraft(genPassword()); setError(null); }} />
            </div>
            {error && <p className="error-text" id={`${id}-pw-error`}>{error}</p>}
            <div className="r11-pop-foot">
              {value && <Button size="sm" variant="danger" onClick={() => { onChange(''); close(); }}>{t('access.remove')}</Button>}
              <span className="r11-gap"></span>
              <Button size="sm" variant="ghost" onClick={close}>{t('act.cancel')}</Button>
              <Button size="sm" variant="primary" onClick={done}>{t('access.done')}</Button>
            </div>
          </div>
        );
      }}
    </AccessPop>
  );
}

function LimitPicker({ value, onChange, id }) {
  const { t, errorText, formatNumber } = useI18n();
  const [draft, setDraft] = useAs(value);
  const [error, setError] = useAs(null);
  const label = t('composer.maxClicks');
  return (
    <AccessPop
      label={label}
      width={240}
      triggerClass={cx('opt', value && 'set')}
      onOpen={() => { setDraft(value); setError(null); }}
      trigger={<><Icon name="gauge" size={14} />{value ? t(Number(value) === 1 ? 'access.visit' : 'access.visits', { n: formatNumber(Number(value)) }) : t('access.noLimit')}</>}
    >
      {(close) => {
        const done = () => {
          const p = limitProblem(draft);
          if (p) return setError(errorText(p));
          onChange(draft.trim());
          close();
        };
        return (
          <div className="r11-pop-body" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.stopPropagation(); done(); } }}>
            <label className="r11-pop-title" htmlFor={`${id}-limit`}>{label}</label>
            <div className={cx('r11-pw', error && 'invalid')}>
              <input id={`${id}-limit`} className="tnum" value={draft} inputMode="numeric" placeholder={t('access.noLimit')}
                aria-invalid={!!error || undefined} aria-describedby={error ? `${id}-limit-error` : undefined}
                onChange={(e) => { setDraft(e.target.value); setError(null); }} />
              <span className="r11-unit" aria-hidden="true">{t('access.unit')}</span>
            </div>
            {error && <p className="error-text" id={`${id}-limit-error`}>{error}</p>}
            <div className="r11-pop-foot">
              {value && <Button size="sm" variant="ghost" onClick={() => { onChange(''); close(); }}>{t('access.noLimit')}</Button>}
              <span className="r11-gap"></span>
              <Button size="sm" variant="ghost" onClick={close}>{t('act.cancel')}</Button>
              <Button size="sm" variant="primary" onClick={done}>{t('access.done')}</Button>
            </div>
          </div>
        );
      }}
    </AccessPop>
  );
}

/** R4ExpiryPicker with an optional leading icon; the editor keeps its labelled field. */
function R11ExpiryPicker({ value, onChange, triggerClass = 'picker', showLabel = true, icon, id, staticOpen = false }) {
  const { t, presetLabel, expiryLabel } = useI18n();
  const custom = 'at' in value;
  return <span className="expiry"><Menu triggerClass={triggerClass} label={t('composer.expiry')} minWidth={176} staticOpen={staticOpen} button={() => <>{icon && <Icon name={icon} size={14} />}{showLabel && <span className="k">{t('composer.expiry')}</span>}<span className="v">{custom ? t('expiry.custom').replace('…', '') : expiryLabel(value)}</span>{!icon && <Icon name="chevronDown" size={14} />}</>}>
    {close => <>{presets.map(p => <MenuItem key={p} checked={value.preset === p} onClick={() => { onChange({ preset: p }); close(); }}>{presetLabel(p)}</MenuItem>)}<div className="expiry-sep" role="separator" /><MenuItem checked={custom} onClick={() => { onChange(custom ? value : { at: toLocalInput(new Date(Date.now() + 86400000)).trim() }); close(); }}>{t('expiry.custom')}</MenuItem></>}
  </Menu>{custom && <R4DateEditor value={value} onChange={onChange} id={id} />}</span>;
}

/** The three access rules, in the order people decide them. */
function AccessBar({ id, expiry, onExpiry, limit, onLimit, password, onPassword }) {
  const expirySet = 'at' in expiry || expiry.preset !== 'never';
  return (
    <span className="r11-access">
      <R11ExpiryPicker value={expiry} onChange={onExpiry} icon="clock" showLabel={false} id={`${id}-expiry`} triggerClass={cx('opt', expirySet && 'set')} />
      <LimitPicker id={id} value={limit} onChange={onLimit} />
      <PasswordPicker id={id} value={password} onChange={onPassword} />
    </span>
  );
}

/** Editor field: empty means no password. */
function PasswordField({ id, value, onChange, error }) {
  const { t } = useI18n();
  return (
    <div className="le-cell">
      <label className="label" htmlFor={id}>{t('access.password')}</label>
      <div className="r11-field-pair">
        <input id={id} className="field mono" value={value} maxLength={64} spellCheck="false" autoComplete="off" autoCapitalize="off" placeholder={t('access.noPassword')}
          aria-invalid={!!error || undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={(e) => onChange(e.target.value)} />
        <Button variant="secondary" icon="refresh" onClick={() => onChange(genPassword())}>{t('access.generate')}</Button>
      </div>
      {error && <p className="error-text" id={`${id}-error`}>{error}</p>}
    </div>
  );
}

/** Detail row: masked until shown, with copy. */
function PasswordValue({ password, toasts }) {
  const { t } = useI18n();
  const [shown, setShown] = useAs(false);
  if (!password) return <dd className="soft">{t('access.noPassword')}</dd>;
  return (
    <dd className="r11-pw-value">
      <span className="r11-code" aria-label={shown ? undefined : t('access.hidden')}>{shown ? password : '••••••'}</span>
      <Button size="sm" variant="ghost" icon={shown ? 'eyeOff' : 'eye'} aria-label={t(shown ? 'access.hide' : 'access.show')} aria-pressed={shown} onClick={() => setShown(!shown)} />
      <Button size="sm" variant="ghost" icon="copy" aria-label={t('access.copyPassword')} onClick={async () => (await copyText(password)) && toasts.success(t('access.passwordCopied'))} />
    </dd>
  );
}

Object.assign(window, { ExpiryPicker: R11ExpiryPicker, expiryISO, genPassword, passwordProblem, limitProblem, shareText, copyShare, AccessPop, PasswordPicker, LimitPicker, AccessBar, PasswordField, PasswordValue });
