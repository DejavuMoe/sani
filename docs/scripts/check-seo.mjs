// Run after VitePress finishes, so this checks the hooks and generated sitemap,
// not just the metadata helper. No browser or extra dependency is needed.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groups } from '../.vitepress/pages.ts';
import { pageSeo, siteUrl } from '../.vitepress/seo.ts';

const out = resolve(process.argv[2] ?? fileURLToPath(new URL('../.vitepress/dist', import.meta.url)));
const read = path => readFileSync(resolve(out, path), 'utf8');
const decode = value => value.replace(/&(quot|apos|amp|lt|gt|#\d+|#x[\da-f]+);/gi, (entity, key) => {
  if (key.startsWith('#')) return String.fromCodePoint(key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1)));
  return { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' }[key] ?? entity;
});
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
const routes = ['index', ...groups.flatMap(g => g.pages.map(p => p.path))];
const expectedUrls = [];
const sitemap = read('sitemap.xml');
const entries = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, xml]) => xml);

for (const prefix of ['', 'en/']) {
  for (const route of routes) {
    const file = `${prefix}${route}.html`;
    const html = read(file);
    const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1];
    assert(head, `${file}: missing head`);
    const tags = [...head.matchAll(/<(meta|link)\s+[^>]*>/g)].map(([tag]) => attributes(tag));
    const one = (key, value) => {
      const matches = tags.filter(tag => tag[key] === value);
      assert.equal(matches.length, 1, `${file}: expected one ${value}`);
      return matches[0];
    };
    const source = readFileSync(new URL(`../${prefix}${route}.md`, import.meta.url), 'utf8');
    const title = /^title: (.+)$/m.exec(source)?.[1] ?? /^# (.+)$/m.exec(source)?.[1];
    assert(title, `${file}: missing source title`);
    const template = /^titleTemplate: (.+)$/m.exec(source)?.[1];
    const titleTemplate = template === 'false' ? false : template === 'true' ? true : template;
    const expected = pageSeo({ relativePath: `${prefix}${route}.md`, title, titleTemplate });
    const url = `${siteUrl}/${prefix}${route === 'index' ? '' : route}`;
    expectedUrls.push(url);
    assert.equal(one('rel', 'canonical').href, url, file);
    assert.equal(one('name', 'description').content, expected.description, file);
    assert.equal(one('property', 'og:url').content, url, file);
    const titles = [...head.matchAll(/<title>([\s\S]*?)<\/title>/g)];
    assert.equal(titles.length, 1, file);
    const builtTitle = decode(titles[0][1]);
    assert.equal(builtTitle, expected.head.find(([, a]) => a.property === 'og:title')[1].content, file);
    for (const key of ['og:title', 'twitter:title']) assert.equal(one(key.startsWith('og:') ? 'property' : 'name', key).content, builtTitle, file);
    for (const key of ['og:description', 'twitter:description']) assert.equal(one(key.startsWith('og:') ? 'property' : 'name', key).content, expected.description, file);
    assert.equal(one('name', 'twitter:card').content, 'summary_large_image', file);
    const image = one('property', 'og:image').content;
    assert.equal(one('name', 'twitter:image').content, image, file);
    assert(existsSync(resolve(out, new URL(image).pathname.slice(1))), `${file}: missing social image`);
    const alternates = tags.filter(tag => tag.rel === 'alternate');
    assert.deepEqual(alternates, expected.head.filter(([, attrs]) => attrs.rel === 'alternate').map(([, attrs]) => attrs), file);
    const scripts = [...head.matchAll(/<script\s+[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1, `${file}: expected one JSON-LD block`);
    const schema = JSON.parse(scripts[0][1]);
    assert.equal(schema.url, url, file);
    assert.equal(schema.name, builtTitle, file);
    assert.equal(schema.description, expected.description, file);
    assert.equal(schema.inLanguage, prefix ? 'en' : 'zh-CN', file);
    const entry = entries.find(xml => xml.includes(`<loc>${url}</loc>`));
    assert(entry, `${file}: missing from sitemap`);
    for (const alt of alternates.filter(a => a.hreflang !== 'x-default')) {
      assert([...entry.matchAll(/<xhtml:link\s+[^>]*>/g)].some(([tag]) => {
        const a = attributes(tag);
        return a.hreflang === alt.hreflang && a.href === alt.href;
      }), `${file}: missing sitemap alternate ${alt.hreflang}`);
    }
  }
}
const actualUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => decode(url));
assert.deepEqual(actualUrls.sort(), expectedUrls.sort(), 'sitemap must contain exactly the published pages, without 404');
const notFound = read('404.html');
assert([...notFound.matchAll(/<meta\s+[^>]*>/g)].some(([tag]) => {
  const a = attributes(tag);
  return a.name === 'robots' && a.content.split(/[,\s]+/).includes('noindex');
}), '404 must be noindex');
assert(!/<link\s+[^>]*rel="canonical"/.test(notFound), '404 must not declare a content canonical');
assert(read('robots.txt').includes(`Sitemap: ${siteUrl}/sitemap.xml`), 'robots must advertise the built sitemap');
console.log(`SEO: ${expectedUrls.length} pages, alternate languages, sitemap, robots and 404 verified`);
