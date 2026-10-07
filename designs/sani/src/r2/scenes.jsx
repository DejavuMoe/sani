Object.assign(SCENES, {
  'tags-create': { group: 'tags', dashboard: { composer: { url: 'https://example.com/guide', tags: ['netcup', 'aff'] } } },
  'tags-filter': { group: 'tags', store: { tag: 'netcup' } },
  'tags-untagged': { group: 'tags', store: { tag: '__untagged' } },
  'tags-empty': { group: 'tags', store: { empty: true } },
  'tags-noresults': { group: 'tags', store: { tag: 'netcup', query: 'no-matching-link' } },
  'tags-edit': { group: 'tags', store: () => { const id = FIX.links.find(l => l.slug === 'blog').id; return { expandedId: id, editingId: id }; } },
  'tags-save-error': { group: 'tags', store: { tagSaveError: true }, dashboard: { composer: { url: 'https://example.com/guide', tags: ['netcup'] } } },
});
