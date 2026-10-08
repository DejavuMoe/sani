import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { groups } from './pages.ts';
import { pageSeo, siteUrl } from './seo.ts';

test('every translated page has a distinct summary, matching canonical, alternates and share metadata', () => {
  const pages = [{ path: 'index', zh: 'Sani', en: 'Sani' }, ...groups.flatMap(g => g.pages)];
  const descriptions = new Set<string>();
  for (const page of pages) {
    for (const lang of ['zh', 'en'] as const) {
      const relativePath = `${lang === 'en' ? 'en/' : ''}${page.path}.md`;
      const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
      const titleTemplate = /^titleTemplate: (.+)$/m.exec(source)?.[1];
      const { description, head } = pageSeo({ relativePath, title: page[lang], titleTemplate });
      assert(description.length > 20 && !descriptions.has(description), relativePath);
      descriptions.add(description);
      const value = (key: string) => head.find(([, a]) => a.name === key || a.property === key)?.[1].content;
      const canonical = head.filter(([, a]) => a.rel === 'canonical');
      assert.equal(canonical.length, 1);
      const url = `${siteUrl}/${lang === 'en' ? 'en/' : ''}${page.path === 'index' ? '' : page.path}`;
      assert.equal(canonical[0][1].href, url);
      const alternates = head.filter(([, a]) => a.rel === 'alternate').map(([, a]) => [a.hreflang, a.href]);
      const route = page.path === 'index' ? '' : page.path;
      assert.deepEqual(alternates, [['zh-CN', `${siteUrl}/${route}`], ['en', `${siteUrl}/en/${route}`], ['x-default', `${siteUrl}/${route}`]]);
      assert.equal(value('og:url'), url);
      assert.equal(value('og:title'), `${page[lang]} | ${titleTemplate ?? 'Sani'}`);
      assert.equal(value('twitter:title'), value('og:title'));
      assert.equal(value('og:description'), description);
      assert.equal(value('twitter:description'), description);
      assert.equal(value('twitter:card'), 'summary_large_image');
      assert.equal(value('twitter:image'), value('og:image'));
      assert(existsSync(new URL(`../public${new URL(value('og:image')!).pathname}`, import.meta.url)));
      const data = JSON.parse(head.find(([, a]) => a.type === 'application/ld+json')![2]!);
      assert.equal(data.url, url);
      assert.equal(data.description, description);
      assert.equal(data.inLanguage, lang === 'en' ? 'en' : 'zh-CN');
    }
  }
  const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
  assert(robots.includes(`Sitemap: ${siteUrl}/sitemap.xml`));
  assert(!robots.includes('Disallow: /'));
  assert.deepEqual(pageSeo({ relativePath: '404.md', title: '404' }).head, [['meta', { name: 'robots', content: 'noindex, follow' }]]);
  const unsafe = pageSeo({ relativePath: 'index.md', title: '</script>', titleTemplate: false }).head;
  assert(!unsafe.find(([, a]) => a.type === 'application/ld+json')![2]!.includes('</script>'));
  for (const [titleTemplate, expected] of [[undefined, 'Guide | Sani'], [true, 'Guide | Sani'], [false, 'Guide'], ['Sani', 'Guide'], [':title — Sani', 'Guide — Sani']] as const) {
    const { head } = pageSeo({ relativePath: 'index.md', title: 'Guide', titleTemplate });
    assert.equal(head.find(([, a]) => a.property === 'og:title')![1].content, expected);
  }
});
