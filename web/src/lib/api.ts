export type LinkStatus = 'active' | 'disabled' | 'expired' | 'exhausted';
export type MetaState = 'pending' | 'ok' | 'failed' | 'manual';
export type Sort = 'created' | 'clicks' | 'visited';

export interface Link {
  id: number;
  slug: string;
  shortUrl: string;
  url: string;
  host: string;
  title: string;
  meta: MetaState;
  icon: boolean;
  redirect: number;
  enabled: boolean;
  status: LinkStatus;
  expiresAt: string | null;
  maxClicks: number | null;
  clicks: number;
  lastClickAt: string | null;
  createdAt: string;
  updatedAt: string;
  spark?: number[];
  /** Set when a create request with `reuse` returned an existing link. */
  reused?: boolean;
}

export interface LinkInput {
  url?: string;
  slug?: string;
  title?: string;
  redirect?: number;
  enabled?: boolean;
  expiresAt?: string | null;
  maxClicks?: number | null;
  reuse?: boolean;
}

export interface DayCount {
  date: string;
  count: number;
}

export interface LinkStats {
  link: Link;
  days: DayCount[];
  referrers: { host: string; count: number }[];
  referrersTotal: number;
}

export interface Overview {
  links: number;
  clicks: number;
  today: number;
  days: DayCount[];
}

export interface Config {
  version: string;
  baseUrl: string;
  baseUrlSource: 'env' | 'setting' | 'request';
  requestOrigin: string;
  slugLength: number;
  fetchMeta: boolean;
  forwardQuery: boolean;
  passwordFromEnv: boolean;
  timezone: string;
}

export interface Token {
  id: number;
  name: string;
  hint: string;
  createdAt: string;
  usedAt: string | null;
  token?: string;
}

export interface ImportResult {
  created: number;
  skipped: { row?: number; slug?: string; reason: string }[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** Called when a request finds the session gone, so the app can show sign-in. */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      credentials: 'same-origin',
      ...init,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'network error');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error ?? {};
    if (res.status === 401 && e.code === 'unauthorized') onUnauthorized();
    throw new ApiError(res.status, e.code ?? 'http_' + res.status, e.message ?? res.statusText, data?.retryAfter);
  }
  return data as T;
}

export const api = {
  session: () => request<{ authenticated: boolean; needsSetup: boolean }>('GET', '/session'),
  login: (password: string) => request<{ authenticated: boolean }>('POST', '/session', { password }),
  logout: () => request<void>('DELETE', '/session'),
  setup: (password: string, code: string) =>
    request<{ authenticated: boolean }>('POST', '/setup', { password, code }),
  changePassword: (current: string, password: string) => request<void>('PUT', '/password', { current, password }),
  revokeOtherSessions: () => request<void>('POST', '/sessions/revoke'),

  config: () => request<Config>('GET', '/config'),
  setBaseUrl: (baseUrl: string | null) => request<Config>('PATCH', '/config', { baseUrl }),
  overview: (days = 30) => request<Overview>('GET', `/overview?days=${days}`),

  links: (q: { q?: string; sort?: Sort; cursor?: string | null; limit?: number }, signal?: AbortSignal) => {
    const p = new URLSearchParams();
    if (q.q) p.set('q', q.q);
    if (q.sort && q.sort !== 'created') p.set('sort', q.sort);
    if (q.cursor) p.set('cursor', q.cursor);
    if (q.limit) p.set('limit', String(q.limit));
    const qs = p.toString();
    return request<{ items: Link[]; next: string | null; total: number }>('GET', `/links${qs ? '?' + qs : ''}`, undefined, {
      signal,
    });
  },
  link: (id: number) => request<Link>('GET', `/links/${id}`),
  createLink: (input: LinkInput) => request<Link>('POST', '/links', input),
  updateLink: (id: number, input: LinkInput) => request<Link>('PATCH', `/links/${id}`, input),
  deleteLink: (id: number) => request<void>('DELETE', `/links/${id}`),
  restoreLink: (id: number) => request<Link>('POST', `/links/${id}/restore`),
  refreshLink: (id: number) => request<Link>('POST', `/links/${id}/refresh`),
  stats: (id: number, days: number) => request<LinkStats>('GET', `/links/${id}/stats?days=${days}`),
  checkSlug: (slug: string, signal?: AbortSignal) =>
    request<{ available: boolean; reason?: string }>('GET', `/slugs/${encodeURIComponent(slug)}`, undefined, { signal }),

  tokens: () => request<Token[]>('GET', '/tokens'),
  createToken: (name: string) => request<Token>('POST', '/tokens', { name }),
  deleteToken: (id: number) => request<void>('DELETE', `/tokens/${id}`),

  importLinks: (body: string) => request<ImportResult>('POST', '/import', body),
};
