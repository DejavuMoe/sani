function TagManager({ open, onClose, store }) {
  const { lang } = useI18n(), zh = lang === 'zh';
  const [query, setQuery] = React.useState(''), [unused, setUnused] = React.useState(false);
  const [editing, setEditing] = React.useState(null), [removing, setRemoving] = React.useState(null);
  const [name, setName] = React.useState(''), [color, setColor] = React.useState('#5872a5');
  const [validColor, setValidColor] = React.useState(true), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const nameId = 'tag-name-' + React.useId().replace(/:/g,'');
  const search = React.useRef(null), returnTo = React.useRef(null);
  const scene = new URLSearchParams(location.search).get('scene');
  const [catalog, setCatalog] = React.useState(scene === 'r7-tags-error' ? 'error' : 'ready');
  React.useEffect(() => { if (open) requestAnimationFrame(() => search.current?.focus()); }, [open]);
  const rows = store.tags.filter(t => tagKey(t.name).includes(tagKey(query)) && (!unused || !store.tagCounts[t.id]));
  const duplicate = store.tags.some(t => t.id !== editing?.id && tagKey(t.name) === tagKey(name));
  const valid = name.trim() && [...name.trim().normalize('NFC')].length <= 24 && !duplicate && validColor;
  const closeChild = () => { if (busy) return; setEditing(null); setRemoving(null); setError(''); requestAnimationFrame(() => returnTo.current?.isConnected ? returnTo.current.focus() : search.current?.focus()); };
  async function remove() {
    setBusy(true); setError('');
    try { await store.deleteTag(removing.id); setRemoving(null); requestAnimationFrame(() => search.current?.focus()); }
    catch { setError(zh ? '删除失败，标签与关联未改变。请重试。' : 'Deletion failed. The tag and its associations are unchanged. Try again.'); }
    finally { setBusy(false); }
  }
  return <>
    <R7Dialog open={open} title={zh ? '管理标签' : 'Manage tags'} width={600} onClose={() => { if (!editing && !removing && !busy) onClose(); }}>
      <div className="r7-manager" data-screen-id="r7-tag-manager">
        <p className="hint">{zh ? '名称和颜色的修改对所有内容生效。删除标签不会删除内容。' : 'Name and color changes apply to all items. Deleting a tag keeps its items.'}</p>
        <div className="r7-manager-tools"><label className="r7-search"><Icon name="search"/><input ref={search} value={query} onChange={e=>setQuery(e.target.value)} placeholder={zh?'搜索标签':'Search tags'} aria-label={zh?'搜索标签':'Search tags'}/></label><Segmented size="sm" label={zh?'标签范围':'Tag scope'} value={unused} onChange={setUnused} options={[{value:false,label:zh?'全部':'All'},{value:true,label:zh?'未使用':'Unused'}]}/></div>
        <div className="r7-manager-caption"><span>{catalog !== 'ready' ? '—' : zh ? `${rows.length} 个标签` : `${rows.length} tags`}</span><span>{zh ? '关联内容' : 'Items'}</span></div>
        {catalog !== 'ready' ? <div className="r7-notice" role="status"><span>{catalog==='loading' ? zh?'正在加载标签…':'Loading tags…' : zh?'标签读取失败，当前数量未知。':'Could not load tags. Counts are unknown.'}</span><Button size="sm" loading={catalog==='loading'} onClick={()=>{setCatalog('loading');setTimeout(()=>setCatalog('ready'),700);}}>{zh?'重试':'Retry'}</Button></div> : <div className="r7-tag-rows">
          {rows.map(tag=><div className="r7-tag-row" key={tag.id}><TagBadge tag={tag}/><span className="r7-tag-total">{store.tagCounts[tag.id] || 0}</span><Button size="sm" variant="ghost" icon="edit" aria-label={(zh?'编辑标签 ':'Edit tag ')+tag.name} onClick={e=>{returnTo.current=e.currentTarget;setEditing(tag);setName(tag.name);setColor(tagHex(tag.color));setError('');}}/><Button size="sm" variant="ghost" icon="trash" className="r7-danger" aria-label={(zh?'删除标签 ':'Delete tag ')+tag.name} onClick={e=>{returnTo.current=e.currentTarget;setRemoving(tag);setError('');}}/></div>)}
          {!rows.length && <p className="r7-empty">{query ? zh?'没有匹配的标签':'No matching tags' : unused ? zh?'没有未使用的标签':'No unused tags' : zh?'还没有标签，可在创建内容时新建。':'No tags yet. Create one while adding an item.'}</p>}
        </div>}
        <p className="hint r7-manager-foot">{zh?'数量包含停用和过期内容，不随当前搜索或类型筛选变化。':'Counts include disabled and expired items, regardless of search or type filters.'}</p>
      </div>
    </R7Dialog>
    <R7Dialog open={!!editing} title={zh?'编辑标签':'Edit tag'} onClose={closeChild}>
      <form className="r7-edit-tag" noValidate onSubmit={async e=>{e.preventDefault();if(!valid||busy)return;setBusy(true);await new Promise(r=>setTimeout(r,450));store.updateTag(editing.id,name.trim().normalize('NFC'),color);setBusy(false);setEditing(null);requestAnimationFrame(()=>returnTo.current?.focus());}}>
        <p className="hint">{zh?'修改将应用到所有使用此标签的内容。':'Changes apply to every item using this tag.'}</p>
        <label className="label" htmlFor={nameId}>{zh?'名称':'Name'}</label><input id={nameId} className="field" value={name} disabled={busy} aria-invalid={!!duplicate || [...name].length>24} onChange={e=>setName(e.target.value)}/>
        {duplicate && <p className="error-text" role="alert">{zh?'此名称已存在。':'This name already exists.'}</p>}
        {[...name.trim().normalize('NFC')].length>24 && <p className="error-text" role="alert">{zh?'标签名称最多 24 个字。':'Use up to 24 characters.'}</p>}
        <ColorEditor value={color} onChange={setColor} onValidity={setValidColor}/>
        <div className="r7-actions"><Button disabled={busy} onClick={closeChild}>{zh?'取消':'Cancel'}</Button><Button type="submit" variant="primary" loading={busy} disabled={!valid}>{zh?'保存':'Save'}</Button></div>
      </form>
    </R7Dialog>
    <R7Dialog open={!!removing} title={zh?`删除标签“${removing?.name ?? ''}”？`:`Delete tag “${removing?.name ?? ''}”?`} onClose={closeChild}>
      <p className="r7-dialog-copy">{zh?`将从 ${store.tagCounts[removing?.id] || 0} 条内容中移除此标签。内容和其他标签会保留。`:`Remove this tag from ${store.tagCounts[removing?.id] || 0} items. Items and other tags will be kept.`}</p>
      <p className="r7-dialog-copy hint">{zh?'此操作无法撤销。':'This action cannot be undone.'}</p>
      {store.tag===removing?.id && <p className="r7-dialog-copy hint">{zh?'当前标签筛选将被移除，搜索词和类型条件会保留。':'This tag filter will be removed. Search and type filters will be kept.'}</p>}
      {error && <p className="error-text r7-dialog-copy" role="alert">{error}</p>}
      <div className="r7-actions"><Button disabled={busy} onClick={closeChild}>{zh?'取消':'Cancel'}</Button><Button variant="danger" loading={busy} onClick={remove}>{error ? zh?'重试删除':'Retry deletion' : zh?'删除标签':'Delete tag'}</Button></div>
    </R7Dialog>
  </>;
}

function TagFilters({ store }) {
  const {lang}=useI18n(), zh=lang==='zh';
  const scene=new URLSearchParams(location.search).get('scene');
  const [manage,setManage]=React.useState(['r7-tags','r7-tags-error','r7-delete-error'].includes(scene));
  const [more,setMore]=React.useState(false),[query,setQuery]=React.useState('');
  const managerButton=React.useRef(null), moreButton=React.useRef(null);
  const selected=store.tags.find(t=>t.id===store.tag);
  const visible=store.tags.slice(0,4);
  if(selected&&!visible.some(t=>t.id===selected.id))visible.push(selected);
  const chip=(tag)=><button key={tag.id} type="button" className="tag-filter" aria-pressed={store.tag===tag.id} style={tag.color?tagStyle(tag.color):undefined} onClick={()=>store.setTag(store.tag===tag.id?null:tag.id)}>{tag.color&&<span className="tag-dot"/>}<span className="tag-name">{tag.name}</span><span className="tag-count">{tag.count??store.tagCounts[tag.id]??0}</span></button>;
  return <div className="r7-filter-area">
    <div className="r7-filter-strip" role="group" aria-label={zh?'按标签筛选':'Filter by tag'}>
      <span className="tag-filter-label"><TagIcon/>{zh?'标签':'Tags'}</span>
      {chip({id:null,name:zh?'全部':'All',count:store.allCount})}{visible.map(chip)}{chip({id:'__untagged',name:zh?'未标记':'Untagged',count:store.untaggedCount})}
      <button ref={moreButton} className="tag-filter" onClick={()=>setMore(true)} aria-haspopup="dialog">{zh?'更多标签':'More tags'}<Icon name="chevronDown" size={12}/></button>
      <button ref={managerButton} className="tag-filter r8-manage-trigger" onClick={()=>setManage(true)} aria-haspopup="dialog"><Icon name="sliders" size={14}/>{zh?'管理标签':'Manage tags'}</button>
    </div>
    <R7Dialog open={more} title={zh?'筛选标签':'Filter tags'} onClose={()=>{setMore(false);requestAnimationFrame(()=>moreButton.current?.focus());}} width={440}>
      <div className="r7-manager"><label className="r7-search"><Icon name="search"/><input value={query} aria-label={zh?'搜索标签':'Search tags'} placeholder={zh?'搜索标签':'Search tags'} onChange={e=>setQuery(e.target.value)}/></label><div className="r7-more-tags">{store.tags.filter(t=>tagKey(t.name).includes(tagKey(query))).map(tag=><button className="tag-choice" key={tag.id} aria-pressed={store.tag===tag.id} onClick={()=>{store.setTag(tag.id);setMore(false);requestAnimationFrame(()=>moreButton.current?.focus());}}><TagBadge tag={tag}/><span>{store.tagCounts[tag.id]||0}</span></button>)}</div></div>
    </R7Dialog>
    <TagManager open={manage} store={store} onClose={()=>{setManage(false);requestAnimationFrame(()=>managerButton.current?.focus());}}/>
  </div>;
}
Object.assign(window,{TagManager,TagFilters});
