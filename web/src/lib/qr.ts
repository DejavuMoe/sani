import { encode } from 'uqr';

export interface QR {
  size: number;
  path: string;
}

/** Encode text as one SVG path; runs of dark modules are merged per row. */
export function qr(text: string, border = 0): QR {
  const { data, size } = encode(text, { ecc: 'M', border });
  let path = '';
  for (let y = 0; y < size; y++) {
    const row = data[y];
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && row[x]) x++;
      path += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  }
  return { size, path };
}

/** A print-ready SVG: black on white with the standard 4-module quiet zone. */
export function qrSVG(text: string): string {
  const { size, path } = qr(text, 4);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

export function qrPNG(text: string, px = 1024): Promise<Blob> {
  const { size, path } = qr(text, 4);
  const scale = Math.floor(px / size);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#000';
  ctx.fill(new Path2D(path));
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
}

export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name from a slug: keeps letters of any script, drops the rest. */
export function fileName(slug: string, ext: string): string {
  const safe = slug.replace(/[^\p{L}\p{N}_.-]/gu, '-');
  return `sani-${safe || 'link'}.${ext}`;
}
