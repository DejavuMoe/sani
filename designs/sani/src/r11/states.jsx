function R7Dialog({open,onClose,title,width=440,children}) {
  const ref=React.useRef(null), previous=React.useRef(null);
  const {lang}=useI18n();
  React.useEffect(()=>{
    const el=ref.current;
    if(open&&!el.open){previous.current=document.activeElement;el.showModal();}
    if(!open&&el.open){el.close();if(previous.current?.isConnected)previous.current.focus();}
  },[open]);
  return ReactDOM.createPortal(<dialog ref={ref} className="dialog" style={{width:`min(${width}px, calc(100vw - 32px))`}} aria-label={title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===ref.current)onClose();}}><div className="dialog-inner" tabIndex={-1}><header className="dialog-head"><h2>{title}</h2><button className="dialog-close" aria-label={lang==='zh'?'关闭':'Close'} onClick={onClose}><Icon name="x"/></button></header>{children}</div></dialog>,document.body);
}
function SummaryScope() {
  return null;
}
function ListStatus({store:s}) {
  const {lang}=useI18n(),zh=lang==='zh';
  return <div className="r7-list-state" data-screen-id="r7-list-state">
    {s.queryFailed ? <div className="r7-notice error" role="alert"><span>{zh?'筛选更新失败，当前仍显示上一次结果。批量操作暂不可用。':'Filters failed to update. Previous results are shown. Bulk actions are unavailable.'}</span><Button size="sm" loading={s.loading} onClick={s.load}>{zh?'重试筛选':'Retry filters'}</Button></div> : s.refreshFailed ? <div className="r7-notice" role="status"><span>{zh?'刷新失败，仍显示上次数据。已保留选择和展开内容。':'Refresh failed. Previous data, selection and expanded items are kept.'}</span><Button size="sm" loading={s.refreshing} onClick={s.refresh}>{zh?'重试刷新':'Retry refresh'}</Button></div> : null}
    {s.loading && <p className="hint" role="status">{zh?'正在更新筛选结果…':'Updating results…'}</p>}
  </div>;
}
function ListMore({store:s}) {
  const {lang}=useI18n(),zh=lang==='zh';
  return s.moreFailed || s.loadingMore ? <div className="r7-notice" role="status"><span>{s.loadingMore ? zh?'正在加载…':'Loading…' : zh?'下一页加载失败，已加载内容仍可操作。':'Could not load the next page. Loaded items are still available.'}</span><Button size="sm" loading={s.loadingMore} onClick={s.retryMore}>{zh?'重试加载':'Retry loading'}</Button></div> : s.items.length<s.total ? <div className="r7-actions"><Button size="sm" onClick={s.retryMore}>{zh?'加载更多':'Load more'}</Button></div> : null;
}
function AccessRules({link,store}) {
  const {lang}=useI18n(),zh=lang==='zh';
  const reasons=[];
  if(!link.enabled)reasons.push(zh?'已手动停用':'Manually disabled');
  if(link.expiresAt && Date.parse(link.expiresAt)<=Date.parse(FIX.capturedAt))reasons.push(zh?'已超过有效期':'Expired');
  if(link.maxClicks && link.clicks>=link.maxClicks)reasons.push(zh?'访问次数已用尽':'Visit limit reached');
  if(!reasons.length) return null;
  return <div className="r11-unavailable" role="status">
    <span><strong>{zh?'无法访问':'Unavailable'}</strong>{reasons.join(zh?'，':', ')}</span>
    <Button size="sm" onClick={()=>store.setEditing(link.id)}>{zh?'修改访问设置':'Edit access'}</Button>
  </div>;
}
const R7BaseDataSettings=window.DataSettings;
function R7DataSettings({app}) {
  const {lang}=useI18n(),zh=lang==='zh';
  const imported=new URLSearchParams(location.search).get('scene')==='r7-import';
  const rows=Array.from({length:27},(_,i)=>({row:i+2,slug:`sample-${i+1}`,reason:i%2?'url_invalid':'slug_taken'}));
  const [expanded,setExpanded]=React.useState(false);
  function download() {
    const text=JSON.stringify({skipped:rows},null,2);
    const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='sani-import-skipped.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <><R7BaseDataSettings app={app}/>
    {imported && <section><header><h2>{zh?'导入结果':'Import results'}</h2></header><div className="st-body"><p role="status">{zh?'已导入 12 条，跳过 27 条。已有内容未被覆盖。':'Imported 12 items; skipped 27. Existing items were not overwritten.'}</p><div className="r7-status-actions"><Button size="sm" icon="download" onClick={download}>{zh?'下载全部跳过记录（27 条）':'Download all skipped records (27)'}</Button><Button size="sm" variant="ghost" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?zh?'收起明细':'Hide details':zh?'查看前 20 条':'Preview first 20'}</Button></div>{expanded&&<ol className="r7-import-rows">{rows.slice(0,20).map(r=><li key={r.row}><span className="r11-meta-part">{zh?'第 ':'Row '}{r.row}{zh?' 行':''}</span><span className="r11-meta-part">{r.slug}</span><span className="r11-meta-part">{r.reason==='slug_taken'?zh?'短码已存在':'Slug already exists':zh?'网址无效':'Invalid URL'}</span></li>)}</ol>}</div></section>}
    <section><header><h2>{zh?'备份整个实例':'Back up the whole instance'}</h2></header><div className="st-body"><p className="hint">{zh?'升级前先导出 JSON，再停机备份数据库、文件目录和配置。JSON 不含分享文本、文件和账号凭据；正常升级会自动迁移原数据库。':'Before upgrading, export JSON, then stop Sani and back up the database, files and configuration. JSON excludes shared texts, files and credentials. Normal upgrades migrate the existing database automatically.'}</p><div className="r7-data-help"><p className="hint">{zh?'请按部署方式执行备份，并验证恢复。':'Follow the steps for your deployment and verify restoration.'}</p><a href={zh?'https://sani.zsh.moe/guide/operations#backup-files':'https://sani.zsh.moe/en/guide/operations#backup-files'} target="_blank" rel="noopener">{zh?'查看备份与恢复说明':'Backup and restore guide'} ↗</a></div></div></section>
  </>;
}
Object.assign(window,{R7Dialog,SummaryScope,ListStatus,ListMore,AccessRules,DataSettings:R7DataSettings});
