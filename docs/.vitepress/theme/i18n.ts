import { useData } from 'vitepress';
import { computed } from 'vue';

export type Lang = 'zh' | 'en';

/** The page's language, and a picker for strings written in both. */
export function useLang() {
  const { lang } = useData();
  const current = computed<Lang>(() => (lang.value.startsWith('zh') ? 'zh' : 'en'));
  const pick = <T>(zh: T, en: T): T => (current.value === 'zh' ? zh : en);
  const home = computed(() => (current.value === 'zh' ? '/' : '/en/'));
  return { lang: current, pick, home };
}

/** 131075 → "13.1 万" or "131k", for the big numbers on the home page. */
export function compact(n: number, lang: Lang): string {
  if (lang === 'zh') {
    return n >= 10_000 ? `${(n / 10_000).toFixed(1).replace(/\.0$/, '')} 万` : n.toLocaleString('zh-CN');
  }
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
