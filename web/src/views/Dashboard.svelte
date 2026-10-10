<script lang="ts">
  import { onMount } from 'svelte';
  import AppHeader from '../components/AppHeader.svelte';
  import Creator from '../components/Creator.svelte';
  import LinkList from '../components/LinkList.svelte';
  import Summary from '../components/Summary.svelte';
  import { copyText } from '../lib/clipboard';
  import { t } from '../lib/i18n.svelte';
  import { isMac, isTyping, plainKey } from '../lib/keys';
  import { links } from '../lib/links.svelte';
  import { toasts } from '../lib/toast.svelte';
  import { ui } from '../lib/ui.svelte';
  import { extractURL, stripScheme } from '../lib/url';

  let composer = $state<Creator>();
  let list = $state<LinkList>();

  onMount(() => {
    if (!links.loaded) links.load();
    links.refreshOverview();

    // Counts drift while the page sits open; refresh them quietly.
    let last = Date.now();
    const refresh = () => {
      if (document.hidden || Date.now() - last < 10_000) return;
      last = Date.now();
      links.refresh();
    };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  });

  function rowButton(id: number) {
    return document.querySelector<HTMLElement>(`[data-link="${id}"] .main`);
  }

  function move(delta: number): boolean {
    const items = links.items;
    if (!items.length) return false;
    let i = items.findIndex((l) => l.id === links.selectedId);
    i = i < 0 ? (delta > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, i + delta));
    links.selectedId = items[i].id;
    const el = rowButton(items[i].id);
    el?.focus({ preventScroll: true });
    el?.closest('.row')?.scrollIntoView({ block: 'nearest' });
    return true;
  }

  const selected = () => links.items.find((l) => l.id === links.selectedId);

  function overlayOpen(): boolean {
    try {
      return !!document.querySelector('dialog[open], :popover-open:not([role="tooltip"])');
    } catch {
      return !!document.querySelector('dialog[open]');
    }
  }

  function removeSelected(e: KeyboardEvent) {
    // With links checked, the delete key acts on all of them.
    if (links.picked.size) {
      e.preventDefault();
      links.bulk('delete');
      return;
    }
    const l = selected();
    if (!l) return;
    e.preventDefault();
    links.remove(l).then(() => {
      if (links.selectedId !== null) rowButton(links.selectedId)?.focus({ preventScroll: true });
    });
  }

  function onkeydown(e: KeyboardEvent) {
    if (overlayOpen()) return;
    if (links.stale && !['/','n','?','Escape'].includes(e.key)) return;
    // ⌘⌫ on a Mac, Delete elsewhere; a bare Backspace is too easy to hit.
    if (isMac && e.key === 'Backspace' && e.metaKey && !isTyping(e.target)) return removeSelected(e);
    if (e.key === 'Escape' && !isTyping(e.target)) {
      if (links.editingId !== null) links.editingId = null;
      else if (links.expandedId !== null) {
        const id = links.expandedId;
        links.expandedId = null;
        rowButton(id)?.focus();
      } else if (links.picking) links.stopPicking();
      else if (links.query) links.search('');
      else links.selectedId = null;
      return;
    }
    if (!plainKey(e)) return;
    const onButton = (e.target as HTMLElement).closest?.('button, a');
    switch (e.key) {
      case '/':
        e.preventDefault();
        list?.focusSearch();
        break;
      case 'n':
        e.preventDefault();
        composer?.focus();
        break;
      case '?':
        e.preventDefault();
        ui.shortcuts = true;
        break;
      case 'j':
      case 'ArrowDown':
        if (move(1)) e.preventDefault();
        break;
      case 'k':
      case 'ArrowUp':
        if (move(-1)) e.preventDefault();
        break;
      case 'Enter': {
        // A focused row button handles Enter itself.
        const l = selected();
        if (!l || onButton) return;
        e.preventDefault();
        if (links.picking) links.togglePick(l.id);
        else links.expandedId = links.expandedId === l.id ? null : l.id;
        break;
      }
      case 'x':
      case 'X': {
        const l = selected();
        if (!l) return;
        e.preventDefault();
        links.togglePick(l.id, e.shiftKey);
        break;
      }
      case 'c': {
        const l = selected();
        if (!l) return;
        e.preventDefault();
        copyText(l.shortUrl).then((ok) => ok && toasts.success(t('act.copied'), { detail: stripScheme(l.shortUrl) }));
        break;
      }
      case 'e': {
        const l = selected();
        if (!l || links.picking) return;
        e.preventDefault();
        links.expandedId = l.id;
        links.editingId = l.id;
        break;
      }
      case 'Delete':
        removeSelected(e);
        break;
    }
  }

  // Paste anywhere on the page: a link to shorten it, a file or other text
  // to share it.
  function onpaste(e: ClipboardEvent) {
    if (isTyping(e.target) || document.querySelector('dialog[open]')) return;
    const file = e.clipboardData?.files[0];
    if (file) {
      e.preventDefault();
      composer?.fillFile(file);
      return;
    }
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const url = extractURL(text);
    // A URL inside a longer text is still a text to share.
    if (url && (url === text.trim() || !text.includes('\n'))) {
      e.preventDefault();
      composer?.fill(url, 'paste');
    } else if (text.trim()) {
      e.preventDefault();
      composer?.fillText(text);
    }
  }

  function ondragover(e: DragEvent) {
    const types = e.dataTransfer?.types ?? [];
    if (types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain')) e.preventDefault();
  }

  function ondrop(e: DragEvent) {
    if (isTyping(e.target)) return;
    const data = e.dataTransfer;
    const file = data?.files[0];
    if (file) {
      e.preventDefault();
      composer?.fillFile(file);
      return;
    }
    const url = extractURL(data?.getData('text/uri-list').split('\n')[0] || data?.getData('text/plain') || '');
    if (!url) return;
    e.preventDefault();
    composer?.fill(url, 'drop');
  }
</script>

<svelte:window {onkeydown} {ondragover} {ondrop} />
<svelte:document {onpaste} />

<AppHeader />
<main class="page">
  <h1 class="sr-only">Sani</h1>
  <Creator bind:this={composer} />
  <Summary />
  <LinkList bind:this={list} />
</main>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 28px;
    width: min(100%, calc(var(--page) + 2 * var(--gutter)));
    margin: 0 auto;
    padding: 20px var(--gutter) 96px;
  }

  @media (max-width: 640px) {
    .page {
      gap: 22px;
      padding-top: 8px;
    }
  }
</style>
