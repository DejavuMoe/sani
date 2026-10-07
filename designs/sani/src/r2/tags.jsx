const TAG_LIMIT = 5;
const TAG_NAME_LIMIT = 24;
const TAG_COLORS = ['blue', 'green', 'amber', 'rose', 'neutral'];
const TAG_FIXTURES = [
  { id: 'netcup', name: 'netcup', color: 'amber' },
  { id: 'aff', name: 'aff', color: 'blue' },
  { id: 'dmit', name: 'dmit', color: 'green' },
  { id: 'reading', name: '阅读', color: 'neutral' },
  { id: 'work', name: '工作', color: 'rose' },
];
const TAG_COPY = {
  zh: {
    label: '标签', add: '添加标签', choose: '选择或新建标签', search: '搜索或新建标签',
    done: '完成', remove: '移除标签 {name}', create: '新建「{name}」',
    count: '已选 {n} / 5', limit: '最多选择 5 个标签', tooLong: '标签名称最多 24 个字',
    empty: '还没有标签，输入名称即可新建', all: '全部', untagged: '未标记',
    filter: '按标签筛选', clear: '清除筛选', none: '没有符合筛选条件的链接',
    results: '{n} 条链接', color: '标签颜色', blue: '蓝色', green: '绿色', amber: '琥珀色', rose: '红色', neutral: '灰色',
  },
  en: {
    label: 'Tags', add: 'Add tag', choose: 'Choose or create tags', search: 'Search or create a tag',
    done: 'Done', remove: 'Remove tag {name}', create: 'Create “{name}”',
    count: '{n} / 5 selected', limit: 'Choose up to 5 tags', tooLong: 'Use up to 24 characters',
    empty: 'No tags yet. Type a name to create one.', all: 'All', untagged: 'Untagged',
    filter: 'Filter by tag', clear: 'Clear filters', none: 'No links match these filters',
    results: '{n} links', color: 'Tag color', blue: 'Blue', green: 'Green', amber: 'Amber', rose: 'Red', neutral: 'Gray',
  },
};
function tagText(lang, key, values = {}) {
  return TAG_COPY[lang][key].replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
}
const tagKey = (name) => name.trim().normalize('NFC').toLowerCase();
const matchesTag = (link, tag) => !tag || (tag === '__untagged' ? !link.tags?.length : link.tags?.includes(tag));

function TagIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 2.5h5l6 6-5 5-6-6z" /><circle cx="5.25" cy="5.25" r=".65" fill="currentColor" stroke="none" /></svg>;
}

function TagBadge({ tag, children }) {
  return <span className={`tag-badge tag-${tag.color}`}><span className="tag-dot" aria-hidden="true"></span><span className="tag-name" title={tag.name}>{tag.name}</span>{children}</span>;
}

function TagList({ ids = [], tags, limit = Infinity }) {
  const chosen = ids.map(id => tags.find(tag => tag.id === id)).filter(Boolean);
  if (!chosen.length) return null;
  return <span className="tag-badges">
    {chosen.slice(0, limit).map(tag => <TagBadge key={tag.id} tag={tag} />)}
    {chosen.length > limit && <span className="tag-overflow" title={chosen.slice(limit).map(t => t.name).join(', ')}>+{chosen.length - limit}</span>}
  </span>;
}

function TagPicker({ value, onChange, store, disabled = false, framed = false }) {
  const { lang } = useI18n();
  const text = (key, values) => tagText(lang, key, values);
  const id = 'tag-picker-' + React.useId().replace(/:/g, '');
  const trigger = React.useRef(null), pop = React.useRef(null), input = React.useRef(null);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [color, setColor] = React.useState('blue');
  const normalized = query.trim().normalize('NFC');
  const tooLong = [...normalized].length > TAG_NAME_LIMIT;
  const full = value.length >= TAG_LIMIT;
  const options = store.tags.filter(tag => tagKey(tag.name).includes(tagKey(query)));
  const exact = store.tags.some(tag => tagKey(tag.name) === tagKey(query));
  const close = () => pop.current?.hidePopover();

  React.useEffect(() => {
    const el = pop.current;
    const place = () => {
      const box = trigger.current.getBoundingClientRect();
      const available = window.visualViewport;
      const topEdge = available?.offsetTop ?? 0;
      const bottomEdge = topEdge + (available?.height ?? innerHeight);
      el.style.maxHeight = `${bottomEdge - topEdge - 16}px`;
      el.style.left = `${Math.max(8, Math.min(box.left, document.documentElement.clientWidth - el.offsetWidth - 8))}px`;
      el.style.top = `${Math.max(topEdge + 8, Math.min(box.bottom + 6, bottomEdge - el.offsetHeight - 8))}px`;
    };
    const resize = new ResizeObserver(() => { if (el.matches(':popover-open')) place(); });
    resize.observe(el);
    const onToggle = e => {
      const shown = e.newState === 'open';
      setOpen(shown);
      if (shown) {
        place();
        requestAnimationFrame(() => input.current?.focus());
      } else {
        setQuery('');
        if (el.contains(document.activeElement) || document.activeElement === document.body) trigger.current?.focus();
      }
    };
    el.addEventListener('toggle', onToggle);
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      resize.disconnect();
      el.removeEventListener('toggle', onToggle);
      removeEventListener('resize', place);
      removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, []);
  React.useEffect(() => { if (disabled) close(); }, [disabled]);

  const toggle = id => {
    if (value.includes(id)) onChange(value.filter(x => x !== id));
    else if (!full) onChange([...value, id]);
  };
  function create() {
    if (!normalized || tooLong || full || exact) return;
    const tag = store.addTag(normalized, color);
    onChange([...value, tag.id]);
    setQuery('');
    input.current?.focus();
  }
  function onKeyDown(e) {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); trigger.current?.focus(); return; }
    if (e.nativeEvent.isComposing) return;
    const choices = [...pop.current.querySelectorAll('.tag-choice:not(:disabled), .tag-create:not(:disabled)')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const index = choices.indexOf(document.activeElement);
      choices[(index + (e.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length]?.focus();
    } else if (e.key === 'Enter' && e.target === input.current) {
      e.preventDefault();
      if (normalized && !exact) create();
      else if (options[0]) toggle(options[0].id);
    }
  }
  return <div className={`tag-field ${framed ? 'tag-field-framed' : ''}`} role="group" aria-label={text('label')}>
    <span className="tag-label"><TagIcon />{text('label')}</span>
    <div className="tag-selected">
      {value.map(id => store.tags.find(tag => tag.id === id)).filter(Boolean).map(tag => <TagBadge key={tag.id} tag={tag}>
        <button type="button" disabled={disabled} aria-label={text('remove', { name: tag.name })} onClick={() => toggle(tag.id)}><Icon name="x" size={12} /></button>
      </TagBadge>)}
      <button ref={trigger} type="button" className="tag-add" popovertarget={id} aria-haspopup="dialog" aria-expanded={open} disabled={disabled}>
        <Icon name="plus" size={13} />{text(value.length ? 'add' : 'choose')}
      </button>
    </div>
    <div ref={pop} id={id} className="tag-pop" popover="auto" role="dialog" aria-label={text('label')} onKeyDown={onKeyDown}>
      <div className="tag-search"><Icon name="search" size={15} /><input ref={input} value={query} placeholder={text('search')} aria-label={text('search')} aria-invalid={tooLong || undefined} aria-describedby={`${id}-status`} onChange={e => setQuery(e.target.value)} autoComplete="off" spellCheck="false" /></div>
      <div className="tag-choices" role="group" aria-label={text('label')}>
        {options.map(tag => <button type="button" className="tag-choice" key={tag.id} role="checkbox" aria-checked={value.includes(tag.id)} disabled={!value.includes(tag.id) && full} onClick={() => toggle(tag.id)}>
          <TagBadge tag={tag} /><span className="tag-check">{value.includes(tag.id) && <Icon name="check" size={14} />}</span>
        </button>)}
        {!store.tags.length && !normalized && <p className="tag-empty">{text('empty')}</p>}
        {normalized && !exact && !tooLong && <div className="tag-new">
          <button type="button" className="tag-create" disabled={full} onClick={create}><Icon name="plus" size={14} /><span>{text('create', { name: normalized })}</span></button>
          <div className="tag-colors" role="group" aria-label={text('color')}>
            {TAG_COLORS.map(c => <button key={c} type="button" className={`tag-color tag-${c}`} aria-label={text(c)} aria-pressed={color === c} onClick={() => setColor(c)}><span className="tag-swatch">{color === c && <Icon name="check" size={12} />}</span></button>)}
          </div>
        </div>}
      </div>
      <footer><span id={`${id}-status`} className={tooLong ? 'error-text' : ''} aria-live="polite">{text(tooLong ? 'tooLong' : full ? 'limit' : 'count', { n: value.length })}</span><button type="button" className="tag-done" onClick={() => { close(); trigger.current?.focus(); }}>{text('done')}</button></footer>
    </div>
  </div>;
}

function TagFilters({ store }) {
  const { lang } = useI18n();
  const text = (key, values) => tagText(lang, key, values);
  const filters = [{ id: null, name: text('all'), count: store.allCount }, ...store.tags.map(tag => ({ ...tag, count: store.tagCounts[tag.id] || 0 })), { id: '__untagged', name: text('untagged'), count: store.untaggedCount }];
  return <div className="tag-filters" role="group" aria-label={text('filter')}>
    <span className="tag-filter-label"><TagIcon />{text('label')}</span>
    {filters.map(tag => <button type="button" key={tag.id ?? 'all'} className={`tag-filter ${tag.color ? `tag-${tag.color}` : ''}`} aria-pressed={store.tag === tag.id} onClick={() => store.setTag(store.tag === tag.id ? null : tag.id)}>
      {tag.color && <span className="tag-dot" aria-hidden="true"></span>}<span className="tag-name">{tag.name}</span><span className="tag-count">{tag.count}</span>
    </button>)}
  </div>;
}

Object.assign(window, { TAG_LIMIT, TAG_NAME_LIMIT, TAG_COLORS, TAG_FIXTURES, TAG_COPY, tagKey, matchesTag, tagText, TagBadge, TagList, TagPicker, TagFilters });
