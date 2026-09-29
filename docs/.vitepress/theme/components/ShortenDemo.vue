<script setup lang="ts">
// A faithful miniature of the admin app's composer. It uses the app's own
// strings, slug alphabet and blocked schemes (read from the source at build
// time), runs entirely in the page, and creates nothing on any server.
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { data as app } from '../../data/app.data';
import { useLang } from '../i18n';
import Icon from './Icon.vue';

const { lang, pick } = useLang();
const s = (key: string) => app[lang.value][key] ?? key;

const DOMAIN = 's.example.com';

interface Row {
  id: number;
  slug: string;
  title: string;
  host: string;
  rest: string;
  clicks: number;
  fresh?: boolean;
}

const samples = computed<Row[]>(() =>
  pick(
    [
      { id: -1, slug: 'weekly-42', title: '周刊第 42 期：把长期主义当作一种工程习惯', host: 'mp.weixin.qq.com', rest: '/s/Qm7rXk2pLwE9', clicks: 1988 },
      { id: -2, slug: '简历', title: '个人简历（PDF）', host: 'example.com', rest: '/files/cv-2026.pdf', clicks: 86 },
    ],
    [
      { id: -1, slug: 'weekly-42', title: 'Issue 42: long-termism as an engineering habit', host: 'newsletter.example.com', rest: '/p/42', clicks: 1988 },
      { id: -2, slug: 'cv', title: 'Curriculum vitae (PDF)', host: 'example.com', rest: '/files/cv-2026.pdf', clicks: 86 },
    ],
  ),
);

const example = 'https://example.com/blog/2026/09/why-i-host-my-own-links?utm_source=newsletter&utm_medium=email';

const url = ref('');
const error = ref('');
const created = ref<Row[]>([]);
const toast = ref('');
const input = ref<HTMLInputElement>();
let seq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(toastTimer));

const rows = computed(() => [...created.value, ...samples.value].slice(0, 4));

// The subset of internal/links.NormalizeURL a visitor can run into here.
function normalize(raw: string): { host: string; rest: string } | { error: string } {
  let v = raw.trim().replace(/[\n\r\t]/g, '');
  if (!v) return { error: 'err.url_required' };
  v = v.replace(/ /g, '%20');
  const m = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(v);
  let scheme = m?.[1].toLowerCase();
  // "localhost:8080/x" is a host and port, not a scheme.
  if (m && !m[2].startsWith('//') && /^\d/.test(m[2]) && !['tel', 'sms', 'geo'].includes(scheme!)) scheme = undefined;
  if (scheme && app.slug.blockedSchemes.includes(scheme)) return { error: 'err.url_scheme' };
  if (!scheme) {
    const host = v.split(/[/?#]/)[0].replace(/:\d+$/, '').toLowerCase();
    if (!host || /[\s@]/.test(host) || !(host === 'localhost' || host.includes('.'))) return { error: 'err.url_invalid' };
    v = (host === 'localhost' || /^[\d.]+$/.test(host) ? 'http://' : 'https://') + v;
  }
  try {
    const u = new URL(v);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      if (!u.hostname || !(u.hostname === 'localhost' || u.hostname.includes('.'))) return { error: 'err.url_invalid' };
      return { host: u.hostname.replace(/^www\./, ''), rest: readable(u.pathname + u.search + u.hash).replace(/^\/$/, '') };
    }
    return { host: '', rest: v };
  } catch {
    return { error: 'err.url_invalid' };
  }
}

function readable(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

// Rejection sampling keeps every character equally likely, as in links.Generate.
function generate(n: number): string {
  const { alphabet } = app.slug;
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n + 8))) {
      if (b < limit && out.length < n) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

async function submit() {
  const r = normalize(url.value);
  if ('error' in r) {
    error.value = s(r.error);
    input.value?.focus();
    return;
  }
  error.value = '';
  const slug = generate(app.slug.length);
  const row: Row = { id: ++seq, slug, title: '', host: r.host, rest: r.rest, clicks: 0, fresh: true };
  created.value = [row, ...created.value].slice(0, 3);
  url.value = '';
  const short = `https://${DOMAIN}/${slug}`;
  let copied = false;
  try {
    await navigator.clipboard.writeText(short);
    copied = true;
  } catch {
    // Clipboard access can be refused; the demo still shows the result.
  }
  showToast(copied ? `${s('act.copied')} ${DOMAIN}/${slug}` : `${DOMAIN}/${slug}`);
  await nextTick();
  // Through the reactive array, so the highlight fades like the app's.
  const live = created.value.find((x) => x.id === row.id);
  setTimeout(() => live && (live.fresh = false), 1600);
}

function showToast(text: string) {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ''), 2600);
}

function tryExample() {
  url.value = example;
  error.value = '';
  input.value?.focus();
}

const letter = (host: string) => (host.replace(/^www\./, '')[0] ?? '·').toUpperCase();
function hue(host: string) {
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  return h % 360;
}
const number = (n: number) => n.toLocaleString(lang.value === 'zh' ? 'zh-CN' : 'en-US');
</script>

<template>
  <div class="demo">
    <p class="demo-label">
      <span class="pill">{{ pick('交互演示', 'Try it') }}</span>
      <span>{{ pick('在页面里运行，不会真的创建链接', 'Runs in this page; nothing is created') }}</span>
    </p>

    <form class="composer" :class="{ invalid: error }" novalidate @submit.prevent="submit">
      <div class="main">
        <Icon name="link" class="lead" />
        <label class="visually-hidden" for="demo-url">{{ s('composer.label') }}</label>
        <input
          id="demo-url"
          ref="input"
          v-model="url"
          class="url"
          type="text"
          inputmode="url"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          enterkeyhint="go"
          :placeholder="s('composer.placeholder')"
          :aria-invalid="error ? true : undefined"
          :aria-describedby="error ? 'demo-error' : undefined"
          @input="error = ''"
        />
        <button class="go" type="submit">
          <span>{{ s('composer.submit') }}</span>
          <kbd aria-hidden="true"><Icon name="enter" :size="12" /></kbd>
        </button>
      </div>
      <div class="options">
        <span class="prefix">{{ DOMAIN }}/</span><span class="auto">{{ s('composer.slugAuto') }}</span>
        <span class="gap" />
        <span class="opt">
          <span class="k">{{ s('composer.expiry') }}</span>
          {{ s('expiry.never') }}
        </span>
      </div>
      <p v-if="toast" class="toast" role="status"><Icon name="check" :size="14" :stroke="2" />{{ toast }}</p>
    </form>

    <p v-if="error" id="demo-error" class="problem" role="alert"><Icon name="alert" :size="14" />{{ error }}</p>
    <p v-else class="hint">
      {{ pick('试试这个：', 'Try this one:') }}
      <button type="button" class="example" @click="tryExample">{{ example.replace('https://', '') }}</button>
    </p>

    <TransitionGroup tag="ul" name="row" class="rows" :aria-label="pick('短链接列表', 'Short links')">
      <li v-for="r in rows" :key="r.id" class="row" :class="{ fresh: r.fresh }">
        <span class="tile" :style="{ '--h': hue(r.host || r.slug) }" aria-hidden="true">{{ letter(r.host || r.slug) }}</span>
        <span class="slug"><span class="slash">/</span>{{ r.slug }}</span>
        <span class="target">
          <span class="title">{{ r.title || r.host || r.rest }}</span>
          <span class="dest">
            <template v-if="r.title"><span class="host">{{ r.host }}</span>{{ r.rest }}</template>
            <template v-else-if="r.host">{{ r.rest || '/' }}</template>
          </span>
        </span>
        <span class="clicks">{{ number(r.clicks) }}</span>
      </li>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.demo {
  position: relative;
  min-width: 0;
}

.demo-label {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 12px;
  color: var(--sn-text-3);
  font-size: 12.5px;
}

.pill {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--sn-accent-soft);
  color: var(--sn-accent);
  font-weight: 550;
}

.composer {
  position: relative;
  border: 1px solid var(--sn-line-2);
  border-radius: 12px;
  background: var(--sn-surface);
  box-shadow: 0 1px 2px rgb(28 27 25 / 0.04), 0 12px 32px -18px rgb(28 27 25 / 0.18);
  transition:
    border-color 0.18s var(--sn-ease),
    box-shadow 0.18s var(--sn-ease);
}

.composer:focus-within {
  border-color: color-mix(in oklab, var(--sn-accent) 55%, var(--sn-line-2));
  box-shadow:
    0 0 0 3px color-mix(in oklab, var(--sn-accent) 12%, transparent),
    0 12px 32px -18px rgb(28 27 25 / 0.18);
}

.composer.invalid {
  border-color: var(--sn-danger);
}

.main {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  padding: 0 8px 0 16px;
}

.main :deep(.lead) {
  color: var(--sn-text-3);
}

.url {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--sn-text);
  font-size: 15.5px;
}

.url::placeholder {
  color: var(--sn-text-3);
}

.url:focus {
  outline: none;
}

.go {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 8px 0 14px;
  border-radius: 8px;
  background: var(--sn-ink);
  color: var(--sn-on-ink);
  font-size: 13.5px;
  font-weight: 550;
  transition:
    background-color 0.12s var(--sn-ease),
    transform 80ms var(--sn-ease);
}

.go:hover {
  background: var(--sn-ink-hover);
}

.go:active {
  transform: translateY(0.5px);
}

.go:focus-visible {
  outline: 2px solid var(--sn-accent);
  outline-offset: 2px;
}

.go kbd {
  min-width: 20px;
  height: 20px;
  border: 0;
  background: color-mix(in oklab, var(--sn-on-ink) 16%, transparent);
  color: var(--sn-on-ink);
}

.options {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 42px;
  padding: 6px 16px;
  border-top: 1px solid var(--sn-line);
  font-size: 13px;
}

.prefix {
  color: var(--sn-text-2);
  font-family: var(--sn-font-mono);
  font-size: 12.5px;
}

.auto {
  margin-left: -6px;
  color: var(--sn-text-3);
}

.gap {
  flex: 1;
}

.opt {
  display: inline-flex;
  gap: 6px;
  color: var(--sn-text-2);
  white-space: nowrap;
}

.opt .k {
  color: var(--sn-text-3);
}

.toast {
  position: absolute;
  bottom: -18px;
  left: 50%;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 8px 14px 8px 11px;
  border-radius: 999px;
  background: #1f1e1c;
  box-shadow: 0 8px 24px -8px rgb(0 0 0 / 0.35);
  color: #f3f2ee;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  transform: translateX(-50%);
  animation: toast-in 0.26s var(--sn-ease);
}

.dark .toast {
  background: #2a2a27;
}

.toast :deep(.sn-icon) {
  color: #7fd6a4;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translate(-50%, 6px) scale(0.98);
  }
}

.problem,
.hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  margin: 14px 2px 0;
  font-size: 13px;
  line-height: 1.5;
}

.problem {
  color: var(--sn-danger);
}

.hint {
  color: var(--sn-text-3);
}

.example {
  max-width: 100%;
  overflow: hidden;
  color: var(--sn-text-2);
  font-family: var(--sn-font-mono);
  font-size: 12px;
  text-align: left;
  text-decoration: underline dotted var(--sn-text-4);
  text-underline-offset: 3px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.example:hover {
  color: var(--sn-accent);
}

.rows {
  position: relative;
  margin: 18px 0 0;
  padding: 0;
  border: 1px solid var(--sn-line);
  border-radius: 12px;
  background: var(--sn-surface);
  list-style: none;
  overflow: hidden;
}

.row {
  display: grid;
  grid-template-columns: 18px minmax(64px, 7.5em) minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 11px 16px;
  border-top: 1px solid var(--sn-line);
  font-size: 13.5px;
  line-height: 1.4;
  transition: background-color 1.2s var(--sn-ease);
}

.row:first-child {
  border-top: 0;
}

.row.fresh {
  background: var(--sn-accent-soft);
  transition: none;
}

.tile {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: oklch(0.93 0.03 var(--h));
  color: oklch(0.42 0.07 var(--h));
  font-size: 10px;
  font-weight: 650;
}

.dark .tile {
  background: oklch(0.3 0.035 var(--h));
  color: oklch(0.84 0.06 var(--h));
}

.slug {
  overflow: hidden;
  color: var(--sn-text);
  font-family: var(--sn-font-mono);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slash {
  color: var(--sn-text-4);
  font-weight: 400;
}

.target {
  display: grid;
  min-width: 0;
}

.title,
.dest {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dest {
  color: var(--sn-text-3);
  font-size: 12px;
}

.dest .host {
  color: var(--sn-text-2);
}

.clicks {
  color: var(--sn-text);
  font-variant-numeric: tabular-nums;
}

.row-enter-active {
  transition:
    opacity 0.28s var(--sn-ease),
    transform 0.28s var(--sn-ease);
}

.row-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}

.row-leave-active {
  display: none;
}

.row-move {
  transition: transform 0.28s var(--sn-ease);
}

@media (max-width: 480px) {
  .row {
    grid-template-columns: 18px minmax(0, 1fr) auto;
  }

  .slug {
    grid-column: 2;
  }

  .target {
    grid-column: 2 / -1;
    grid-row: 2;
  }

  .clicks {
    grid-column: 3;
    grid-row: 1;
  }
}
</style>
