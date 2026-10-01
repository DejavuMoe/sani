export type LinkStatus = 'active' | 'disabled' | 'expired' | 'exhausted';
export type MetaState = 'pending' | 'ok' | 'failed' | 'manual';
export type Sort = 'created' | 'clicks' | 'visited';
export type BulkAction = 'enable' | 'disable' | 'delete' | 'restore';
/** What a link does: redirect, or share a text or a file at /p/{slug}. */
export type LinkKind = 'url' | 'text' | 'file';
export type TextFormat = 'plain' | 'code';

export interface LinkContent {
  size: number;
  /** The bytes on the files origin; null when it isn't configured. */
  rawUrl: string | null;
  format?: TextFormat;
  /** A text's first line. */
  preview?: string;
  lines?: number;
  name?: string;
  type?: string;
  sha256?: string;
}

export interface Link {
  id: number;
  kind: LinkKind;
  content: LinkContent | null;
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
  text?: string;
  format?: TextFormat;
}

/** Settings sent with an uploaded file, as multipart fields. */
export interface FileFields {
  slug?: string;
  title?: string;
  expiresAt?: string;
  maxClicks?: number;
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
  /** Origin that serves shared files and raw text; null turns file sharing off. */
  filesUrl: string | null;
  maxFileSize: number;
  maxTextSize: number;
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
  if (!res.ok) throw failure(res.status, data, res.statusText);
  return data as T;
}

function failure(status: number, body: unknown, statusText = ''): ApiError {
  const data = body as { error?: { code?: string; message?: string }; retryAfter?: number } | null;
  const e = data?.error ?? {};
  if (status === 401 && e.code === 'unauthorized') onUnauthorized();
  // A proxy's own 413 has no code, but means the same as Sani's.
  const code = e.code ?? (status === 413 ? 'too_large' : 'http_' + status);
  return new ApiError(status, code, e.message ?? statusText, data?.retryAfter);
}

/**
 * Uploads a file as a new link. XMLHttpRequest rather than fetch, because
 * only it reports upload progress.
 */
function uploadFile(
  file: File,
  fields: FileFields,
  onProgress?: (sent: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Link> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') form.append(k, String(v));
    form.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded, e.total);
    // A reverse proxy with a smaller body limit answers 413 without Sani's body.
    const tooLarge = () => new ApiError(413, 'file_too_large', 'the file is too large');
    xhr.onload = () =>
      xhr.status === 201
        ? resolve(xhr.response)
        : reject(xhr.status === 413 && !xhr.response?.error ? tooLarge() : failure(xhr.status, xhr.response));
    xhr.onerror = () => reject(new ApiError(0, 'network', 'network error'));
    xhr.onabort = () => reject(new DOMException('upload canceled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
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

  links: (
    q: { q?: string; sort?: Sort; kind?: LinkKind | null; cursor?: string | null; limit?: number },
    signal?: AbortSignal,
  ) => {
    const p = new URLSearchParams();
    if (q.q) p.set('q', q.q);
    if (q.kind) p.set('kind', q.kind);
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
  createText: (input: LinkInput & { text: string }) => request<Link>('POST', '/texts', input),
  uploadFile,
  linkText: (id: number) => request<{ text: string }>('GET', `/links/${id}/text`),
  updateLink: (id: number, input: LinkInput) => request<Link>('PATCH', `/links/${id}`, input),
  deleteLink: (id: number) => request<void>('DELETE', `/links/${id}`),
  restoreLink: (id: number) => request<Link>('POST', `/links/${id}/restore`),
  /** Returns the links that changed; for delete, as they were. */
  bulk: (action: BulkAction, ids: number[]) => request<{ items: Link[] }>('POST', '/links/bulk', { action, ids }),
  refreshLink: (id: number) => request<Link>('POST', `/links/${id}/refresh`),
  stats: (id: number, days: number) => request<LinkStats>('GET', `/links/${id}/stats?days=${days}`),
  checkSlug: (slug: string, signal?: AbortSignal) =>
    request<{ available: boolean; reason?: string }>('GET', `/slugs/${encodeURIComponent(slug)}`, undefined, { signal }),

  tokens: () => request<{ items: Token[] }>('GET', '/tokens'),
  createToken: (name: string) => request<Token>('POST', '/tokens', { name }),
  deleteToken: (id: number) => request<void>('DELETE', `/tokens/${id}`),

  importLinks: (body: string) => request<ImportResult>('POST', '/import', body),
};
