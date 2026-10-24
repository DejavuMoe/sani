/*
 * Access passwords: generated codes, the rule the server checks, and the
 * clipboard text that carries a link together with its password.
 */
import type { Link } from './api';
import { copyText } from './clipboard';
import { t } from './i18n.svelte';
import { toasts } from './toast.svelte';
import { stripScheme } from './url';

// Readable characters only: no 0/O or 1/I/L.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generatePassword(length = 6): string {
  const bytes = new Uint8Array(length);
  const limit = 256 - (256 % ALPHABET.length);
  let password = '';
  while (password.length < length) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= limit) continue; // Reject the incomplete range to keep characters equally likely.
      password += ALPHABET[b % ALPHABET.length];
      if (password.length === length) break;
    }
  }
  return password;
}

/** Mirrors links.CleanPassword: empty, or 4 to 64 characters without control characters. */
export function validPassword(value: string): boolean {
  const text = value.trim();
  if (!text) return true;
  const n = [...text].length;
  return n >= 4 && n <= 64 && !/\p{Cc}/u.test(text);
}

/** What goes on the clipboard for a link: the address, and its password on a second line. */
export function shareText(link: Pick<Link, 'shortUrl' | 'password'>): string {
  return link.password ? `${link.shortUrl}\n${t('access.clipPassword', { password: link.password })}` : link.shortUrl;
}

/** The toast after a link (and its password) reached the clipboard. */
export function shareToast(link: Pick<Link, 'shortUrl' | 'password'>, ok: boolean, created = false) {
  const detail = stripScheme(link.shortUrl) + (link.password ? `  ${t('access.clipPassword', { password: link.password })}` : '');
  const message = !ok ? t('created.ready') : link.password ? t('access.bothCopied') : t(created ? 'created.copied' : 'act.copied');
  toasts.success(message, { detail });
}

export async function copyShare(link: Pick<Link, 'shortUrl' | 'password'>): Promise<boolean> {
  const ok = await copyText(shareText(link));
  if (ok) shareToast(link, true);
  return ok;
}
