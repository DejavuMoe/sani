/*
 * The links store (web/src/lib/links.svelte.ts) over an in-memory copy of the
 * captured fixtures instead of the API. Same state, same actions, same toasts;
 * requests resolve after `latency` ms so loading states can be seen.
 */
const PAGE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const MAX_PICK = 500;

function linkStatus(l, now) {
  if (!l.enabled) return 'disabled';
  if (l.expiresAt && Date.parse(l.expiresAt) <= now) return 'expired';
  if (l.maxClicks && l.clicks >= l.maxClicks) return 'exhausted';
  return 'active';
}

function zeroDays(n, now) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    out.push({ date: toLocalInput(d).slice(0, 10), count: 0 });
  }
  return out;
}

function sortItems(items, sort) {
  const by = {
    created: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id,
    clicks: (a, b) => b.clicks - a.clicks || b.id - a.id,
    visited: (a, b) => (b.lastClickAt ? Date.parse(b.lastClickAt) : 0) - (a.lastClickAt ? Date.parse(a.lastClickAt) : 0) || b.id - a.id,
  }[sort];
  return [...items].sort(by);
}

function matches(l, q, kind) {
  const s = q.toLowerCase();
  const fields = [l.slug, l.title, l.url, l.content?.preview ?? '', l.content?.name ?? ''];
  return (!s || fields.some((f) => (f ?? '').toLowerCase().includes(s))) && (!kind || kind === l.kind);
}

/**
 * options: { latency, preset } where preset seeds view state for boards and
 * scenes: { empty, failed, loading, query, kind, sort, expandedId, editingId,
 * selectedId, picking, picked:[ids], overview:null }.
 */
function useLinksStore({ toasts, i18n, latency = 220, preset = {} } = {}) {
  const now = i18n.now;
  const db = React.useRef(null);
  if (!db.current) {
    const samples = [['netcup', 'aff'], ['dmit'], ['reading'], [], ['work'], ['aff'], ['netcup'], ['reading', 'work']];
    const links = preset.empty ? [] : FIX.links.map((l, i) => ({ ...l, tags: [...samples[i % samples.length]] }));
    db.current = {
      links,
      deleted: new Map(),
      stats: JSON.parse(JSON.stringify(FIX.stats)),
      texts: { ...FIX.texts },
      nextId: Math.max(0, ...FIX.links.map((l) => l.id)) + 1,
      failNextSave: !!preset.tagSaveError,
      failUpload: !!preset.uploadError,
      uploaded: new WeakMap(),
    };
  }
  const i18nRef = React.useRef(i18n);
  i18nRef.current = i18n;
  const t = (...a) => i18nRef.current.t(...a);
  const errorText = (c) => i18nRef.current.errorText(c);

  const view = (q, kind, sort, tag = null) => sortItems(db.current.links.filter((l) => matches(l, q, kind) && matchesTag(l, tag)), sort);
  const overviewOf = () => {
    if (preset.empty) return { links: 0, clicks: 0, today: 0, days: zeroDays(30, now) };
    return { ...FIX.overview, links: db.current.links.length };
  };

  const [s, setS] = React.useState(() => {
    const query = preset.query ?? '';
    const kind = preset.kind ?? null;
    const sort = preset.sort ?? 'created';
    const tag = preset.tag ?? null;
    const items = view(query, kind, sort, tag);
    return {
      items,
      total: items.length,
      query,
      sort,
      kind,
      tag,
      tags: preset.empty ? [] : TAG_FIXTURES.map(tag => ({ ...tag })),
      loaded: !preset.loading && !preset.failed,
      loading: false,
      loadingMore: false,
      failed: !!preset.failed,
      expandedId: preset.expandedId ?? null,
      editingId: preset.editingId ?? null,
      selectedId: preset.selectedId ?? preset.expandedId ?? null,
      fresh: new Set(preset.fresh ?? []),
      leaving: new Set(),
      overview: preset.overview === null ? null : overviewOf(),
      picking: !!preset.picking,
      picked: new Set(preset.picked ?? []),
      busy: false,
    };
  });
  const ref = React.useRef(s);
  ref.current = s;
  const set = (patch) => setS((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));
  const wait = (ms = latency) => new Promise((r) => setTimeout(r, ms));
  const anchor = React.useRef(null);
  const searchTimer = React.useRef();

  const actions = React.useMemo(() => {
    const flash = (id) => {
      set((p) => ({ fresh: new Set([...p.fresh, id]) }));
      setTimeout(() => set((p) => ({ fresh: new Set([...p.fresh].filter((x) => x !== id)) })), 2400);
    };
    const refreshOverview = () => set({ overview: overviewOf() });
    const load = async () => {
      set({ loading: true, failed: false });
      await wait();
      const { query, kind, sort, tag, selectedId } = ref.current;
      const items = view(query, kind, sort, tag);
      set({
        items,
        total: items.length,
        loaded: true,
        loading: false,
        picked: new Set(),
        selectedId: items.some((l) => l.id === selectedId) ? selectedId : null,
      });
      anchor.current = null;
    };
    const place = (link, index = 0) => {
      set((p) => {
        if (p.items.some((l) => l.id === link.id)) return { items: p.items.map((l) => (l.id === link.id ? link : l)) };
        if (!matches(link, p.query, p.kind) || !matchesTag(link, p.tag)) return {};
        const at = p.sort === 'created' && index === 0 ? 0 : Math.min(index, p.items.length);
        return { items: [...p.items.slice(0, at), link, ...p.items.slice(at)], total: p.total + 1 };
      });
    };
    const upsert = (link) => {
      const i = db.current.links.findIndex((l) => l.id === link.id);
      if (i >= 0) db.current.links[i] = link;
      set((p) => {
        const items = view(p.query, p.kind, p.sort, p.tag);
        return { items, total: items.length };
      });
    };
    const slugFor = (want, kind) => {
      const alphabet = FIX.config.excludeConfusable ? PAGE_ALPHABET : "0123456789abcdefghijklmnopqrstuvwxyz";
      const length = kind === "url" ? FIX.config.slugLength : Math.max(10, FIX.config.slugLength);
      if (want) return want;
      let x;
      do x = Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
      while (db.current.links.some((l) => l.slug === x));
      return x;
    };
    const fail = (code) => Object.assign(new Error(code), { code });
    const check = (input) => {
      if (db.current.failNextSave) {
        db.current.failNextSave = false;
        throw fail('network');
      }
      if (input.slug) {
        const p = slugProblem(input.slug);
        if (p) throw fail(p === 'tooLong' ? 'slug_too_long' : 'slug_invalid');
        if (db.current.links.some((l) => sameSlug(l.slug, input.slug))) throw fail('slug_taken');
      }
    };
    const added = (link) => {
      db.current.links.unshift(link);
      db.current.stats[link.id] = { 7: { days: zeroDays(7, Date.now()), referrers: [], referrersTotal: 0 }, 30: { days: zeroDays(30, Date.now()), referrers: [], referrersTotal: 0 }, 90: { days: zeroDays(90, Date.now()), referrers: [], referrersTotal: 0 } };
      const items = view('', null, 'created');
      set({ items, total: items.length, query: '', kind: null, tag: null, sort: 'created' });
      flash(link.id);
      set({ selectedId: link.id });
      refreshOverview();
    };
    const base = (kind, input) => {
      const slug = slugFor(input.slug, kind);
      const shortUrl = `${FIX.config.baseUrl}/${kind === 'url' ? '' : 'p/'}${slug}`;
      const at = new Date().toISOString();
      return {
        id: db.current.nextId++,
        kind,
        slug,
        shortUrl,
        url: '',
        host: '',
        title: input.title ?? '',
        tags: [...(input.tags ?? [])],
        meta: input.title ? 'manual' : 'pending',
        icon: false,
        enabled: true,
        status: 'active',
        expiresAt: input.expiresAt ?? null,
        maxClicks: input.maxClicks ?? null,
        redirect: input.redirect ?? 302,
        clicks: 0,
        lastClickAt: null,
        createdAt: at,
        updatedAt: at,
        spark: new Array(14).fill(0),
      };
    };

    return {
      load,
      refreshOverview,
      upsert,
      addTag(name, color) {
        const found = ref.current.tags.find(tag => tagKey(tag.name) === tagKey(name));
        if (found) return found;
        const tag = { id: 'tag-' + crypto.randomUUID(), name: name.trim().normalize('NFC'), color };
        set(p => ({ tags: [...p.tags, tag] }));
        return tag;
      },
      updateTag(id, name, color) {
        set(p => ({ tags: p.tags.map(tag => tag.id === id ? { ...tag, name, color } : tag) }));
      },
      exportLinks() {
        return db.current.links.filter(l => l.kind === 'url').map(l => ({ slug: l.slug, url: l.url, title: l.title, redirect: l.redirect, enabled: l.enabled, expires_at: l.expiresAt, max_clicks: l.maxClicks, clicks: l.clicks, created_at: l.createdAt, tags: (l.tags ?? []).map(id => ref.current.tags.find(t => t.id === id)).filter(Boolean).map(({ name, color }) => ({ name, color })) }));
      },
      setTag(tag) {
        set({ tag, expandedId: null, editingId: null, picking: false, picked: new Set() });
        load();
      },
      clearFilters() {
        set({ tag: null, kind: null, query: '' });
        load();
      },
      search(q) {
        set({ query: q });
        clearTimeout(searchTimer.current);
        searchTimer.current = setTimeout(load, q ? 140 : 0);
      },
      setSort(sort) {
        if (sort === ref.current.sort) return;
        set({ sort });
        load();
      },
      setKind(kind) {
        if (kind === ref.current.kind) return;
        set({ kind });
        load();
      },
      setExpanded: (id) => set({ expandedId: id }),
      setEditing: (id) => set({ editingId: id }),
      setSelected: (id) => set({ selectedId: id }),
      linkStats: (id, days) => db.current.stats[id]?.[days] ?? { days: zeroDays(days, now), referrers: [], referrersTotal: 0 },
      linkText: (id) => db.current.texts[id] ?? '',

      async create(input) {
        await wait();
        if (!input.url) throw fail('url_required');
        if (!looksLikeURL(input.url)) throw fail('url_invalid');
        const url = /^[a-z][a-z0-9+.-]*:/i.test(input.url) ? input.url : `https://${input.url}`;
        if (input.reuse) {
          const same = db.current.links.find((l) => l.kind === 'url' && l.url === url);
          if (same) {
            const next = { ...same, tags: [...(input.tags ?? same.tags ?? [])] };
            upsert(next);
            return { ...next, reused: true };
          }
        }
        check(input);
        const link = { ...base('url', input), url, host: displayParts(url).host };
        added(link);
        if (link.meta === 'pending') setTimeout(() => {
          const current = db.current.links.find(l => l.id === link.id);
          if (current?.meta === 'pending') upsert({ ...current, meta: 'failed' });
        }, 1500);
        return link;
      },
      async createText(input) {
        await wait();
        if (!input.text.trim()) throw fail('text_required');
        check(input);
        const lines = input.text.split('\n').length;
        const preview = input.text.trim().split('\n')[0].slice(0, 80);
        const link = {
          ...base('text', input),
          meta: 'manual',
          content: { format: input.format, lines, size: byteLength(input.text), name: preview, preview, rawUrl: `${FIX.config.filesUrl}/r/${Math.random().toString(36).slice(2, 10)}` },
        };
        db.current.texts[link.id] = input.text;
        added(link);
        return link;
      },
      async createFile(file, input, onProgress, signal) {
        check(input);
        for (let sent = db.current.uploaded.get(file) ?? 0; sent < file.size; ) {
          if (signal?.aborted) { db.current.uploaded.delete(file); throw new DOMException('aborted', 'AbortError'); }
          await wait(180);
          if (db.current.failUpload && sent >= 25000000) { db.current.failUpload = false; throw fail('network'); }
          sent = Math.min(file.size, sent + Math.max(file.size / 16, 1));
          db.current.uploaded.set(file, Math.floor(sent / 25000000) * 25000000);
          onProgress?.(sent, file.size);
        }
        if (signal?.aborted) { db.current.uploaded.delete(file); throw new DOMException('aborted', 'AbortError'); }
        db.current.uploaded.delete(file);
        const link = {
          ...base('file', input),
          meta: 'manual',
          content: { name: file.name, type: file.type, size: file.size, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', rawUrl: `${FIX.config.filesUrl}/r/${Math.random().toString(36).slice(2, 10)}` },
        };
        added(link);
        return link;
      },
      async update(id, patch) {
        await wait();
        const prev = db.current.links.find((l) => l.id === id);
        if (patch.slug !== undefined && !sameSlug(patch.slug, prev.slug)) check({ slug: patch.slug });
        if (patch.url !== undefined && !looksLikeURL(patch.url)) throw fail('url_invalid');
        if (patch.text !== undefined) db.current.texts[id] = patch.text;
        const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
        if (patch.slug !== undefined) next.shortUrl = `${FIX.config.baseUrl}/${prev.kind === 'url' ? '' : 'p/'}${patch.slug}`;
        if (patch.url !== undefined) next.host = displayParts(patch.url).host;
        if (patch.title !== undefined) next.meta = patch.title ? 'manual' : prev.meta;
        if (patch.format !== undefined) next.content = { ...prev.content, format: patch.format };
        delete next.text;
        next.status = linkStatus(next, Date.now());
        upsert(next);
        return next;
      },
      async setEnabled(link, enabled) {
        const prev = ref.current.items.find((l) => l.id === link.id);
        if (prev) upsert({ ...prev, enabled, status: enabled ? 'active' : 'disabled' });
        const updated = await this.update(link.id, { enabled });
        toasts.show(t(enabled ? 'detail.turnedOn' : 'detail.turnedOff', { slug: '/' + updated.slug }));
      },
      async remove(link) {
        const p = ref.current;
        const index = p.items.findIndex((l) => l.id === link.id);
        const neighbor = p.items[index + 1] ?? p.items[index - 1] ?? null;
        db.current.links = db.current.links.filter((l) => l.id !== link.id);
        db.current.deleted.set(link.id, link);
        set({
          items: p.items.filter((l) => l.id !== link.id),
          total: Math.max(0, p.total - 1),
          expandedId: p.expandedId === link.id ? null : p.expandedId,
          editingId: p.editingId === link.id ? null : p.editingId,
          selectedId: p.selectedId === link.id ? neighbor?.id ?? null : p.selectedId,
        });
        await wait();
        refreshOverview();
        toasts.show(t('detail.deleted', { slug: '/' + link.slug }), {
          action: { label: t('act.undo'), run: () => this.restore(link, index) },
        });
      },
      async restore(link, index) {
        await wait();
        db.current.deleted.delete(link.id);
        db.current.links.push(link);
        place(link, index);
        flash(link.id);
        set({ selectedId: link.id });
        refreshOverview();
        toasts.show(t('detail.restored', { slug: '/' + link.slug }));
      },
      startPicking: () => set({ picking: true, expandedId: null, editingId: null }),
      stopPicking() {
        set({ picking: false, picked: new Set() });
        anchor.current = null;
      },
      togglePick(id, range = false) {
        set((p) => {
          const ids = p.items.map((l) => l.id);
          const to = ids.indexOf(id);
          const from = range && anchor.current !== null ? ids.indexOf(anchor.current) : -1;
          const span = from < 0 ? [id] : ids.slice(Math.min(from, to), Math.max(from, to) + 1);
          const picked = new Set(p.picked);
          const on = !picked.has(id);
          for (const x of span) {
            if (!on) picked.delete(x);
            else if (picked.size < MAX_PICK) picked.add(x);
          }
          anchor.current = id;
          return { picking: true, picked, ...(p.picking ? {} : { expandedId: null, editingId: null }) };
        });
      },
      togglePickAll() {
        set((p) => {
          const ids = p.items.slice(0, MAX_PICK).map((l) => l.id);
          const all = ids.length > 0 && ids.every((id) => p.picked.has(id));
          return { picked: all ? new Set() : new Set(ids) };
        });
      },
      async bulk(action) {
        const p = ref.current;
        const targets = p.items.filter((l) => p.picked.has(l.id));
        if (!targets.length || p.busy) return;
        set({ busy: true });
        await wait();
        if (action === 'delete') {
          const ids = new Set(targets.map((l) => l.id));
          const removed = p.items.map((link, index) => ({ link, index })).filter((x) => ids.has(x.link.id));
          db.current.links = db.current.links.filter((l) => !ids.has(l.id));
          set((q) => ({
            items: q.items.filter((l) => !ids.has(l.id)),
            total: Math.max(0, q.total - ids.size),
            selectedId: q.selectedId !== null && ids.has(q.selectedId) ? null : q.selectedId,
            picking: false,
            picked: new Set(),
            busy: false,
          }));
          refreshOverview();
          toasts.show(t('bulk.deleted', { n: ids.size }), {
            action: {
              label: t('act.undo'),
              run: async () => {
                await wait();
                for (const { link, index } of removed) {
                  db.current.links.push(link);
                  place(link, index);
                  flash(link.id);
                }
                refreshOverview();
                toasts.show(t('bulk.restored', { n: removed.length }));
              },
            },
          });
          return;
        }
        const enabled = action === 'enable';
        const changed = targets.filter((l) => l.enabled !== enabled);
        for (const l of changed) {
          const next = { ...l, enabled };
          next.status = linkStatus(next, Date.now());
          upsert(next);
        }
        set({ busy: false });
        toasts.show(changed.length ? t(enabled ? 'bulk.turnedOn' : 'bulk.turnedOff', { n: changed.length }) : t('bulk.unchanged'));
      },
    };
  }, []);

  const tagCounts = Object.fromEntries(s.tags.map(tag => [tag.id, db.current.links.filter(link => link.tags.includes(tag.id)).length]));
  return { ...s, ...actions, errorText, tagCounts, allCount: db.current.links.length, untaggedCount: db.current.links.filter(link => !link.tags.length).length };
}

Object.assign(window, { useLinksStore, MAX_PICK, linkStatus, zeroDays });
