/*
 * Clipboard writes that work in the places people actually use Sani:
 * plain HTTP on a LAN (no async clipboard API) and Safari, which only
 * allows a write during the user's gesture, even when the text is still
 * being fetched.
 */

function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
  document.body.append(ta);
  const selection = document.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  if (previous && selection) {
    selection.removeAllRanges();
    selection.addRange(previous);
  }
  return ok;
}

export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through */
    }
  }
  return legacyCopy(text);
}

/**
 * Start a clipboard write now, while the click or key press still counts as
 * a user gesture, for text that arrives later.
 */
export async function copyLater(text: Promise<string>): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext && typeof ClipboardItem !== 'undefined') {
    try {
      const item = new ClipboardItem({
        'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })),
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch {
      /* the promise failed or the browser refused; try a direct write */
    }
  }
  try {
    return await copyText(await text);
  } catch {
    return false;
  }
}
