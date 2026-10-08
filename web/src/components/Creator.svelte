<script lang="ts">
  import { tick } from 'svelte';
  import type { LinkKind } from '../lib/api';
  import { t } from '../lib/i18n.svelte';
  import Composer from './Composer.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import ShareComposer from './ShareComposer.svelte';

  // All three stay mounted, so switching tabs never loses a draft.
  let mode = $state<LinkKind>('url');
  let composer = $state<Composer>();
  let texts = $state<ShareComposer>();
  let files = $state<ShareComposer>();

  const modes: { kind: LinkKind; icon: IconName }[] = [
    { kind: 'url', icon: 'link' },
    { kind: 'text', icon: 'text' },
    { kind: 'file', icon: 'file' },
  ];

  async function show(kind: LinkKind) {
    mode = kind;
    await tick();
  }

  export async function fill(url: string, how: 'paste' | 'drop' | 'prefill') {
    await show('url');
    composer?.fill(url, how);
  }

  export async function fillText(text: string) {
    await show('text');
    texts?.fillText(text);
  }

  export async function fillFile(file: File) {
    await show('file');
    files?.fillFile(file);
  }

  export function focus() {
    if (mode === 'url') composer?.focus();
    else if (mode === 'text') texts?.focus();
    else files?.focus();
  }

  function onkeydown(e: KeyboardEvent) {
    const i = modes.findIndex((m) => m.kind === mode);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % modes.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + modes.length) % modes.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = modes.length - 1;
    if (next < 0) return;
    e.preventDefault();
    mode = modes[next].kind;
    document.getElementById(`create-tab-${mode}`)?.focus();
  }
</script>

<section class="creator" aria-label={t('create.label')}>
  <div class="tabs" role="tablist" aria-label={t('create.label')} tabindex="-1" {onkeydown}>
    {#each modes as m (m.kind)}
      <button
        type="button"
        role="tab"
        id="create-tab-{m.kind}"
        aria-selected={mode === m.kind}
        aria-controls="create-panel-{m.kind}"
        tabindex={mode === m.kind ? 0 : -1}
        onclick={() => show(m.kind)}
      >
        <Icon name={m.icon} size={14} />
        {t(`create.${m.kind}`)}
      </button>
    {/each}
  </div>
  <div role="tabpanel" id="create-panel-url" aria-labelledby="create-tab-url" hidden={mode !== 'url'} inert={mode !== 'url'}>
    <Composer bind:this={composer} />
  </div>
  <div role="tabpanel" id="create-panel-text" aria-labelledby="create-tab-text" hidden={mode !== 'text'} inert={mode !== 'text'}>
    <ShareComposer bind:this={texts} mode="text" />
  </div>
  <div role="tabpanel" id="create-panel-file" aria-labelledby="create-tab-file" hidden={mode !== 'file'} inert={mode !== 'file'}>
    <ShareComposer bind:this={files} mode="file" />
  </div>
</section>

<style>
  .tabs {
    display: flex;
    gap: 2px;
    margin: 0 0 8px 2px;
  }

  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--radius);
    color: var(--text-2);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    transition:
      background-color var(--fast) var(--ease),
      color var(--fast) var(--ease);
  }

  .tabs button:hover {
    color: var(--text);
  }

  .tabs button[aria-selected='true'] {
    background: var(--surface-3);
    color: var(--text);
  }

  .tabs button :global(.icon) {
    color: var(--text-3);
  }

  .tabs button[aria-selected='true'] :global(.icon) {
    color: var(--text-2);
  }
</style>
