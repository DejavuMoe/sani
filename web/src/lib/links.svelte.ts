import { SvelteSet } from 'svelte/reactivity';
import { api, ApiError, type BulkAction, type Link, type LinkInput, type Overview, type Sort } from './api';
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
  /** First page for the current query has arrived. */
  loaded = $state(false);
  loading = $state(false);
  loadingMore = $state(false);
  failed = $state(false);

  expandedId = $state<number | null>(null);
  editingId = $state<number | null>(null);
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
  private ctrl: AbortController | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  async load() {
    this.ctrl?.abort();
    const ctrl = (this.ctrl = new AbortController());
    const seq = ++this.seq;
    this.loading = true;
    this.failed = false;
    try {
      const res = await api.links({ q: this.query, sort: this.sort, limit: PAGE }, ctrl.signal);
      if (seq !== this.seq) return;
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
    if (!this.next || this.loadingMore || this.loading) return;
    const seq = this.seq;
    this.loadingMore = true;
    try {
      const res = await api.links({ q: this.query, sort: this.sort, cursor: this.next, limit: PAGE });
      if (seq !== this.seq) return;
      const seen = new Set(this.items.map((l) => l.id));
      this.items = [...this.items, ...res.items.filter((l) => !seen.has(l.id))];
      this.next = res.next;
      this.total = res.total;
    } catch {
      /* the sentinel will try again when it comes back into view */
    } finally {
      this.loadingMore = false;
    }
  }

  search(q: string) {
    this.query = q;
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), q ? 140 : 0);
  }

  setSort(sort: Sort) {
    if (sort === this.sort) return;
    this.sort = sort;
    this.load();
  }

  /** Refresh counts after returning to the tab, keeping scroll and pages. */
  async refresh() {
    this.refreshOverview();
    if (!this.loaded) return;
    const seq = this.seq;
    try {
      const res = await api.links({ q: this.query, sort: this.sort, limit: Math.min(200, Math.max(PAGE, this.items.length)) });
      if (seq !== this.seq) return;
      const byId = new Map(res.items.map((l) => [l.id, l]));
      this.items = this.items.map((l) => byId.get(l.id) ?? l);
      const known = new Set(this.items.map((l) => l.id));
      const added = res.items.filter((l) => !known.has(l.id));
      if (added.length && this.sort === 'created') this.items = [...added, ...this.items];
      this.total = res.total;
    } catch {
      /* stale counts are fine */
    }
  }

  async refreshOverview() {
    try {
      this.overview = await api.overview(30);
    } catch {
      /* keep the previous numbers */
    }
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
    const visible = !this.query || [link.slug, link.title, link.url].some((s) => s.toLowerCase().includes(this.query.toLowerCase()));
    if (!visible) return;
    const at = this.sort === 'created' && index === 0 ? 0 : Math.min(index, this.items.length);
    this.items = [...this.items.slice(0, at), link, ...this.items.slice(at)];
    this.total += 1;
  }

  upsert(link: Link) {
    const i = this.items.findIndex((l) => l.id === link.id);
    if (i < 0) return;
    const prev = this.items[i];
    this.items[i] = { ...link, spark: link.spark ?? prev.spark };
  }

  async create(input: LinkInput): Promise<Link> {
    const link = await api.createLink(input);
    this.place(link);
    this.flash(link.id);
    this.selectedId = link.id;
    this.refreshOverview();
    this.watchMeta(link);
    return link;
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
    this.refreshOverview();
    toasts.show(t('detail.deleted', { slug: '/' + link.slug }), {
      action: { label: t('act.undo'), run: () => this.restore(link, index) },
    });
  }

  startPicking() {
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
    const ids = this.items.slice(0, MAX_PICK).map((l) => l.id);
    const all = ids.length > 0 && ids.every((id) => this.picked.has(id));
    this.picked.clear();
    if (!all) for (const id of ids) this.picked.add(id);
  }

  /** Turns the checked links on or off, or deletes them with undo. */
  async bulk(action: Exclude<BulkAction, 'restore'>) {
    const targets = this.items.filter((l) => this.picked.has(l.id));
    if (!targets.length || this.busy) return;
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
    for (const id of ids) {
      this.leaving.add(id);
      setTimeout(() => this.leaving.delete(id), 400);
    }
    this.items = this.items.filter((l) => !ids.has(l.id));
    this.total = Math.max(0, this.total - ids.size);
    if (this.selectedId !== null && ids.has(this.selectedId)) this.selectedId = null;
    this.stopPicking();
    this.refreshOverview();
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
      this.refreshOverview();
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
      this.refreshOverview();
      toasts.show(t('detail.restored', { slug: '/' + restored.slug }));
    } catch (e) {
      toasts.error(errorText(e instanceof ApiError ? e.code : 'unknown'));
    }
  }
}

export const links = new LinksStore();
