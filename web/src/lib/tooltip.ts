// An action keeps the original trigger's layout and semantics intact.
let dismissCurrent: (() => void) | undefined;
let nextId = 0;

export function tooltip(node: HTMLElement, text: string | undefined) {
  const id = `sani-tooltip-${++nextId}`;
  let tip: HTMLDivElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const focusTarget = node.closest<HTMLElement>('button, a, [role="button"]') ?? node;
  const oldTabIndex = node.getAttribute('tabindex');
  const needsFocus = node.tabIndex < 0 && !node.closest('button, a, [role="button"]');
  if (needsFocus) node.tabIndex = 0;
  function hide() {
    clearTimeout(timer);
    tip?.remove(); tip = undefined;
    const ids = focusTarget.getAttribute('aria-describedby')?.split(/\s+/).filter(x => x !== id);
    if (ids?.length) focusTarget.setAttribute('aria-describedby', ids.join(' '));
    else focusTarget.removeAttribute('aria-describedby');
    if (dismissCurrent === hide) dismissCurrent = undefined;
  }
  function position() {
    if (!tip) return;
    const rect = node.getBoundingClientRect(), box = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(rect.right - box.width, document.documentElement.clientWidth - box.width - 8))}px`;
    tip.style.top = `${Math.max(8, rect.bottom + box.height + 8 < innerHeight ? rect.bottom + 7 : rect.top - box.height - 7)}px`;
  }
  function show() {
    clearTimeout(timer);
    if (tip || !text) return;
    dismissCurrent?.(); dismissCurrent = hide;
    tip = document.createElement('div');
    tip.className = 'sani-tooltip'; tip.id = id; tip.role = 'tooltip'; tip.popover = 'manual'; tip.textContent = text;
    tip.addEventListener('pointerenter', () => clearTimeout(timer));
    tip.addEventListener('pointerleave', leave);
    (node.closest('main, nav, header, [role="dialog"]') ?? document.body).append(tip); tip.showPopover();
    focusTarget.setAttribute('aria-describedby', [focusTarget.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
    position();
  }
  function leave() { clearTimeout(timer); timer = setTimeout(hide, 180); }
  function escape(event: KeyboardEvent) {
    if (event.key === 'Escape' && tip) { event.preventDefault(); event.stopPropagation(); hide(); }
  }
  node.addEventListener('pointerenter', show);
  node.addEventListener('pointerleave', leave);
  focusTarget.addEventListener('focusin', show);
  focusTarget.addEventListener('focusout', hide);
  document.addEventListener('keydown', escape);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  return {
    update(value: string | undefined) { text = value; if (tip) { tip.textContent = text ?? ''; position(); } },
    destroy() {
      hide();
      node.removeEventListener('pointerenter', show); node.removeEventListener('pointerleave', leave);
      focusTarget.removeEventListener('focusin', show); focusTarget.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', escape); window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide);
      if (needsFocus) { if (oldTabIndex === null) node.removeAttribute('tabindex'); else node.setAttribute('tabindex', oldTabIndex); }
    },
  };
}
