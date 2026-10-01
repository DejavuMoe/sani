/** Byte counts as the visitor page shows them: 1024-based, one decimal below ten. */
export function formatSize(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  if (u === 0) return `${n} B`;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/** "text/plain; charset=utf-8" → "text/plain", for display. */
export function mediaType(type: string | undefined): string {
  return (type ?? '').split(';')[0].trim();
}

const encoder = new TextEncoder();

/** UTF-8 length, which is what the server's text limit counts. */
export function byteLength(s: string): number {
  return encoder.encode(s).length;
}
