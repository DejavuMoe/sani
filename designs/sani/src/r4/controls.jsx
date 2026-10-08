window.SANI_ICONS.chevronLeft = ['M9.5 4.5 6 8l3.5 3.5'];

function R4ColorEditor({ value, onChange, onValidity }) {
  const { lang } = useI18n();
  const zh = lang === 'zh';
  const [input, setInput] = React.useState(tagHex(value));
  const id = React.useId();
  const normalized = normalizeTagColor(input);
  const hex = normalized || tagHex(value);
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  function change(next) {
    setInput(next);
    const color = normalizeTagColor(next);
    onValidity(!!color);
    if (color) onChange(color);
  }
  React.useEffect(() => { onValidity(!!normalized); }, []);
  return <div className="r3-color">
    <div className="r3-swatches" role="group" aria-label={zh ? '预设颜色' : 'Preset colors'}>{TAG_COLORS.map(([color, cn, en]) => <button type="button" key={color} style={tagStyle(color)} aria-label={zh ? cn : en} aria-pressed={color === hex} onClick={() => change(color)}><span className="tag-swatch" /></button>)}</div>
    <label className="r3-color-label" htmlFor={id}>{zh ? '自定义颜色' : 'Custom color'}</label>
    <div className="r3-color-input"><span className="r4-color-preview" style={{ '--chosen-color': hex }} aria-hidden="true" /><input id={id} className="field" value={input} spellCheck="false" autoComplete="off" aria-invalid={!normalized} aria-describedby={id + '-help'} onChange={e => change(e.target.value)} onBlur={() => { if (normalized) setInput(normalized); }} /></div>
    <div className="r4-sliders">{[zh ? '红' : 'Red', zh ? '绿' : 'Green', zh ? '蓝' : 'Blue'].map((label, i) => <label key={i}>{label}<input type="range" min="0" max="255" value={channels[i]} aria-label={label} style={{ '--range-color': ['#a96f72', '#56877e', '#5872a5'][i] }} onChange={e => { const next = [...channels]; next[i] = +e.target.value; change('#' + next.map(n => n.toString(16).padStart(2, '0')).join('')); }} /><output>{channels[i]}</output></label>)}</div>
    <p id={id + '-help'} className={normalized ? 'hint' : 'error-text'}>{normalized ? 'HEX · RGB · HSL' : zh ? '请输入有效的 HEX、RGB 或 HSL，不支持透明度。' : 'Enter a valid HEX, RGB or HSL value without alpha.'}</p>
  </div>;
}

function R4DateEditor({ value, onChange, id }) {
  const { lang } = useI18n();
  const zh = lang === 'zh';
  const [date, setDate] = React.useState(value.at.slice(0, 10));
  const [time, setTime] = React.useState(value.at.slice(11, 16));
  const [month, setMonth] = React.useState(() => new Date(value.at.slice(0, 7) + '-01T12:00'));
  const candidate = `${date}T${time}`;
  const parsed = new Date(candidate);
  const valid = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(candidate) && !Number.isNaN(+parsed) && toLocalInput(parsed).trim() === candidate && +parsed > Date.now();
  const pad = n => String(n).padStart(2, '0');
  const first = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const dateFor = n => `${month.getFullYear()}-${pad(month.getMonth() + 1)}-${pad(n)}`;
  const idDate = (id || 'r4-expiry') + '-date', idTime = (id || 'r4-expiry') + '-time';
  return <div className="r4-date">
    <div className="r4-calendar-head"><Button size="sm" icon="chevronLeft" aria-label={zh ? '上个月' : 'Previous month'} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} /><span>{month.toLocaleDateString(zh ? 'zh-CN' : 'en', { year: 'numeric', month: 'long' })}</span><Button size="sm" icon="chevronRight" aria-label={zh ? '下个月' : 'Next month'} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} /></div>
    <div className="r4-calendar" role="group" aria-label={zh ? '选择日期' : 'Choose date'}>
      {(zh ? ['一', '二', '三', '四', '五', '六', '日'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']).map((d, i) => <span key={'d' + i} aria-hidden="true">{d}</span>)}
      {Array.from({ length: first }, (_, i) => <span key={'s' + i} />)}
      {Array.from({ length: days }, (_, i) => <button key={i} type="button" aria-label={dateFor(i + 1)} aria-pressed={date === dateFor(i + 1)} onClick={() => setDate(dateFor(i + 1))}>{i + 1}</button>)}
    </div>
    <div className="r4-date-fields"><div className="r4-input"><label htmlFor={idDate}>{zh ? '日期' : 'Date'}</label><input id={idDate} className="field" placeholder="YYYY-MM-DD" value={date} aria-invalid={!valid} onChange={e => setDate(e.target.value)} /></div><div className="r4-input"><label htmlFor={idTime}>{zh ? '时间' : 'Time'}</label><input id={idTime} className="field" placeholder="HH:mm" value={time} aria-invalid={!valid} onChange={e => setTime(e.target.value)} /></div></div>
    {!valid && <p className="error-text" role="alert">{zh ? '请选择有效的未来日期与时间。' : 'Choose a valid future date and time.'}</p>}
    <p className="hint">{zh ? '使用当前设备的时区。' : 'Uses this device’s time zone.'}</p>
    <Button size="sm" disabled={!valid || candidate === value.at} onClick={() => onChange({ at: candidate })}>{zh ? '应用时间' : 'Apply date and time'}</Button>
  </div>;
}

function R4ExpiryPicker({ value, onChange, triggerClass = 'picker', showLabel = true, id, staticOpen = false }) {
  const { t, presetLabel, expiryLabel } = useI18n();
  const custom = 'at' in value;
  return <span className="expiry"><Menu triggerClass={triggerClass} label={t('composer.expiry')} minWidth={176} staticOpen={staticOpen} button={() => <>{showLabel && <span className="k">{t('composer.expiry')}</span>}<span className="v">{custom ? t('expiry.custom').replace('…', '') : expiryLabel(value)}</span><Icon name="chevronDown" size={14} /></>}>
    {close => <>{presets.map(p => <MenuItem key={p} checked={value.preset === p} onClick={() => { onChange({ preset: p }); close(); }}>{presetLabel(p)}</MenuItem>)}<div className="expiry-sep" role="separator" /><MenuItem checked={custom} onClick={() => { onChange(custom ? value : { at: toLocalInput(new Date(Date.now() + 86400000)).trim() }); close(); }}>{t('expiry.custom')}</MenuItem></>}
  </Menu>{custom && <R4DateEditor value={value} onChange={onChange} id={id} />}</span>;
}

function R4Tooltip({ text, children }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const timer = React.useRef();
  React.useEffect(() => {
    if (!open) return;
    const dismiss = e => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('keydown', dismiss);
    return () => removeEventListener('keydown', dismiss);
  }, [open]);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  return <span className="r4-tip" onMouseEnter={() => { clearTimeout(timer.current); setOpen(true); }} onMouseLeave={() => { timer.current = setTimeout(() => setOpen(false), 180); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
    {React.cloneElement(children, { 'aria-describedby': open ? id : undefined })}
    {open && <span className="r4-tip-content" id={id} role="tooltip">{text}</span>}
  </span>;
}

function R4AppHeader({ route = 'dashboard', theme = 'system', onCycleTheme, onShortcuts, onNavigate }) {
  const { t } = useI18n();
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => { const scroll = () => setScrolled(scrollY > 4); addEventListener('scroll', scroll); return () => removeEventListener('scroll', scroll); }, []);
  const go = to => e => { if (onNavigate) { e.preventDefault(); onNavigate(to); } };
  const themeName = `${t('menu.theme')}: ${t('theme.' + theme)}`;
  return <header className={cx('hd', scrolled && 'scrolled')}><div className="hd-inner"><a className="hd-brand" href="#dashboard" onClick={go('dashboard')}><Logo /></a><nav className="hd-tools" aria-label={t('menu.label')}>
    <R4Tooltip text={`${t('menu.shortcuts')} (?)`}><button type="button" className="hd-tool hd-hide-touch" aria-label={t('menu.shortcuts')} onClick={onShortcuts}><Icon name="keyboard" /></button></R4Tooltip>
    <R4Tooltip text={themeName}><button type="button" className="hd-tool" aria-label={themeName} onClick={onCycleTheme}><Icon name={themeIcon[theme]} /></button></R4Tooltip>
    <R4Tooltip text={t('menu.settings')}><a className={cx('hd-tool', route === 'settings' && 'on')} href="#settings" onClick={go('settings')} aria-label={t('menu.settings')} aria-current={route === 'settings' ? 'page' : undefined}><Icon name="sliders" /></a></R4Tooltip>
  </nav></div></header>;
}

Object.assign(window, { ColorEditor: R4ColorEditor, ExpiryPicker: R4ExpiryPicker, AppHeader: R4AppHeader });
