<script setup lang="ts">
import Ecoku from 'ecoku';
import { useData } from 'vitepress';
import { computed, onMounted, ref, watch } from 'vue';
import { useLang } from '../i18n';

const { page } = useData();
const { lang, pick } = useLang();
const container = ref<HTMLElement>();
const failed = ref(false);
const retry = ref(0);
// Use the source page so .html, query strings and anchors share one thread.
const pageKey = computed(() => '/' + page.value.relativePath.replace(/(?:index)?\.md$/, ''));

onMounted(() => {
  watch([pageKey, lang, retry], (_, __, onCleanup) => {
    if (!container.value) return;
    failed.value = false;
    let active = true;
    const comments = new Ecoku({
      container: container.value,
      serverURL: 'https://ecoku-dev.zsh.moe/',
      siteId: 'sani-docs',
      pageKey: pageKey.value,
      pageTitle: page.value.title,
      i18n: lang.value === 'zh' ? 'zh-CN' : 'en',
      theme: 'auto',
    });
    onCleanup(() => {
      active = false;
      comments.destroy();
    });
    void comments.init().catch(() => { if (active) failed.value = true; });
  }, { immediate: true, flush: 'post' });
});
</script>

<template>
  <div class="sn-comments">
    <div v-if="failed" role="status" class="sn-comments-error">
      <p>{{ pick('评论暂时无法加载。', 'Comments could not be loaded.') }}</p>
      <button type="button" @click="retry++">{{ pick('重新加载', 'Reload comments') }}</button>
    </div>
    <div ref="container"></div>
  </div>
</template>

<style scoped>
.sn-comments {
  margin-top: 40px;
  padding-top: 32px;
  border-top: 1px solid var(--sn-line);
}

.sn-comments :deep(.ecoku-comments) {
  --ecoku-theme: var(--sn-bg);
  --ecoku-entry: var(--sn-surface);
  --ecoku-primary: var(--sn-text);
  --ecoku-secondary: var(--sn-text-3);
  --ecoku-content: var(--sn-text-2);
  --ecoku-border: var(--sn-line-2);
  --ecoku-border-soft: var(--sn-line);
  --ecoku-code-bg: var(--sn-surface-2);
  --ecoku-surface-muted: var(--sn-canvas);
  --ecoku-accent: var(--sn-accent);
  --ecoku-danger: var(--sn-danger);
  --ecoku-focus: var(--sn-accent);
  --ecoku-radius: 10px;
  --ecoku-radius-sm: 5px;
  --ecoku-shadow: var(--sn-shadow-pop);
  --ecoku-font-mono: var(--sn-font-mono);
  max-width: none;
  font-family: var(--sn-font-sans);
}

.sn-comments-error { color: var(--sn-text-2); }
.sn-comments-error button { color: var(--sn-accent); text-decoration: underline; }
.sn-comments-error button:focus-visible { outline: 2px solid var(--sn-accent); outline-offset: 3px; }
</style>
