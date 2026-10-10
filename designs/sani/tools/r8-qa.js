// This optional local review harness is never loaded by the product.
if (new URLSearchParams(location.search).get('qa') === '1') {
  const script = document.createElement('script');
  script.src = 'https://unpkg.com/axe-core@4.13.0/axe.min.js';
  script.integrity = 'sha384-jzJDdyy7z7+/I7TeoAg0Gc8k9hD8b1xRN0W18hMptWJ0cdoiebywhPpCyP9eBOgn';
  script.crossOrigin = 'anonymous';
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
  output.id = 'r8-qa-report';
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
    result.items = result.items.filter(item => !/tweaks-toggle|r8-qa-report|codex-browser-sidebar-comments-root/.test(item.location));
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
      output.textContent = JSON.stringify({ url: location.href, viewport: [innerWidth,innerHeight], overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, content: captureContent(), violations: results.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})), items });
      button.textContent = `Checked: ${results.violations.length} issues`;
    } catch (e) { output.textContent = JSON.stringify({error:String(e)}); button.textContent = 'Check failed'; } finally { button.style.display = ''; }
  };
}
