/*
 * Layer 2 — primitives, one per file in web/src/components. Props follow the
 * Svelte components' props; `staticOpen` (Menu, Dialog) is prototype-only and
 * draws an overlay in place so spec boards can show it.
 */
const { useState, useRef, useEffect, useLayoutEffect, useId } = React;
const ICONS = window.SANI_ICONS;

function Icon({ name, size = 16, stroke = 1.5, className }) {
  return (
    <svg
      className={cx('icon', className)}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' || name === 'dot' ? 2.25 : stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

function Logo({ size = 20, wordmark = true }) {
  return (
    <span className="logo" role="img" aria-label="Sani">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="logo-tile" />
        <path d="M12.6 23.2 19.4 8.8" className="logo-slash" />
      </svg>
      {wordmark && (
        <span className="logo-word" aria-hidden="true">
          sani
        </span>
      )}
    </span>
  );
}

function Button({ variant = 'secondary', size = 'md', icon, iconEnd, loading = false, children, className, type = 'button', disabled, ...rest }) {
  const iconSize = size === 'sm' ? 14 : 16;
  const has = children !== undefined && children !== null && children !== false;
  return (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`, `btn-${size}`, !has && 'btn-square', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="spinner" style={{ width: iconSize - 2, height: iconSize - 2 }} aria-hidden="true"></span>
      ) : icon ? (
        <Icon name={icon} size={iconSize} />
      ) : null}
      {has && <span className="btn-text">{children}</span>}
      {iconEnd && <Icon name={iconEnd} size={iconSize} className="end" />}
    </button>
  );
}

function Segmented({ value, options, onChange, label, size = 'md' }) {
  const root = useRef(null);
  function onKeyDown(e) {
    const i = options.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % options.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + options.length) % options.length;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    root.current?.querySelectorAll('button')[next]?.focus();
  }
  return (
    <div ref={root} className={cx('seg', `seg-${size}`)} role="radiogroup" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={14} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, label, disabled = false, id }) {
  return (
    <button id={id} type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="switch-thumb"></span>
    </button>
  );
}

/**
 * Popover-API menu (Menu.svelte). `button(open)` renders the trigger's
 * content; `children(close)` the items.
 */
function Menu({ button, children, label, triggerClass = '', align = 'start', minWidth = 180, disabled = false, staticOpen = false }) {
  const id = 'menu-' + useId().replace(/:/g, '');
  const trigger = useRef(null);
  const pop = useRef(null);
  const [open, setOpen] = useState(false);

  const items = () => (pop.current ? [...pop.current.querySelectorAll('[role^="menuitem"]:not([disabled])')] : []);
  const close = () => pop.current?.hidePopover?.();

  useEffect(() => {
    const el = pop.current;
    if (!el || staticOpen) return;
    const place = () => {
      const r = trigger.current.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let left = align === 'end' ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, innerWidth - w - 8));
      let top = r.bottom + 6;
      if (top + h > innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    const ontoggle = (e) => {
      const isOpen = e.newState === 'open';
      setOpen(isOpen);
      if (isOpen) {
        place();
        addEventListener('resize', place);
        addEventListener('scroll', place, true);
        requestAnimationFrame(() => {
          const list = items();
          (list.find((x) => x.getAttribute('aria-checked') === 'true') ?? list[0])?.focus();
        });
      } else {
        removeEventListener('resize', place);
        removeEventListener('scroll', place, true);
        if (el.contains(document.activeElement) || document.activeElement === document.body) trigger.current?.focus();
      }
    };
    el.addEventListener('toggle', ontoggle);
    return () => el.removeEventListener('toggle', ontoggle);
  }, [align, staticOpen]);

  function onKeyDown(e) {
    const list = items();
    const i = list.indexOf(document.activeElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'Tab') close();
    if (next >= 0) {
      e.preventDefault();
      list[next]?.focus();
    }
  }

  const shown = open || staticOpen;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={triggerClass}
        popovertarget={staticOpen ? undefined : id}
        aria-haspopup="menu"
        aria-expanded={shown}
        aria-label={label}
        disabled={disabled}
      >
        {button(shown)}
      </button>
      <div
        ref={pop}
        id={id}
        popover={staticOpen ? undefined : 'auto'}
        role="menu"
        tabIndex={-1}
        className={cx('menu', staticOpen && 'menu-static')}
        style={{ minWidth }}
        onKeyDown={onKeyDown}
      >
        {children(close)}
      </div>
    </>
  );
}

function MenuItem({ icon, checked, hint, danger = false, onClick, children }) {
  return (
    <button
      type="button"
      className={cx('mi', danger && 'mi-danger')}
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      tabIndex={-1}
      onClick={onClick}
    >
      {icon && <Icon name={icon} className="lead" />}
      <span className="mi-label">{children}</span>
      {hint && <span className="mi-hint">{hint}</span>}
      {checked !== undefined && (
        <span className="mi-check" aria-hidden="true">
          {checked && <Icon name="check" stroke={2} />}
        </span>
      )}
    </button>
  );
}

function Dialog({ open, onClose, title, width = 440, children, staticOpen = false }) {
  const { t } = useI18n();
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d || staticOpen) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open, staticOpen]);
  const inner = (
    <div className="dialog-inner" tabIndex={-1} autoFocus>
      <header className="dialog-head">
        <h2>{title}</h2>
        <button className="dialog-close" aria-label={t('act.close')} onClick={onClose}>
          <Icon name="x" />
        </button>
      </header>
      {children}
    </div>
  );
  if (staticOpen)
    return (
      <div className="dialog dialog-static" style={{ width: `min(${width}px, calc(100vw - 32px))` }} role="dialog" aria-label={title}>
        {inner}
      </div>
    );
  return (
    <dialog
      ref={ref}
      className="dialog"
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {inner}
    </dialog>
  );
}

function Toaster({ toasts, isStatic = false }) {
  const { t } = useI18n();
  return (
    <div className={cx('toaster', isStatic && 'toaster-static')} role="status" aria-live="polite">
      {toasts.items.map((toast) => (
        <div
          key={toast.id}
          className={cx('toast', `toast-${toast.tone}`)}
          role="presentation"
          onPointerEnter={() => toasts.pause(toast.id)}
          onPointerLeave={() => toasts.resume(toast.id)}
        >
          {toast.tone === 'success' && <Icon name="check" className="tone" stroke={2} />}
          {toast.tone === 'error' && <Icon name="alert" className="tone" />}
          <span className="toast-msg">
            {toast.message}
            {toast.detail && <span className="toast-detail">{toast.detail}</span>}
          </span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                toasts.dismiss(toast.id);
                toast.action.run();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="toast-dismiss" aria-label={t('act.close')} onClick={() => toasts.dismiss(toast.id)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Favicon.svelte; `src` comes from the captured favicons instead of /api/favicons. */
function Favicon({ host, icon, size = 16 }) {
  const [failed, setFailed] = useState(false);
  const letter = ([...host.replace(/^www\./, '')][0] ?? '').toUpperCase();
  const src = FIX.favicons[host];
  if (host && icon && src && !failed)
    return <img className="fav" src={src} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  if (letter)
    return (
      <span className="letter" style={{ '--h': hostHue(host), width: size, height: size }} aria-hidden="true">
        {letter}
      </span>
    );
  return (
    <span className="letter blank" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name="link" size={size - 4} />
    </span>
  );
}

function Sparkline({ values, height = 18, label }) {
  const BAR = 3;
  const PITCH = 4;
  const width = values.length * PITCH - (PITCH - BAR);
  const peak = Math.max(1, ...values);
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <rect className="base" x="0" y={height - 1} width={width} height="1" />
      {values.map((v, i) => {
        if (v <= 0) return null;
        const h = Math.max(2, Math.round((v / peak) * (height - 2)));
        return <rect key={i} x={i * PITCH} y={height - 1 - h} width={BAR} height={h} rx="1" className={cx('bar', i === values.length - 1 && 'today')} />;
      })}
    </svg>
  );
}

function MiniBars({ days, height = 24, label }) {
  const { t, formatDay } = useI18n();
  const BAR = 4;
  const PITCH = 6;
  const width = days.length * PITCH - (PITCH - BAR);
  const peak = days.reduce((m, d) => Math.max(m, d.count), 1);
  const [active, setActive] = useState(null);
  function onPointerMove(e) {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - box.left) / box.width) * days.length);
    setActive(i >= 0 && i < days.length ? i : null);
  }
  function onKeyDown(e) {
    const cur = active ?? days.length - 1;
    if (e.key === 'ArrowLeft') setActive(Math.max(0, cur - 1));
    else if (e.key === 'ArrowRight') setActive(Math.min(days.length - 1, cur + 1));
    else return;
    e.preventDefault();
  }
  return (
    <div className="mini" role="group" aria-label={label} tabIndex={0} onKeyDown={onKeyDown} onFocus={() => setActive((a) => a ?? days.length - 1)} onBlur={() => setActive(null)}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" onPointerMove={onPointerMove} onPointerLeave={() => setActive(null)}>
        <rect className="hit" width={width} height={height} />
        <rect className="base" x="0" y={height - 1} width={width} height="1" />
        {days.map((d, i) => {
          if (d.count <= 0) return null;
          const h = Math.max(2, Math.round((d.count / peak) * (height - 2)));
          return <rect key={d.date} x={i * PITCH} y={height - 1 - h} width={BAR} height={h} rx="1.5" className={cx('bar', i === days.length - 1 && 'today', active === i && 'on')} />;
        })}
        {active !== null && <rect className="cursor" x={active * PITCH - 1} y="0" width={BAR + 2} height={height} rx="2" />}
      </svg>
      {active !== null && (
        <div className="mini-tip" style={{ left: active * PITCH + BAR / 2 }}>
          <strong>{t('chart.clicks', { n: days[active].count })}</strong>
          <span>{formatDay(days[active].date)}</span>
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BarChart({ days, height = 148, dim = false, label, empty, initialActive = null }) {
  const { t, formatDay, formatNumber } = useI18n();
  const LEFT = 30;
  const TOP = 10;
  const AXIS = 22;
  const box = useRef(null);
  const tipRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(initialActive);
  const [tipWidth, setTipWidth] = useState(0);

  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => setWidth(box.current.clientWidth));
    ro.observe(box.current);
    setWidth(box.current.clientWidth);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => setTipWidth(tipRef.current?.clientWidth ?? 0), [active]);

  const niceStep = (v) => {
    if (v <= 1) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  };
  const plotW = Math.max(0, width - LEFT);
  const plotH = height - TOP - AXIS;
  const peak = days.reduce((m, d) => Math.max(m, d.count), 0);
  const step = niceStep(peak / 2);
  const top = step * 2;
  const slot = days.length ? plotW / days.length : 0;
  const bar = Math.max(1.5, Math.min(16, slot * 0.62));
  const ticks = [0, step, top];
  const yOf = (v) => TOP + plotH - (v / top) * plotH;
  const barPath = (x, y, w, h) => {
    const r = Math.min(4, w / 2, h);
    return `M${x} ${y + h}V${y + r}a${r} ${r} 0 0 1 ${r} ${-r}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${y + h}z`;
  };
  function onPointerMove(e) {
    const b = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - b.left - LEFT) / slot);
    setActive(i >= 0 && i < days.length ? i : null);
  }
  function onKeyDown(e) {
    const last = days.length - 1;
    const cur = active ?? last;
    let next = null;
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1);
    else if (e.key === 'ArrowRight') next = Math.min(last, cur + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else if (e.key === 'Escape' && active !== null) {
      setActive(null);
      e.stopPropagation();
      return;
    }
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    }
  }
  const tipLeft = active === null ? 0 : Math.max(tipWidth / 2, Math.min(width - tipWidth / 2, LEFT + (active + 0.5) * slot));

  return (
    <div
      ref={box}
      className={cx('chart', dim && 'dim')}
      role="group"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => setActive((a) => a ?? days.length - 1)}
      onBlur={() => setActive(null)}
    >
      {width > 0 && days.length > 0 && (
        <>
          <svg width={width} height={height} aria-hidden="true" onPointerMove={onPointerMove} onPointerLeave={() => setActive(null)}>
            {active !== null && <rect className="band" x={LEFT + active * slot} y={TOP - 4} width={slot} height={plotH + 4} rx="4" />}
            {ticks.map((tick, i) => (
              <React.Fragment key={i}>
                <line className={tick === 0 ? 'base' : 'grid'} x1={LEFT} x2={width} y1={Math.round(yOf(tick)) + 0.5} y2={Math.round(yOf(tick)) + 0.5} />
                {(peak > 0 || tick === 0) && (
                  <text className="tick" x={LEFT - 8} y={yOf(tick)} textAnchor="end" dominantBaseline="central">
                    {formatNumber(tick)}
                  </text>
                )}
              </React.Fragment>
            ))}
            {days.map((d, i) => {
              if (d.count <= 0) return null;
              const h = Math.max(2, (d.count / top) * plotH);
              return <path key={d.date} className={cx('bar', i === days.length - 1 && 'today', active === i && 'on', active !== null && active !== i && 'off')} d={barPath(LEFT + i * slot + (slot - bar) / 2, TOP + plotH - h, bar, h)} />;
            })}
            <text className="tick" x={LEFT} y={height - 5}>
              {formatDay(days[0].date, false)}
            </text>
            <text className="tick" x={width} y={height - 5} textAnchor="end">
              {t('detail.today')}
            </text>
          </svg>
          {peak === 0 && empty && (
            <p className="chart-empty" style={{ top: TOP + plotH / 2, left: LEFT }}>
              {empty}
            </p>
          )}
          {active !== null && (
            <div ref={tipRef} className="chart-tip" style={{ left: tipLeft, top: yOf(days[active].count) }} aria-hidden="true">
              <strong>{t('chart.clicks', { n: days[active].count })}</strong>
              <span>{formatDay(days[active].date)}</span>
            </div>
          )}
        </>
      )}
      <table className="sr-only">
        <caption>{t('chart.table')}</caption>
        <thead>
          <tr>
            <th>{t('chart.date')}</th>
            <th>{t('detail.clicks')}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QRCode({ value, size = 132, label }) {
  const code = React.useMemo(() => qr(value), [value]);
  return (
    <svg className="qr" viewBox={`0 0 ${code.size} ${code.size}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label={label}>
      <path d={code.path} />
    </svg>
  );
}

/* SlugField.svelte. Availability comes from the fixture links, not the API. */
const blocking = ['taken', 'reserved', 'invalid', 'tooLong'];
// internal/links: reserved
const RESERVED = ['admin', 'api', 'p', 'rest', 'healthz', 'robots.txt', 'favicon.ico', 'favicon.svg', 'apple-touch-icon.png'];

function useSlugStatus(value, current = '', links = FIX.links) {
  const [status, setStatus] = useState('idle');
  useEffect(() => {
    const v = value.trim().replace(/^\//, '');
    if (!v || (current && sameSlug(v, current))) return setStatus('idle');
    const problem = slugProblem(v);
    if (problem) return setStatus(problem);
    setStatus('checking');
    const timer = setTimeout(() => {
      if (RESERVED.includes(v.toLowerCase())) setStatus('reserved');
      else if (links.some((l) => sameSlug(l.slug, v))) setStatus('taken');
      else setStatus('available');
    }, 220);
    return () => clearTimeout(timer);
  }, [value, current]);
  return status;
}

function SlugField({ value, onChange, status, prefix, placeholder = '', id, variant = 'inline', onEnter }) {
  const { t } = useI18n();
  const message = {
    idle: '',
    checking: '',
    available: t('slug.available'),
    taken: t('slug.taken'),
    reserved: t('slug.reserved'),
    invalid: t('slug.invalid'),
    tooLong: t('slug.tooLong'),
  }[status];
  const blocked = blocking.includes(status);
  // r1: the inline field grows with the slug (wide characters count twice)
  // instead of clipping it at 11ch; css caps it at 32ch.
  const chars = [...value].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/.test(ch) ? 2 : 1), 0);
  const width = variant === 'inline' ? { width: `calc(${Math.max(11, chars + 1)}ch)` } : undefined;
  return (
    <span className={cx('slugf', `slugf-${variant}`, status === 'available' && 'is-available', blocked && 'is-blocking')}>
      <label className="slugf-box" htmlFor={id}>
        <span className="slugf-prefix">{prefix}/</span>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={width}
          spellCheck="false"
          autoComplete="off"
          autoCapitalize="off"
          enterKeyHint="go"
          maxLength={128}
          aria-invalid={blocked || undefined}
          aria-describedby={id ? `${id}-status` : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
        />
      </label>
      {(variant === 'inline' || message) && (
        <span className="slugf-status" id={id ? `${id}-status` : undefined} aria-live="polite">
          {status === 'available' ? <Icon name="check" size={14} stroke={2} /> : blocked ? <Icon name="alert" size={14} /> : null}
          {message}
        </span>
      )}
    </span>
  );
}

function ExpiryPicker({ value, onChange, triggerClass = 'picker', showLabel = true, id, staticOpen = false }) {
  const { t, presetLabel, expiryLabel } = useI18n();
  const input = useRef(null);
  const custom = 'at' in value;
  const minLocal = toLocalInput(new Date(Date.now() + 60000));
  function pickCustom() {
    const tomorrow = new Date(Date.now() + 24 * 3600000);
    tomorrow.setMinutes(0, 0, 0);
    onChange({ at: 'at' in value ? value.at : toLocalInput(tomorrow) });
    requestAnimationFrame(() => {
      input.current?.focus();
      try {
        input.current?.showPicker();
      } catch {
        /* not supported or not allowed */
      }
    });
  }
  return (
    <span className="expiry">
      <Menu
        triggerClass={triggerClass}
        label={t('composer.expiry')}
        minWidth={176}
        staticOpen={staticOpen}
        button={() => (
          <>
            {showLabel && <span className="k">{t('composer.expiry')}</span>}
            <span className="v">{custom ? t('expiry.custom').replace('…', '') : expiryLabel(value)}</span>
            <Icon name="chevronDown" size={14} className="chev" />
          </>
        )}
      >
        {(close) => (
          <>
            {presets.map((p) => (
              <MenuItem
                key={p}
                checked={'preset' in value && value.preset === p}
                onClick={() => {
                  onChange({ preset: p });
                  close();
                }}
              >
                {presetLabel(p)}
              </MenuItem>
            ))}
            <div className="expiry-sep" role="separator"></div>
            <MenuItem
              checked={custom}
              onClick={() => {
                close();
                pickCustom();
              }}
            >
              {t('expiry.custom')}
            </MenuItem>
          </>
        )}
      </Menu>
      {custom && (
        <input
          ref={input}
          id={id}
          className="expiry-when"
          type="datetime-local"
          min={minLocal}
          value={value.at}
          aria-label={t('expiry.custom')}
          onChange={(e) => onChange({ at: e.target.value })}
        />
      )}
    </span>
  );
}

Object.assign(window, {
  Icon,
  Logo,
  Button,
  Segmented,
  Switch,
  Menu,
  MenuItem,
  Dialog,
  Toaster,
  Favicon,
  Sparkline,
  MiniBars,
  BarChart,
  QRCode,
  blocking,
  useSlugStatus,
  SlugField,
  ExpiryPicker,
});
