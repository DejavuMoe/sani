// The admin app's own UI strings (web/src/lib/i18n.svelte.ts) and slug rules
// (internal/links), so the docs quote its exact wording and the home page
// demo behaves like the real thing instead of a copy that could go stale.

import { appStrings, slugRules } from '../sync/source.ts';

type Dict = Record<string, string>;
declare const data: {
  zh: Dict;
  en: Dict;
  slug: { alphabet: string; length: number; blockedSchemes: string[] };
};
export { data };

// Only what the docs use, to keep the page payload small.
const wanted = /^(composer\.|err\.url_|keys\.|expiry\.|redirect\.|sort\.|status\.|act\.copied$|settings\.(bookmarklet|install|tools))/;

export default {
  watch: ['../../../web/src/lib/i18n.svelte.ts', '../../../internal/links/links.go', '../../../internal/config/config.go'],
  load() {
    const all = appStrings();
    const keep = (d: Dict) => Object.fromEntries(Object.entries(d).filter(([k]) => wanted.test(k)));
    return { zh: keep(all.zh), en: keep(all.en), slug: slugRules() };
  },
};
