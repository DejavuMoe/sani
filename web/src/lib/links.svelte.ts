import { editor } from './editor.svelte';
import { SvelteSet } from 'svelte/reactivity';
import {
  api,
  ApiError,
  type BulkAction,
  type FileFields,
  type Link,
  type LinkInput,
  type LinkKind,
  type Overview,
  type Sort,
  type Tag,
  type TagColor,
  type TagFilter,
  type UploadResume,
} from './api';
import { errorText, t } from './i18n.svelte';
import { toasts } from './toast.svelte';

const PAGE = 50;
/** The server takes at most this many links per bulk request. */
export const MAX_PICK = 500;

class LinksStore {
  items = $state<Link[]>([]);
  total = $state(0);
  next = $state<string | null>(null);
  query = $state('');
  sort = $state<Sort>('created');
  /** Show only links of this kind; null shows all of them. */
  kind = $state<LinkKind | null>(null);
  tag = $state<TagFilter>(null);
  tags = $state<Tag[]>([]);
  allCount = $state(0);
  untaggedCount = $state(0);
  tagsLoaded = $state(false);
  tagsFailed = $state(false);
  private tagSeq = 0;
  managingTags = $state(false);

  async deleteTag(id: number) {
    await api.deleteTag(id);
    ++this.tagSeq;
    ++this.revision;
    this.tags = this.tags.filter(tag => tag.id !== id);
    this.items = this.items.map(link => ({ ...link, tags: link.tags.filter(tag => tag !== id) }));
    if (this.tag === id) this.tag = null;
    await this.refresh();
    await this.refreshTags();
  }

  async refreshTags() {
    const seq = ++this.tagSeq;
    try {
      const catalog = await api.tags();
      if (seq !== this.tagSeq) return;
      this.tags = catalog.items;
      this.allCount = catalog.total;
      this.untaggedCount = catalog.untagged;
      this.tagsLoaded = true;
      this.tagsFailed = false;
    } catch { if (seq === this.tagSeq) this.tagsFailed = true; }
  }

  async addTag(name: string, color: TagColor) {
    const tag = await api.createTag(name, color);
    ++this.tagSeq; // an older catalog request must not hide a just-created tag
    if (!this.tags.some(t => t.id === tag.id)) this.tags = [...this.tags, tag];
    return tag;
  }

  async editTag(id: number, name: string, color: TagColor) {
    const tag = await api.updateTag(id, name, color);
    ++this.tagSeq;
    this.tags = this.tags.map(t => t.id === id ? tag : t);
    return tag;
  }

  setTag(tag: TagFilter) {
    editor.request(() => { this.tag = tag; this.expandedId = this.editingId = null; void this.load(); });
  }

  clearFilters() {
    if (editor.check?.()) { editor.request(() => this.clearFilters()); return; }
    this.query = '';
    this.kind = null;
    this.tag = null;
    clearTimeout(this.searchTimer);
    this.load();
  }

  private matchesTag(link: Link) {
    return this.tag === null || (this.tag === 'untagged' ? !link.tags.length : link.tags.includes(this.tag));
  }
  /** First page for the current query has arrived. */
  loaded = $state(false);
  loading = $state(false);
  loadingMore = $state(false);
  failed = $state(false);
  moreFailed = $state(false);
  refreshFailed = $state(false);
  refreshing = $state(false);
  overviewFailed = $state(false);
  private refreshSeq = 0;
  private overviewSeq = 0;
  get stale() { return this.loading || this.failed; }

  private expanded = $state<number | null>(null);
  private editing = $state<number | null>(null);
  get expandedId() { return this.expanded; }
  set expandedId(id: number | null) {
    if (id === this.expanded) return;
    editor.request(() => { this.editing = null; this.expanded = id; });
  }
  get editingId() { return this.editing; }
  set editingId(id: number | null) {
    if (id === this.editing) return;
    editor.request(() => { this.editing = id; });
  }
  selectedId = $state<number | null>(null);
  /** Links to highlight briefly: just created or restored. */
  fresh = new SvelteSet<number>();
  /** Links being deleted, so only they animate out of the list. */
  leaving = new SvelteSet<number>();

  overview = $state<Overview | null>(null);

  /** Selection mode: rows toggle a checkbox instead of opening. */
  picking = $state(false);
  /** Links checked for a bulk action. */
  picked = new SvelteSet<number>();
  /** Where a shift-click range starts. */
  private anchor: number | null = null;
  /** A bulk request is in flight. */
  busy = $state(false);

  private seq = 0;
  // Lists started before a local write must not replace its result.
  private revision = 0;
  private ctrl: AbortController | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  async load() {
    this.ctrl?.abort();
    const ctrl = (this.ctrl = new AbortController());
    const seq = ++this.seq;
    const revision = this.revision;
    this.loading = true;
    this.failed = false;
    this.moreFailed = this.refreshFailed = false;
    try {
      const res = await api.links({ q: this.query, sort: this.sort, kind: this.kind, tag: this.tag, limit: PAGE }, ctrl.signal);
      if (seq !== this.seq) return;
      if (revision !== this.revision) { void this.load(); return; }
      this.items = res.items;
      this.total = res.total;
      this.next = res.next;
      this.loaded = true;
      // Checked links the new view doesn't show would be acted on unseen.
      this.picked.clear();
      this.anchor = null;
      if (this.selectedId !== null && !res.items.some((l) => l.id === this.selectedId)) this.selectedId = null;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (seq === this.seq) this.failed = true;
    } finally {
      if (seq === this.seq) this.loading = false;
    }
  }

  async loadMore() {
    if (!this.next || this.loadingMore || this.stale || this.refreshing) return;
    const seq = this.seq;
    const revision = this.revision;
    this.loadingMore = true;
    this.moreFailed = false;
    let retry = false;
    try {
      const res = await api.links({ q: this.query, sort: this.sort, kind: this.kind, tag: this.tag, cursor: this.next, limit: PAGE });
      if (seq !== this.seq) return;
      if (revision !== this.revision) { retry = true; return; }
      const seen = new Set(this.items.map((l) => l.id));
      this.items = [...this.items, ...res.items.filter((l) => !seen.has(l.id))];
      this.next = res.next;
      this.total = res.total;
    } catch {
      if (seq === this.seq) this.moreFailed = true;
    } finally {
      this.loadingMore = false;
      // The sentinel may stay visible, so it will not emit another entry.
      if (retry && seq === this.seq) void this.loadMore();
    }
  }

  search(q: string) {
    editor.request(() => {
      this.query = q;
      this.ctrl?.abort(); ++this.seq;
      this.loading = true;
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.load(), q ? 140 : 0);
    });
  }

  setSort(sort: Sort) {
    if (sort === this.sort) return;
    editor.request(() => { this.sort = sort; void this.load(); });
  }

  setKind(kind: LinkKind | null) {
    if (kind === this.kind) return;
    editor.request(() => { this.kind = kind; void this.load(); });
  }

  /** Rebuild the loaded range through real cursors, then publish it atomically. */
  async refresh() {
    void this.refreshOverview();
    if (!this.loaded || this.stale || this.loadingMore) return;
    const seq = this.seq, revision = this.revision, refresh = ++this.refreshSeq;
    const wanted = Math.max(PAGE, this.items.length);
    this.refreshing = true;
    try {
      let cursor: string | null = null;
      let total = 0;
      const items: Link[] = [];
      do {
        const res = await api.links({ q: this.query, sort: this.sort, kind: this.kind, tag: this.tag,
          limit: Math.min(200, wanted - items.length), ...(cursor ? { cursor } : {}) });
        if (seq !== this.seq || revision !== this.revision || refresh !== this.refreshSeq) return;
        items.push(...res.items); total = res.total;
        if (res.next === cursor && cursor !== null) throw new Error('Repeated list cursor');
        cursor = res.next;
      } while (cursor && items.length < wanted);
      // Never unmount a dirty editor because a background refresh lost its row.
      if (editor.check?.() && this.editingId !== null && !items.some(l => l.id === this.editingId)) {
        this.refreshFailed = true;
        return;
      }
      this.items = items;
      this.total = total;
      this.next = cursor;
      this.refreshFailed = false;
      const ids = new Set(items.map(l => l.id));
      for (const id of this.picked) if (!ids.has(id)) this.picked.delete(id);
      if (this.selectedId !== null && !ids.has(this.selectedId)) this.selectedId = null;
      if (this.expandedId !== null && !ids.has(this.expandedId)) this.expandedId = null;
    } catch { if (seq === this.seq && refresh === this.refreshSeq) this.refreshFailed = true; }
    finally { if (refresh === this.refreshSeq) this.refreshing = false; }
  }

  async refreshOverview() {
    void this.refreshTags();
    const seq = ++this.overviewSeq;
    try {
      const overview = await api.overview(30);
      if (seq !== this.overviewSeq) return;
      this.overview = overview;
      this.overviewFailed = false;
    } catch { if (seq === this.overviewSeq) this.overviewFailed = true; }
  }

  private flash(id: number) {
    this.fresh.add(id);
    setTimeout(() => this.fresh.delete(id), 2400);
  }

  /** Put a link where the current sort would show it, if the view includes it. */
  private place(link: Link, index = 0) {
    if (this.items.some((l) => l.id === link.id)) {
      this.upsert(link);
      return;
    }
    const q = this.query.toLowerCase();
    const fields = [link.slug, link.title, link.url, link.content?.preview ?? '', link.content?.name ?? ''];
    const visible = (!q || fields.some((s) => s.toLowerCase().includes(q))) && (!this.kind || this.kind === link.kind) && this.matchesTag(link);
    if (!visible) return;
    ++this.revision;
    const at = this.sort === 'created' && index === 0 ? 0 : Math.min(index, this.items.length);
    this.items = [...this.items.slice(0, at), link, ...this.items.slice(at)];
    this.total += 1;
  }

  upsert(link: Link) {
    ++this.revision;
    const i = this.items.findIndex((l) => l.id === link.id);
    if (i < 0) return;
    const prev = this.items[i];
    // A delayed stats/metadata response must not undo a newer saved edit.
    if (Date.parse(link.updatedAt) < Date.parse(prev.updatedAt)) return;
    if (!this.matchesTag(link)) {
      if (this.editingId === link.id && editor.check?.() && !editor.saving) { this.refreshFailed = true; return; }
      this.items = this.items.filter(l => l.id !== link.id);
      this.total = Math.max(0, this.total - 1);
      if (this.expandedId === link.id) this.expandedId = null;
      if (this.editingId === link.id) this.editingId = null;
      this.picked.delete(link.id);
      return;
    }
    const tags = this.tagsLoaded && !this.tagsFailed ? link.tags.filter(id => this.tags.some(tag => tag.id === id)) : link.tags;
    this.items[i] = { ...link, tags, spark: link.spark ?? prev.spark };
  }

  async create(input: LinkInput): Promise<Link> {
    const link = await api.createLink(input);
    this.added(link);
    this.watchMeta(link);
    return link;
  }

  async createText(input: LinkInput & { text: string }): Promise<Link> {
    const link = await api.createText(input);
    this.added(link);
    return link;
  }

  async createFile(
    file: File,
    fields: FileFields,
    onProgress?: (sent: number, total: number) => void,
    signal?: AbortSignal,
    resume?: UploadResume,
  ): Promise<Link> {
    const link = await api.uploadFile(file, fields, onProgress, signal, resume);
    this.added(link);
    return link;
  }

  private added(link: Link) {
    const filtered = !!this.query || !!this.kind || this.tag !== null || this.sort !== 'created';
    if (filtered) { this.sort = 'created'; this.clearFilters(); toasts.show(t('created.filtersCleared')); }
    else this.place(link);
    this.flash(link.id);
    this.selectedId = link.id;
    this.refreshOverview();
  }

  /** Titles are fetched in the background; pick them up when they land. */
  watchMeta(link: Link) {
    if (link.meta !== 'pending') return;
    const delays = [900, 2000, 4000, 8000];
    const poll = async (i: number) => {
      if (i >= delays.length) return;
      await new Promise((r) => setTimeout(r, delays[i]));
      try {
        const fresh = await api.link(link.id);
        this.upsert(fresh);
        if (fresh.meta === 'pending') poll(i + 1);
      } catch {
        /* deleted meanwhile */
      }
    };
    poll(0);
  }

  async update(id: number, input: LinkInput): Promise<Link> {
    const link = await api.updateLink(id, input);
    this.upsert(link);
    this.refreshTags();
    this.watchMeta(link);
    return link;
  }

  /** Optimistic toggle; reverts if the server says no. */
  async setEnabled(link: Link, enabled: boolean) {
    const prev = this.items.find((l) => l.id === link.id);
    if (prev) this.upsert({ ...prev, enabled, status: enabled ? 'active' : 'disabled' });
    try {
      const updated = await this.update(link.id, { enabled });
      toasts.show(t(enabled ? 'detail.turnedOn' : 'detail.turnedOff', { slug: '/' + updated.slug }));
    } catch (e) {
      if (prev) this.upsert(prev);
      toasts.error(errorText(e instanceof ApiError ? e.code : 'unknown'));
    }
  }

  /** Delete right away and offer undo; no confirmation dialog. */
  async remove(link: Link) {
    if (this.stale) return;
    if (this.editingId === link.id && editor.check?.()) { editor.request(() => { void this.remove(link); }); return; }
    ++this.revision;
    const index = this.items.findIndex((l) => l.id === link.id);
    const neighbor = this.items[index + 1] ?? this.items[index - 1] ?? null;
    this.leaving.add(link.id);
    setTimeout(() => this.leaving.delete(link.id), 400);
    this.items = this.items.filter((l) => l.id !== link.id);
    this.total = Math.max(0, this.total - 1);
    if (this.expandedId === link.id) this.expandedId = null;
    if (this.editingId === link.id) this.editingId = null;
    if (this.selectedId === link.id) this.selectedId = neighbor?.id ?? null;
    try {
      await api.deleteLink(link.id);
    } catch (e) {
      this.place(link, index);
      toasts.error(errorText(e instanceof ApiError ? e.code : 'unknown'));
      return;
    }
    ++this.revision;
    // A refresh that began during the delete may have seen the old row.
    if (this.items.some(l => l.id === link.id)) {
      this.items = this.items.filter(l => l.id !== link.id);
      this.total = Math.max(0, this.total - 1);
    }
    await this.refresh();
    toasts.show(t('detail.deleted', { slug: '/' + link.slug }), {
      action: { label: t('act.undo'), run: () => this.restore(link, index) },
    });
  }

  startPicking() {
    if (this.stale) return;
    if (editor.check?.()) { editor.request(() => this.startPicking()); return; }
    this.picking = true;
    this.expandedId = null;
    this.editingId = null;
  }

  stopPicking() {
    this.picking = false;
    this.picked.clear();
    this.anchor = null;
  }

  /** Check or uncheck a link; with range, everything from the last one clicked. */
  togglePick(id: number, range = false) {
    if (this.stale) return;
    if (!this.picking) this.startPicking();
    const ids = this.items.map((l) => l.id);
    const to = ids.indexOf(id);
    const from = range && this.anchor !== null ? ids.indexOf(this.anchor) : -1;
    const span = from < 0 ? [id] : ids.slice(Math.min(from, to), Math.max(from, to) + 1);
    const on = !this.picked.has(id);
    for (const x of span) {
      if (!on) this.picked.delete(x);
      else if (this.picked.size < MAX_PICK) this.picked.add(x);
    }
    this.anchor = id;
  }

  /** Check every loaded link, or none when they already are. */
  togglePickAll() {
    if (this.stale) return;
    const ids = this.items.slice(0, MAX_PICK).map((l) => l.id);
    const all = ids.length > 0 && ids.every((id) => this.picked.has(id));
    this.picked.clear();
    if (!all) for (const id of ids) this.picked.add(id);
  }

  /** Turns the checked links on or off, or deletes them with undo. */
  async bulk(action: Exclude<BulkAction, 'restore'>) {
    const targets = this.items.filter((l) => this.picked.has(l.id));
    if (!targets.length || this.busy || this.stale) return;
    this.busy = true;
    try {
      if (action === 'delete') await this.bulkDelete(targets);
      else await this.bulkSwitch(action, targets);
    } finally {
      this.busy = false;
    }
  }

  private async bulkSwitch(action: 'enable' | 'disable', targets: Link[]) {
    try {
      const { items } = await api.bulk(action, targets.map((l) => l.id));
      for (const l of items) this.upsert(l);
      toasts.show(
        items.length ? t(action === 'enable' ? 'bulk.turnedOn' : 'bulk.turnedOff', { n: items.length }) : t('bulk.unchanged'),
      );
    } catch (e) {
      toasts.error(errorText(e instanceof ApiError ? e.code : 'unknown'));
    }
  }

  private async bulkDelete(targets: Link[]) {
    const ids = new Set(targets.map((l) => l.id));
    const removed = this.items.map((link, index) => ({ link, index })).filter((x) => ids.has(x.link.id));
    try {
      await api.bulk('delete', [...ids]);
    } catch (e) {
      toasts.error(errorText(e instanceof ApiError ? e.code : 'unknown'));
      return;
    }
    ++this.revision;
    for (const id of ids) {
      this.leaving.add(id);
      setTimeout(() => this.leaving.delete(id), 400);
    }
    this.items = this.items.filter((l) => !ids.has(l.id));
    this.total = Math.max(0, this.total - ids.size);
    if (this.selectedId !== null && ids.has(this.selectedId)) this.selectedId = null;
    this.stopPicking();
    await this.refresh();
    toasts.show(t('bulk.deleted', { n: ids.size }), {
      action: { label: t('act.undo'), run: () => this.bulkRestore(removed) },
    });
  }

  private async bulkRestore(removed: { link: Link; index: number }[]) {
    try {
      const { items } = await api.bulk(
        'restore',
        removed.map((x) => x.link.id),
      );
      const back = new Map(items.map((l) => [l.id, l]));
      // Ascending, so each link lands where it was.
      for (const { link, index } of removed) {
        const restored = back.get(link.id);
        if (!restored) continue;
        this.place({ ...restored, spark: link.spark }, index);
        this.flash(restored.id);
      }
      await this.refresh();
      toasts.show(t('bulk.restored', { n: items.length }));
    } catch (e) {
      toasts.error(errorText(e instanceof ApiError ? e.code : 'unknown'));
    }
  }

  async restore(link: Link, index: number) {
    try {
      const restored = await api.restoreLink(link.id);
      this.place({ ...restored, spark: link.spark }, index);
      this.flash(restored.id);
      this.selectedId = restored.id;
      await this.refresh();
      toasts.show(t('detail.restored', { slug: '/' + restored.slug }));
    } catch (e) {
      toasts.error(errorText(e instanceof ApiError ? e.code : 'unknown'));
    }
  }
}

export const links = new LinksStore();
