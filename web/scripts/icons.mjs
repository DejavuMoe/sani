// Renders the app icons in public/ from the logo mark.
//   node scripts/icons.mjs [out-dir]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'public';
const INK = '#1c1b19';
const PAPER = '#fafaf8';

// The mark on a 32-unit grid; `radius` 0 gives a full-bleed tile for
// platforms that apply their own mask.
const mark = (size, radius) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="${radius}" fill="${INK}"/>
  <path d="M12.6 23.2 19.4 8.8" fill="none" stroke="${PAPER}" stroke-width="3.4" stroke-linecap="round"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();

async function png(size, radius) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${mark(size, radius)}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const files = {
  'icon-192.png': await png(192, 7),
  'icon-512.png': await png(512, 7),
  'icon-maskable.png': await png(512, 0),
  'apple-touch-icon.png': await png(180, 0),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(out, name), data);
  console.log('wrote', name, data.length, 'bytes');
}

// favicon.ico: one 32px PNG in an ICO container, which every browser reads.
const ico32 = await png(32, 8);
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // image count
header.writeUInt8(32, 6); // width
header.writeUInt8(32, 7); // height
header.writeUInt8(0, 8); // palette
header.writeUInt8(0, 9); // reserved
header.writeUInt16LE(1, 10); // planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(ico32.length, 14); // data size
header.writeUInt32LE(22, 18); // data offset
writeFileSync(join(out, 'favicon.ico'), Buffer.concat([header, ico32]));
console.log('wrote favicon.ico');

await browser.close();
