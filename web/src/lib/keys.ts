export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The primary modifier's label: ⌘ on Apple devices, Ctrl elsewhere. */
export const mod = isMac ? '⌘' : 'Ctrl';

/** True when a key press belongs to a text field rather than the page. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(type);
  }
  return false;
}

/** Page shortcuts only fire without modifiers and outside text fields. */
export function plainKey(e: KeyboardEvent): boolean {
  return !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target) && !e.defaultPrevented;
}

export function modEnter(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey);
}
