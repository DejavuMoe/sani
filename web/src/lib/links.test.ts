import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type Link } from './api';
import { links } from './links.svelte';
import { editor } from './editor.svelte';

vi.mock('./api', async (original) => ({
  ...await original<typeof import('./api')>(),
  api: Object.fromEntries(['links', 'updateLink', 'deleteLink', 'restoreLink', 'bulk', 'createLink', 'tags', 'overview', 'deleteTag'].map(name => [name, vi.fn()])),
}));
vi.mock('./toast.svelte', () => ({ toasts: { show: vi.fn(), error: vi.fn() } }));
vi.mock('./i18n.svelte', () => ({ t: (key: string) => key, errorText: (key: string) => key }));

const old: Link = {
  id: 1, kind: 'url', slug: 'old', title: 'Before', url: 'https://example.com', host: 'example.com',
  shortUrl: 'http://localhost/old', content: null, tags: [1], meta: 'manual', icon: false,
  enabled: true, status: 'active', redirect: 302, clicks: 0, lastClickAt: null, expiresAt: null, maxClicks: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
const fresh = { ...old, title: 'Saved', updatedAt: '2026-01-02T00:00:00Z' };
const list = (items: Link[]) => ({ items, total: items.length, next: null });
function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  editor.check = editor.save = editor.pending = null; editor.saving = false;
  links.editingId = links.expandedId = null;
  links.tagsLoaded = links.tagsFailed = false;
  links.items = [{ ...old }];
  links.total = 1;
  links.loaded = true;
  links.loading = links.loadingMore = links.failed = links.refreshFailed = links.refreshing = links.moreFailed = false;
  links.query = '';
  links.kind = links.tag = null;
  links.sort = 'created';
  links.next = null;
  links.stopPicking();
  vi.mocked(api.tags).mockResolvedValue({ items: [], total: 0, untagged: 0 });
  vi.mocked(api.overview).mockResolvedValue({ links: 0, clicks: 0, today: 0, days: [] });
});

describe('lists racing local writes', () => {
  it.each(['refresh', 'load', 'tag-filter'] as const)('%s cannot undo a saved edit', async (mode) => {
    const response = held<ReturnType<typeof list>>();
    if (mode === 'tag-filter') links.tag = 1;
    vi.mocked(api.links).mockReturnValueOnce(response.promise).mockResolvedValue(list([{ ...fresh, clicks: 17 }]));
    const pending = mode === 'load' ? links.load() : links.refresh();
    vi.mocked(api.updateLink).mockResolvedValue(fresh);
    await links.update(1, { title: fresh.title });
    response.resolve(list([old]));
    await pending;
    await vi.waitFor(() => {
      expect(links.items[0].title).toBe('Saved');
      expect(links.loading).toBe(false);
    });
    expect(api.links).toHaveBeenCalledTimes(mode === 'load' ? 2 : 1);
    expect(links.items[0].clicks).toBe(mode === 'load' ? 17 : 0);
  });

  it.each(['single', 'bulk'] as const)('a stale refresh cannot resurrect a %s deletion', async (mode) => {
    const response = held<ReturnType<typeof list>>();
    vi.mocked(api.links).mockReturnValueOnce(response.promise).mockResolvedValue(list([]));
    const pending = links.refresh();
    if (mode === 'single') await links.remove(old);
    else {
      links.startPicking();
      links.picked.add(old.id);
      vi.mocked(api.bulk).mockResolvedValue({ items: [old] });
      await links.bulk('delete');
    }
    response.resolve(list([old]));
    await pending;
    expect(links.items).toEqual([]);
    expect(links.total).toBe(0);
  });

  it.each(['created', 'clicks', 'visited'] as const)('reconciles a refresh during an in-flight deletion sorted by %s', async (sort) => {
    links.sort = sort;
    const deletion = held<void>();
    vi.mocked(api.deleteLink).mockReturnValue(deletion.promise);
    const pending = links.remove(old);
    vi.mocked(api.links).mockResolvedValueOnce(list([old])).mockResolvedValue(list([]));
    await links.refresh();
    deletion.resolve();
    await pending;
    expect(links.items).toEqual([]);
    expect(links.total).toBe(0);
  });

  it('retries a stale page after a local write without needing another intersection event', async () => {
    links.next = 'next-page';
    const response = held<ReturnType<typeof list>>();
    const next = { ...old, id: 3, slug: 'next' };
    vi.mocked(api.links).mockReturnValueOnce(response.promise).mockResolvedValue({ ...list([next]), total: 3 });
    const pending = links.loadMore();
    vi.mocked(api.createLink).mockResolvedValue({ ...fresh, id: 2, slug: 'new' });
    await links.create({ url: fresh.url });
    response.resolve(list([old]));
    await pending;
    await vi.waitFor(() => {
      expect(links.items.map(link => link.id)).toEqual([2, 1, 3]);
      expect(links.total).toBe(3);
      expect(links.next).toBe(null);
      expect(links.loadingMore).toBe(false);
    });
    expect(api.links).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.links).mock.calls[1][0]?.cursor).toBe('next-page');
  });

  it('does not retry an old page after the query changes', async () => {
    links.next = 'old-page';
    const response = held<ReturnType<typeof list>>();
    vi.mocked(api.links).mockReturnValueOnce(response.promise).mockResolvedValue(list([fresh]));
    const pending = links.loadMore();
    links.query = 'Saved';
    await links.load();
    links.upsert(fresh);
    response.resolve(list([old]));
    await pending;
    expect(api.links).toHaveBeenCalledTimes(2);
    expect(links.items).toEqual([fresh]);
    expect(links.next).toBe(null);
  });

  it('does not subtract a bulk deletion twice when a refresh already saw its commit', async () => {
    const other = { ...old, id: 2, slug: 'other' };
    links.items = [old, other];
    links.total = 2;
    links.sort = 'clicks';
    links.startPicking();
    links.picked.add(old.id);
    const response = held<{ items: Link[] }>();
    vi.mocked(api.bulk).mockReturnValue(response.promise);
    const pending = links.bulk('delete');
    vi.mocked(api.links).mockResolvedValue(list([other]));
    await links.refresh();
    response.resolve({ items: [old] });
    await pending;
    expect(links.items).toEqual([other]);
    expect(links.total).toBe(1);
  });

  it('does not count a restoration twice when a refresh already saw its commit', async () => {
    const other = { ...old, id: 2, slug: 'other' };
    links.items = [other];
    links.sort = 'visited';
    const response = held<Link>();
    vi.mocked(api.restoreLink).mockReturnValue(response.promise);
    const pending = links.restore(old, 0);
    vi.mocked(api.links).mockResolvedValue(list([old, other]));
    await links.refresh();
    response.resolve(old);
    await pending;
    expect(links.items).toEqual([old, other]);
    expect(links.total).toBe(2);
  });
});


describe('management state recovery', () => {
  it('protects a dirty row from background removal and explicit deletion', async () => {
    links.tag = 1; links.expandedId = 1; links.editingId = 1;
    editor.check = () => true;
    links.upsert({...fresh,tags:[]});
    expect(links.items).toHaveLength(1);expect(links.refreshFailed).toBe(true);
    vi.mocked(api.links).mockResolvedValue(list([]));
    await links.refresh();expect(links.items).toHaveLength(1);
    await links.remove(old);expect(api.deleteLink).not.toHaveBeenCalled();expect(editor.pending).not.toBeNull();
    editor.leave();await vi.waitFor(() => expect(api.deleteLink).toHaveBeenCalledWith(1));
  });
  it('refreshes every loaded cursor page while keeping selection under a tag filter', async () => {
    const items = Array.from({length:230},(_,i)=>({...old,id:i+1,slug:`item-${i}`}));
    links.items=items; links.total=250; links.next='old-cursor'; links.tag=1;
    links.startPicking(); links.picked.add(220);
    vi.mocked(api.links).mockResolvedValueOnce({items:items.slice(0,200),total:250,next:'page-2'})
      .mockResolvedValueOnce({items:items.slice(200),total:250,next:'page-3'});
    await links.refresh();
    expect(links.items).toHaveLength(230); expect([...links.picked]).toEqual([220]);
    expect(api.links).toHaveBeenLastCalledWith(expect.objectContaining({tag:1,cursor:'page-2',limit:30}));
    expect(links.next).toBe('page-3');
  });
  it('keeps all old pages when a refresh fails midway and retries without losing selection', async () => {
    links.items=Array.from({length:210},(_,i)=>({...old,id:i+1}));
    const saved=links.items; links.startPicking();links.picked.add(200);
    vi.mocked(api.links).mockResolvedValueOnce({items:saved.slice(0,200),total:210,next:'second'}).mockRejectedValueOnce(new Error('offline'));
    await links.refresh(); expect(links.refreshFailed).toBe(true);expect(links.items).toEqual(saved);expect(links.picked.has(200)).toBe(true);
    vi.mocked(api.links).mockResolvedValue({items:[old],total:1,next:null});
    await links.refresh();expect(links.refreshFailed).toBe(false);expect(links.picked.size).toBe(0);
  });
  it('query failures block stale bulk writes and next-page failures keep the cursor for retry', async () => {
    links.startPicking();links.picked.add(1);
    vi.mocked(api.links).mockRejectedValueOnce(new Error('offline'));
    await links.load();await links.bulk('delete');expect(api.bulk).not.toHaveBeenCalled();expect(links.failed).toBe(true);
    vi.mocked(api.links).mockResolvedValueOnce({items:[old],total:2,next:'page-2'});
    await links.load();expect(links.failed).toBe(false);
    vi.mocked(api.links).mockRejectedValueOnce(new Error('offline'));
    await links.loadMore();expect(links.moreFailed).toBe(true);expect(links.next).toBe('page-2');expect(links.items).toHaveLength(1);
    vi.mocked(api.links).mockResolvedValueOnce({items:[{...old,id:2}],total:2,next:null});
    await links.loadMore();expect(links.moreFailed).toBe(false);expect(links.items).toHaveLength(2);
  });
  it('failed tag deletion leaves associations and filters unchanged', async () => {
    links.tag=1;links.kind='url';links.query='old';
    links.tags=[{id:1,name:'tag',color:'blue',count:1}];
    vi.mocked(api.deleteTag).mockRejectedValueOnce(new Error('offline'));
    await expect(links.deleteTag(1)).rejects.toThrow('offline');
    expect(links.tag).toBe(1);expect(links.items[0].tags).toEqual([1]);expect(links.tags).toHaveLength(1);
    vi.mocked(api.deleteTag).mockResolvedValueOnce();
    vi.mocked(api.links).mockResolvedValueOnce(list([{...old,tags:[]}])) ;
    await links.deleteTag(1);expect(links.tag).toBeNull();expect(links.kind).toBe('url');expect(links.query).toBe('old');expect(links.items[0].tags).toEqual([]);
  });
});
