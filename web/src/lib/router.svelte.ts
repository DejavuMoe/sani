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

  constructor() {
    addEventListener('popstate', () => (this.current = parse()));
  }

  go(to: string, opts: { replace?: boolean } = {}) {
    const url = to.startsWith(BASE) ? to : BASE + to;
    if (url === location.pathname + location.search) return;
    history[opts.replace ? 'replaceState' : 'pushState'](null, '', url);
    this.current = parse();
    if (!opts.replace) scrollTo({ top: 0 });
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
