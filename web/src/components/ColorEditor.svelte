<script lang="ts">
  import { untrack } from 'svelte';
  import type { TagColor } from '../lib/api';
  import { t } from '../lib/i18n.svelte';
  import { TAG_COLORS, normalizeTagColor, tagHex } from '../lib/tags';

  let { value = $bindable<TagColor>('#5872a5'), valid = $bindable(true), disabled = false }: { value?: TagColor; valid?: boolean; disabled?: boolean } = $props();
  const id = $props.id();
  let draft = $state(untrack(() => tagHex(value)));
  function choose(color: TagColor) { value = color; draft = tagHex(color); valid = true; }
  function edit() {
    const normalized = normalizeTagColor(draft);
    valid = normalized !== null;
    if (normalized) value = normalized;
  }
</script>

<div class="color-editor">
  <div class="color-swatches" role="group" aria-label={t('tags.color')}>
    {#each TAG_COLORS as [color, label]}
      <button type="button" {disabled} aria-label={t(label)} aria-pressed={tagHex(value) === color} onclick={() => choose(color)}>
        <span class="tag-swatch" style:--tag-color={color}></span>
      </button>
    {/each}
  </div>
  <label class="color-label" for={id}>{t('tags.customColor')}</label>
  <div class="color-input">
    <input class="native-color" type="color" value={tagHex(value)} {disabled} aria-label={t('tags.picker')} oninput={e => choose(e.currentTarget.value as TagColor)} />
    <input class="field" {id} bind:value={draft} {disabled} spellcheck="false" autocomplete="off" aria-invalid={!valid || undefined} aria-describedby="{id}-hint" oninput={edit} onblur={() => { if (valid) draft = tagHex(value); }} />
  </div>
  <p id="{id}-hint" class="hint" class:error-text={!valid}>{t(valid ? 'tags.colorHint' : 'tags.colorInvalid')}</p>
</div>
