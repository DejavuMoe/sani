import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarkdownRenderer } from 'vitepress';
import { saniMarkdown } from './markdown.ts';

test('inline prose has spaces without changing punctuation, links or code', async () => {
  const md = await createMarkdownRenderer(process.cwd());
  md.use(saniMarkdown);
  for (const [source, expected] of [
    ['见[日常使用](/guide/usage)了解。', '见 <a href="/guide/usage.html">日常使用</a> 了解。'],
    ['一个**完全由自己掌控**的服务。', '一个 <strong>完全由自己掌控</strong> 的服务。'],
    ['选择*斜体*文本。', '选择 <em>斜体</em> 文本。'],
    ['调用`GET`方法。', '调用 <code class="method method-get">GET</code> 方法。'],
    ['（见[性能](/internals/performance)）。', '（见 <a href="/internals/performance.html">性能</a>）。'],
    ['见 [**日常使用**](/guide/usage) 了解。', '见 <a href="/guide/usage.html"><strong>日常使用</strong></a> 了解。'],
    ['Read [the guide](/guide/usage).', 'Read <a href="/guide/usage.html">the guide</a>.'],
  ]) {
    assert.equal(md.renderInline(source), expected);
  }
  assert.equal(md.renderInline('`a**b**[x](y)`'), '<code>a**b**[x](y)</code>');
});
