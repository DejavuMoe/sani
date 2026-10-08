<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useLang } from '../i18n';
import Icon from './Icon.vue';

const props = defineProps<{ zones: string[] }>();
const value = defineModel<string>({ required: true });
const { pick } = useLang();
const trigger = ref<HTMLButtonElement>();
const pop = ref<HTMLElement>();
const search = ref<HTMLInputElement>();
const open = ref(false);
const query = ref('');
const active = ref(0);
const filtered = computed(() => props.zones.filter(zone => zone.toLowerCase().includes(query.value.trim().toLowerCase())));

function place() {
  if (!open.value || !trigger.value || !pop.value) return;
  const box = trigger.value.getBoundingClientRect();
  const view = window.visualViewport;
  const top = view?.offsetTop ?? 0;
  const left = view?.offsetLeft ?? 0;
  const bottom = top + (view?.height ?? innerHeight);
  const right = left + (view?.width ?? document.documentElement.clientWidth);
  const menu = pop.value;
  menu.style.width = `${Math.min(box.width, right - left - 16)}px`;
  menu.style.maxHeight = `${Math.min(336, bottom - top - 16)}px`;
  menu.style.left = `${Math.max(left + 8, Math.min(box.left, right - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(top + 8, Math.min(box.bottom + 6, bottom - menu.offsetHeight - 8))}px`;
}

function reveal() {
  nextTick(() => {
    pop.value?.querySelector(`#b-zone-option-${active.value}`)?.scrollIntoView({ block: 'nearest' });
    place();
  });
}

watch(query, () => {
  active.value = 0;
  reveal();
});

function prepare(event: Event) {
  // Reset before opening; a queued toggle event could erase the first typed query.
  if ((event as ToggleEvent).newState === 'open') query.value = '';
}

async function toggled(event: Event) {
  open.value = (event as ToggleEvent).newState === 'open';
  if (!open.value) return;
  await nextTick();
  active.value = Math.max(0, filtered.value.indexOf(value.value));
  place();
  search.value?.focus({ preventScroll: true });
  reveal();
}

function close(restoreFocus = true) {
  pop.value?.hidePopover();
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}

function choose(zone: string) {
  value.value = zone;
  close();
}

function keys(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  } else if (event.key === 'Tab') {
    // Return to the trigger before the browser advances to the next field.
    close();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (filtered.value[active.value]) choose(filtered.value[active.value]);
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const count = filtered.value.length;
    if (count) active.value = (active.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
    reveal();
  } else if (!query.value && (event.key === 'Home' || event.key === 'End')) {
    event.preventDefault();
    active.value = event.key === 'Home' ? 0 : Math.max(0, filtered.value.length - 1);
    reveal();
  }
}

onMounted(() => {
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  window.visualViewport?.addEventListener('resize', place);
  window.visualViewport?.addEventListener('scroll', place);
});
onUnmounted(() => {
  window.removeEventListener('resize', place);
  window.removeEventListener('scroll', place, true);
  window.visualViewport?.removeEventListener('resize', place);
  window.visualViewport?.removeEventListener('scroll', place);
});
</script>

<template>
  <button ref="trigger" type="button" class="zone-trigger" popovertarget="b-zone-pop"
    aria-labelledby="b-zone-label b-zone-value" aria-describedby="b-zone-hint"
    aria-haspopup="dialog" :aria-expanded="open">
    <span id="b-zone-value">{{ value }}</span><Icon name="chevronRight" :size="14" />
  </button>
  <div id="b-zone-pop" ref="pop" class="zone-pop" popover="auto" role="dialog"
    aria-labelledby="b-zone-label" @beforetoggle="prepare" @toggle="toggled" @keydown="keys">
    <div class="zone-search">
      <input ref="search" v-model="query" type="text" role="combobox" autocomplete="off" spellcheck="false"
        :aria-label="pick('搜索时区', 'Search time zones')" :placeholder="pick('搜索时区…', 'Search time zones…')"
        aria-autocomplete="list" aria-controls="b-zone-list" :aria-expanded="open"
        :aria-activedescendant="filtered[active] ? `b-zone-option-${active}` : undefined" />
    </div>
    <div id="b-zone-list" class="zone-options" role="listbox" aria-labelledby="b-zone-label">
      <button v-for="(zone, i) in filtered" :id="`b-zone-option-${i}`" :key="zone" type="button"
        role="option" :aria-selected="zone === value" tabindex="-1" :class="{ active: i === active }"
        @pointermove="active = i" @mousedown.prevent @click="choose(zone)">
        <span>{{ zone }}</span><Icon v-if="zone === value" name="check" :size="14" />
      </button>
    </div>
    <p v-if="!filtered.length" class="zone-empty" role="status">{{ pick('没有匹配的时区', 'No matching time zones') }}</p>
  </div>
</template>

<style scoped>
.zone-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  height: 36px;
  padding: 7px 11px;
  border: 1px solid var(--sn-line-2);
  border-radius: 8px;
  background: var(--sn-surface);
  color: var(--sn-text);
  font: 13px/20px var(--sn-font-mono);
  text-align: left;
  cursor: pointer;
}
.zone-trigger span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zone-trigger :deep(svg) { flex-shrink: 0; transform: rotate(90deg); color: var(--sn-text-2); }
.zone-trigger:hover { border-color: var(--sn-text-3); }
.zone-trigger:focus-visible { outline: 2px solid var(--sn-accent); outline-offset: 2px; }
.zone-pop {
  position: fixed;
  inset: auto;
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  border: 1px solid var(--sn-line-2);
  border-radius: 10px;
  background: var(--sn-surface);
  color: var(--sn-text);
  box-shadow: var(--sn-shadow-pop);
  font: 13px/20px var(--sn-font-mono);
  overflow: hidden;
}
.zone-pop:popover-open { display: flex; flex-direction: column; }
.zone-search { flex-shrink: 0; padding: 8px; border-bottom: 1px solid var(--sn-line); }
.zone-search input {
  appearance: none;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--sn-line-2);
  border-radius: 6px;
  background: var(--sn-canvas);
  color: var(--sn-text);
  font: inherit;
  outline: none;
}
.zone-search input:focus { border-color: var(--sn-accent); box-shadow: 0 0 0 2px var(--sn-accent-soft); }
.zone-search input::placeholder { color: var(--sn-text-3); }
.zone-options {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px;
  scrollbar-width: thin;
  scrollbar-color: var(--sn-line-2) transparent;
}
.zone-options::-webkit-scrollbar { width: 6px; }
.zone-options::-webkit-scrollbar-thumb { background: var(--sn-line-2); border-radius: 3px; }
.zone-options button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--sn-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.zone-options button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zone-options button :deep(svg) { flex-shrink: 0; }
.zone-options button.active { background: var(--sn-surface-2); }
.zone-options button[aria-selected="true"] { color: var(--sn-accent); background: var(--sn-accent-soft); }
.zone-empty { margin: 0; padding: 12px; color: var(--sn-text-2); font-family: var(--sn-font-sans); }
</style>
