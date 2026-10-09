<script lang="ts">
  import { untrack } from 'svelte';
  import type { TagColor } from '../lib/api';
  import { t } from '../lib/i18n.svelte';
  import { TAG_COLORS, normalizeTagColor, tagHex } from '../lib/tags';

  let { value = $bindable<TagColor>('#5872a5'), valid = $bindable(true), disabled = false }: { value?: TagColor; valid?: boolean; disabled?: boolean } = $props();
  const id = $props.id();
  let draft = $state(untrack(() => tagHex(value)));
  const channels = $derived([1, 3, 5].map(i => parseInt(tagHex(value).slice(i, i + 2), 16)));
  function channel(index: number, value: number) { const next = [...channels]; next[index] = value; choose(('#' + next.map(n => n.toString(16).padStart(2, '0')).join('')) as TagColor); }
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
    <span class="color-preview" style:background={tagHex(value)} aria-hidden="true"></span>
    <input class="field" {id} bind:value={draft} {disabled} spellcheck="false" autocomplete="off" aria-invalid={!valid || undefined} aria-describedby="{id}-hint" oninput={edit} onblur={() => { if (valid) draft = tagHex(value); }} />
  </div>
  <div class="color-sliders">
    {#each ['color.red', 'color.green', 'color.blue'] as label, i}
      <label>{t(label as 'color.red')}<input type="range" min="0" max="255" value={channels[i]} {disabled} aria-label={t(label as 'color.red')} style:--range-color={['#a96f72', '#56877e', '#5872a5'][i]} oninput={e => channel(i, +e.currentTarget.value)} /><output>{channels[i]}</output></label>
    {/each}
  </div>
  <p id="{id}-hint" class="hint" class:error-text={!valid}>{t(valid ? 'tags.colorHint' : 'tags.colorInvalid')}</p>
</div>
