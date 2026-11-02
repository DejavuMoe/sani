/*
 * Creation actions carry no key badge; with a fine pointer their shortcut
 * shows as a tooltip on hover and focus, like the header tools
 * ("Label (keys)"). Files have no shortcut, so no tooltip. Mirrors
 * shortcutTip() in web/src/lib/tooltip.ts.
 */
(function () {
  var mod = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
  var tip = null, owner = null;
  function keys(button) {
    var form = button.closest('form.cmp');
    if (!form) return null;
    if (!form.classList.contains('cmp-share')) return '↵';
    return form.classList.contains('text') ? mod + ' ↵' : null;
  }
  function hide() {
    if (!tip) return;
    tip.remove(); tip = null;
    if (owner) owner.removeAttribute('aria-describedby');
    owner = null;
  }
  function show(button) {
    if (owner === button || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    var k = keys(button);
    hide();
    if (!k) return;
    owner = button;
    tip = document.createElement('span');
    tip.className = 'r4-tip-content'; tip.id = 'cmp-go-tip'; tip.setAttribute('role', 'tooltip');
    tip.textContent = button.textContent.trim() + ' (' + k + ')';
    tip.style.position = 'fixed'; tip.style.zIndex = '60';
    document.body.append(tip);
    var r = button.getBoundingClientRect(), b = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(r.right - b.width, innerWidth - b.width - 8)) + 'px';
    tip.style.top = (r.bottom + b.height + 8 < innerHeight ? r.bottom + 7 : r.top - b.height - 7) + 'px';
    tip.style.right = 'auto';
    button.setAttribute('aria-describedby', tip.id);
  }
  function target(e) { return e.target.closest && e.target.closest('.cmp-go'); }
  document.addEventListener('pointerover', function (e) { var b = target(e); if (b) show(b); else if (owner && !owner.contains(e.target)) hide(); });
  document.addEventListener('focusin', function (e) { var b = target(e); if (b) show(b); });
  document.addEventListener('focusout', function (e) { if (target(e) === owner) hide(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  addEventListener('scroll', hide, true);
  addEventListener('resize', hide);
})();
