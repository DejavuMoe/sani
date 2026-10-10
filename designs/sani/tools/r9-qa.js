// This optional local review harness is never loaded by the product.
function captureGeometry() {
  const visible = e => e.getBoundingClientRect().height > 0 && !e.closest('[data-proto-chrome]');
  const measure = e => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return { selector: e.tagName.toLowerCase() + '.' + e.className, text: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 55), height: r.height, top: r.top, bottom: r.bottom, left: r.left, width: r.width, radius: s.borderRadius, font: s.fontSize, lineHeight: s.lineHeight };
  };
  const groups = [];
  for (const [parent, child] of [
    ['.r7-manager-tools', '.r7-search,.seg'],
    ['.r3-color-input', '.field,.r4-color-preview'],
    ['.r4-date-fields', '.field'],
    ['.st-inline-form', '.field,.btn'],
    ['.r5-secret', '.field,.btn'],
    ['.r5-auth-fields', '.field,.r5-secret > .btn'],
    ['.r5-actions', '.btn'],
    ['.r5-address', '.field'],
    ['.cmp-options', '.seg,.slugf-box,.opt,.cmp-go'],
    ['.cmp-more', '.cmp-inline'],
    ['.ll-toolbar', '.ll-search,.ll-pick,.kind,.sort'],
    ['.le', '.slugf-boxed .slugf-box,input.field,button.field,.seg-field'],
    ['.le-foot', '.btn'],
    ['.ld-short-actions', '.btn'],
    ['.r7-actions', '.btn'],
    ['.login-form', '.field,.btn'],
    ['.setup-form', '.field,.btn'],
    ['.r7-tag-row', '.btn'],
    ['.r7-filter-strip', '.tag-filter'],
    ['.tag-selected', '.tag-badge,.tag-add'],
    ['.tag-pop:popover-open', '.tag-choice,.r8-manage-row'],
  ]) for (const e of document.querySelectorAll(parent)) {
    if (!visible(e)) continue;
    const controls = [...e.querySelectorAll(child)].filter(visible).map(measure);
    if (controls.length < 2) continue;
    const heightDelta = Math.max(...controls.map(c=>c.height)) - Math.min(...controls.map(c=>c.height));
    let edgeDelta = 0;
    for (let i=0;i<controls.length;i++) for (let j=i+1;j<controls.length;j++) {
      const a=controls[i], b=controls[j];
      const sideBySide = a.left + a.width <= b.left + 1 || b.left + b.width <= a.left + 1;
      if (sideBySide && Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top) > Math.min(a.height,b.height)/2)
        edgeDelta = Math.max(edgeDelta,Math.abs(a.top-b.top),Math.abs(a.bottom-b.bottom));
    }
    groups.push({group:parent,controls,heightDelta,edgeDelta,pass:heightDelta<=1 && edgeDelta<=1});
  }
  const segments = [...document.querySelectorAll('.seg')].filter(visible).map(e=>{
    const outer=measure(e), buttons=[...e.querySelectorAll('button')].map(measure);
    return {outer,buttons,pass:buttons.every(b=>Math.abs(outer.height-b.height-4)<=1 && Math.abs(b.top-outer.top-2)<=1)};
  });
  return {groups,segments,failures:[...groups.filter(g=>!g.pass).map(g=>g.group),...segments.filter(g=>!g.pass).map(()=>'.seg padding')]};
}
if (new URLSearchParams(location.search).get('qa') === '1') {
  const script = document.createElement('script');
  script.src = 'http://127.0.0.1:4312/axe.min.js';
  document.head.append(script);
  const collector = document.createElement('script');
  collector.src = 'tools/collect-dom-content.js';
  document.head.append(collector);
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Check accessibility';
  button.dataset.protoChrome = '';
  button.className = 'tweaks-toggle';
  Object.assign(button.style, { position: 'fixed', bottom: '8px', left: '8px', zIndex: '10000' });
  const output = document.createElement('pre');
  output.id = 'r9-qa-report';
  output.hidden = true;
  output.dataset.protoChrome = '';
  document.body.append(button, output);
  function placeButton() {
    const host = [...document.querySelectorAll('dialog[open]')].at(-1) || document.querySelector(':popover-open') || document.body;
    if (button.parentElement !== host) host.append(button);
  }
  new MutationObserver(placeButton).observe(document.body, { subtree:true, attributes:true, attributeFilter:['open'] });
  document.addEventListener('toggle', placeButton, true);
  function captureContent() {
    const result = window.__prototypeFirstUICollectDOMContent();
    result.items = result.items.filter(item => !/tweaks-toggle|r9-qa-report|codex-browser-sidebar-comments-root/.test(item.location));
    result.limitations.push('Review harness and browser comment chrome are excluded from product content.');
    return result;
  }
  document.addEventListener('keydown', e => { if (e.ctrlKey && e.shiftKey && e.key === 'F9') { e.preventDefault(); button.onclick(); } });
  button.onmousedown = e => e.preventDefault();
  button.onclick = async () => {
    button.textContent = 'Checking…';
    button.style.display = 'none';
    try {
      await document.fonts.ready;
      await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
      const results = await axe.run({ exclude: [['[data-proto-chrome]']] }, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa'] } });
      const items = [];
      const root = [...document.querySelectorAll('dialog[open]')].at(-1) || document.getElementById('app');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode, parent = node.parentElement;
        if (!parent || parent.closest('script,style,[data-proto-chrome]') || !node.textContent.trim()) continue;
        items.push({ text: node.textContent.trim(), channel: 'text', location: parent.tagName.toLowerCase(), visibility: parent.getClientRects().length ? 'visible' : 'hidden' });
      }
      for (const el of root.querySelectorAll('[aria-label],[placeholder],[alt],[title]')) {
        if (el.closest('[data-proto-chrome]')) continue;
        for (const key of ['aria-label','placeholder','alt','title']) if (el.getAttribute(key)) items.push({ text: el.getAttribute(key), channel: key, location: el.tagName.toLowerCase(), visibility: el.getClientRects().length ? 'visible' : 'hidden' });
      }
      output.textContent = JSON.stringify({ url: location.href, viewport: [innerWidth,innerHeight], geometry: captureGeometry(), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, content: captureContent(), violations: results.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})), items });
      button.textContent = `Checked: ${results.violations.length} issues`;
    } catch (e) { output.textContent = JSON.stringify({error:String(e)}); button.textContent = 'Check failed'; } finally { button.style.display = ''; }
  };
}
