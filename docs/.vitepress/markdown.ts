import type { MarkdownRenderer } from 'vitepress';
import { groupOf } from './pages.ts';

const METHOD = /^(GET|HEAD|POST|PUT|PATCH|DELETE)$/;
const ENDPOINT = /^(GET|HEAD|POST|PUT|PATCH|DELETE) (\/\S*)$/;

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Small Markdown extensions. Pages stay plain Markdown, so they read well on
 * GitHub too:
 *
 * - the section a page belongs to is shown above its title, as part of the
 *   page, so it sits inside the main landmark with everything else;
 * - a paragraph that is only `GET /api/links` becomes an endpoint line with a
 *   method chip, and inline code that is only a method (`POST`, as in
 *   tables) gets the chip;
 * - tables scroll inside their own box on narrow screens instead of
 *   overflowing the page.
 */
export function saniMarkdown(md: MarkdownRenderer) {
  // Real spaces keep copied prose readable too; punctuation stays attached.
  md.core.ruler.after('inline', 'sani-inline-spacing', (state) => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue;
      const tokens = block.children.filter((t) => t.type !== 'text' || t.content !== '');
      block.children = tokens;
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const before = tokens[i - 1];
        const after = tokens[i + 1];
        if (/^(link_open|strong_open|em_open|code_inline)$/.test(token.type) &&
            before?.type === 'text' && /[\p{L}\p{N}]$/u.test(before.content)) {
          before.content += ' ';
        }
        if (/^(link_close|strong_close|em_close|code_inline)$/.test(token.type) &&
            after?.type === 'text' && /^[\p{L}\p{N}]/u.test(after.content)) {
          after.content = ' ' + after.content;
        }
      }
    }
  });

  md.core.ruler.push('sani-eyebrow', (state) => {
    const path: string = state.env?.relativePath ?? '';
    const group = groupOf(path);
    const h1 = state.tokens.findIndex((t) => t.type === 'heading_open' && t.tag === 'h1');
    if (!group || h1 < 0) return;
    const html = new state.Token('html_block', '', 0);
    html.content = `<p class="sn-eyebrow">${escape(group[path.startsWith('en/') ? 'en' : 'zh'])}</p>\n`;
    state.tokens.splice(h1, 0, html);
  });

  md.core.ruler.after('inline', 'sani-endpoints', (state) => {
    const t = state.tokens;
    for (let i = 0; i + 2 < t.length; i++) {
      if (t[i].type !== 'paragraph_open' || t[i + 1].type !== 'inline' || t[i + 2].type !== 'paragraph_close') continue;
      const kids = t[i + 1].children ?? [];
      if (kids.length !== 1 || kids[0].type !== 'code_inline') continue;
      const m = ENDPOINT.exec(kids[0].content);
      if (!m) continue;
      const html = new state.Token('html_block', '', 0);
      html.content =
        `<p class="endpoint"><code class="method method-${m[1].toLowerCase()}">${m[1]}</code>` +
        `<code class="path">${escape(m[2])}</code></p>\n`;
      t.splice(i, 3, html);
    }
  });

  const code = md.renderer.rules.code_inline!;
  md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
    const tok = tokens[idx];
    if (METHOD.test(tok.content)) {
      return `<code class="method method-${tok.content.toLowerCase()}">${tok.content}</code>`;
    }
    return code(tokens, idx, options, env, self);
  };

  md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';
}
