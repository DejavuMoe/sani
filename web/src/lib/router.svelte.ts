import { editor } from './editor.svelte';
/*
 * A tiny history router. The app lives under /admin/; everything after it
 * is a client route.
 */

export const BASE = '/admin';

export type RouteName = 'links' | 'settings' | 'new';

function parse(): { name: RouteName; params: URLSearchParams } {
  const path = location.pathname.replace(/\/+$/, '');
  const rest = path.startsWith(BASE) ? path.slice(BASE.length) : path;
  const params = new URLSearchParams(location.search);
  switch (rest) {
    case '/settings':
      return { name: 'settings', params };
    case '/new':
      return { name: 'new', params };
    default:
      return { name: 'links', params };
  }
}

class Router {
  current = $state(parse());

  private index = typeof history.state?.saniIndex === 'number' ? history.state.saniIndex : 0;
  private reverting = false;
  constructor() {
    history.replaceState({ ...history.state, saniIndex: this.index }, '');
    addEventListener('popstate', () => {
      const index = history.state?.saniIndex;
      if (this.reverting) { this.reverting = false; return; }
      if (typeof index === 'number' && editor.check?.()) {
        const delta = index - this.index;
        if (!delta) return;
        this.reverting = true;
        history.go(-delta);
        editor.request(() => history.go(delta));
      } else { this.index = typeof index === 'number' ? index : this.index; this.current = parse(); }
    });
  }

  go(to: string, opts: { replace?: boolean } = {}) {
    const url = to.startsWith(BASE) ? to : BASE + to;
    if (url === location.pathname + location.search) return;
    editor.request(() => {
      if (!opts.replace) this.index++;
      history[opts.replace ? 'replaceState' : 'pushState']({ saniIndex: this.index }, '', url);
      this.current = parse();
      if (!opts.replace) scrollTo({ top: 0 });
    });
  }

  /** onclick handler for in-app anchors: keeps modifier-clicks native. */
  link = (e: MouseEvent) => {
    const a = e.currentTarget as HTMLAnchorElement;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    this.go(a.pathname + a.search);
  };
}

export const router = new Router();
