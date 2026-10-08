// Pure checks for the new prototype parser; no application or database access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const context = { window: {} };
vm.runInNewContext(readFileSync(new URL('../src/r3/colors.js', import.meta.url), 'utf8'), context);
const normalize = context.window.normalizeTagColor;
for (const [input, expected] of [
  ['#abc', '#aabbcc'], [' #ABCDEF ', '#abcdef'], ['#000', '#000000'],
  ['rgb(88, 114, 165)', '#5872a5'], ['rgb(0, 255, 128)', '#00ff80'],
  ['hsl(0, 100%, 50%)', '#ff0000'], ['hsl(120, 100%, 50%)', '#00ff00'],
  ['hsl(240, 100%, 50%)', '#0000ff'], ['hsl(360deg, 100%, 50%)', '#ff0000'],
  ['hsl(220, 30%, 50%)', '#5973a6'], ['hsl(42, 0%, 0%)', '#000000'],
  ['hsl(42, 0%, 100%)', '#ffffff'],
]) assert.equal(normalize(input), expected, input);
for (const input of ['', '#ab', '#12345678', 'red', 'transparent', 'var(--accent)', 'url(https://example.com)', 'rgb(256,0,0)', 'rgb(-1,0,0)', 'rgba(0,0,0,1)', 'hsl(361,100%,50%)', 'hsl(0,101%,50%)', 'hsl(0,50%,101%)', 'hsl(Infinity,50%,50%)']) assert.equal(normalize(input), null, input);
assert.equal(context.window.SANI_COLOR_PRESETS.length, 12);
for (const [color] of context.window.SANI_COLOR_PRESETS) assert.equal(normalize(color), color);
const json = JSON.parse(readFileSync(new URL('../src/r3/examples/sani.json', import.meta.url), 'utf8'));
assert.equal(json.app, 'sani'); assert.equal(json.version, 1); assert.equal(json.links.length, 1);
assert.equal(json.links[0].url, 'https://example.com/guide');
console.log('R3: 26 color cases, 12 presets and native JSON fixture passed.');
