export type LinkStatus = 'active' | 'disabled' | 'expired' | 'exhausted';
export type MetaState = 'pending' | 'ok' | 'failed' | 'manual';
export type Sort = 'created' | 'clicks' | 'visited';
export type BulkAction = 'enable' | 'disable' | 'delete' | 'restore';
/** What a link does: redirect, or share a text or a file at /p/{slug}. */
export type LinkKind = 'url' | 'text' | 'file';
export type TextFormat = 'plain' | 'code';
export type TagColor = 'blue' | 'green' | 'amber' | 'rose' | 'neutral' | `#${string}`;
export type TagFilter = number | 'untagged' | null;
export interface Tag { id: number; name: string; color: TagColor; count: number }
export interface TagCatalog { items: Tag[]; total: number; untagged: number }

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
  tags: number[];
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
  tags?: number[];
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
  tags?: number[];
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

export interface MetadataProxy {
  scheme: 'http' | 'https' | 'socks5';
  host: string;
  port: number;
  auth: boolean;
  username: string;
  passwordSet: boolean;
}
export type MetadataProxyInput = Omit<MetadataProxy, 'passwordSet'> & { password?: string };

export interface Config {
  version: string;
  baseUrl: string;
  baseUrlSource: 'env' | 'setting' | 'request';
  requestOrigin: string;
  slugLength: number;
  fetchMeta: boolean;
  excludeConfusable: boolean;
  metaMode: 'off' | 'direct' | 'proxy' | 'environment';
  metaProxyConfigured: boolean;
  metaProxy: MetadataProxy | null;
  configSources: Record<'slugLength' | 'excludeConfusable' | 'maxFileSize' | 'metaMode' | 'metaProxy', 'default' | 'settings' | 'env'>;
  uploadChunkSize: number;
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

export const UPLOAD_CHUNK_SIZE = 25_000_000;
export interface UploadResume { id?: string; offset: number; file?: File; fields?: string }

function sendUpload<T>(method: string, path: string, body: XMLHttpRequestBodyInit, headers: Record<string, string>, onProgress?: (sent: number, total: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const clean = () => signal?.removeEventListener('abort', abort);
    if (signal?.aborted) { reject(new DOMException('upload canceled', 'AbortError')); return; }
    xhr.open(method, '/api' + path);
    xhr.responseType = 'json';
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded, e.total);
    xhr.onload = () => {
      clean();
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response) resolve(xhr.response);
      else reject(failure(xhr.status, xhr.response));
    };
    xhr.onerror = () => { clean(); reject(new ApiError(0, 'network', 'network error')); };
    xhr.onabort = () => { clean(); reject(new DOMException('upload canceled', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(body);
  });
}

export async function cancelFileUpload(resume: UploadResume) {
  const id = resume.id;
  resume.id = undefined; resume.offset = 0;
  if (!id) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await request<void>('DELETE', `/uploads/${id}`); return; }
    catch (err) {
      if (!(err instanceof ApiError) || err.code !== 'upload_busy') return;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  // A disconnected client cannot guarantee cancellation; the server TTL reclaims it.
}

async function uploadFile(file: File, fields: FileFields, onProgress?: (sent: number, total: number) => void, signal?: AbortSignal, resume: UploadResume = { offset: 0 }): Promise<Link> {
  if (file.size <= UPLOAD_CHUNK_SIZE) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') form.append(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
    form.append('file', file, file.name);
    return sendUpload<Link>('POST', '/files', form, {}, onProgress, signal);
  }
  const signature = JSON.stringify(fields);
  if (resume.id && (resume.file !== file || resume.fields !== signature)) await cancelFileUpload(resume);
  try {
    signal?.throwIfAborted();
    if (!resume.id) {
      const session = await request<{ id: string; offset: number }>('POST', '/uploads', { ...fields, name: file.name, size: file.size }, { signal });
      resume.id = session.id; resume.offset = session.offset; resume.file = file; resume.fields = signature;
    }
    onProgress?.(resume.offset, file.size);
    while (resume.offset < file.size) {
      const start = resume.offset, end = Math.min(start + UPLOAD_CHUNK_SIZE, file.size);
      const result = await sendUpload<{ offset: number }>('PUT', `/uploads/${resume.id}`, file.slice(start, end), { 'Content-Type': 'application/octet-stream', 'Upload-Offset': String(start) }, (sent) => onProgress?.(start + sent, file.size), signal);
      if (result.offset !== end) throw new ApiError(409, 'upload_offset', 'unexpected upload offset');
      resume.offset = end;
    }
    signal?.throwIfAborted();
    const link = await request<Link>('POST', `/uploads/${resume.id}/complete`, undefined, { signal });
    void cancelFileUpload(resume);
    return link;
  } catch (err) {
    if (signal?.aborted) await cancelFileUpload(resume);
    else if (err instanceof ApiError && err.code === 'upload_not_found') { resume.id = undefined; resume.offset = 0; }
    throw err;
  }
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
  setConfig: (values: Partial<Pick<Config, 'slugLength' | 'excludeConfusable' | 'maxFileSize' | 'metaMode'>> & { metaProxy?: MetadataProxyInput }) => request<Config>('PATCH', '/config', values),
  testMetadataProxy: (metaProxy: MetadataProxyInput, signal?: AbortSignal) => request<{ ok: boolean }>('POST', '/config/metadata/test', { metaProxy }, { signal }),
  updateTag: (id: number, name: string, color: TagColor) => request<Tag>('PATCH', `/tags/${id}`, { name, color }),
  overview: (days = 30) => request<Overview>('GET', `/overview?days=${days}`),
  tags: (signal?: AbortSignal) => request<TagCatalog>('GET', '/tags', undefined, { signal }),
  createTag: (name: string, color: TagColor) => request<Tag>('POST', '/tags', { name, color }),

  links: (
    q: { q?: string; sort?: Sort; kind?: LinkKind | null; tag?: TagFilter; cursor?: string | null; limit?: number },
    signal?: AbortSignal,
  ) => {
    const p = new URLSearchParams();
    if (q.q) p.set('q', q.q);
    if (q.kind) p.set('kind', q.kind);
    if (q.tag != null) p.set('tag', String(q.tag));
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
