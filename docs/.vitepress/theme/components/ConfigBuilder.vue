<script setup lang="ts">
// Fills in the repository's own deployment files for the reader's domain.
// The files are imported as they are in the repo, and builder.ts rewrites
// only the lines that need the reader's values; those lines are highlighted.
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import compose from '../../../../compose.yaml?raw';
import caddyfile from '../../../../deploy/Caddyfile?raw';
import nginxConf from '../../../../deploy/nginx.conf?raw';
import service from '../../../../deploy/sani.service?raw';
import { buildCompose, buildProxy, buildService, EXAMPLE_DOMAIN, type Built } from '../../sync/builder';
import { useLang } from '../i18n';
import Icon from './Icon.vue';

const { pick } = useLang();

type Runtime = 'compose' | 'systemd';
type Proxy = 'caddy' | 'nginx' | 'other';

const runtime = ref<Runtime>('compose');
const proxy = ref<Proxy>('caddy');
const domainInput = ref(EXAMPLE_DOMAIN);
const tzInput = ref('Asia/Shanghai');
const fixedPassword = ref(false);
const password = ref('');
const rootRedirect = ref('');
const filesInput = ref('');
const zones = ref<string[]>([]);

onMounted(() => {
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (own && own !== 'UTC') tzInput.value = own;
  zones.value = 'supportedValuesOf' in Intl ? (Intl as any).supportedValuesOf('timeZone') : [];
});

const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function newPassword() {
  const limit = 256 - (256 % ALNUM.length);
  let out = '';
  while (out.length < 20) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < limit && out.length < 20) out += ALNUM[b % ALNUM.length];
    }
  }
  password.value = out;
}
watch(fixedPassword, (on) => on && !password.value && newPassword());

// The choices of the three segmented controls.
const runtimes = [
  { v: 'compose', l: 'Docker Compose' },
  { v: 'systemd', l: 'systemd' },
];
const proxies = computed(() => [
  { v: 'caddy', l: 'Caddy' },
  { v: 'nginx', l: 'nginx' },
  { v: 'other', l: pick('其他', 'Other') },
]);
const passwordModes = computed(() => [
  { v: 'setup', l: pick('首次访问时设置', 'Choose on first visit') },
  { v: 'fixed', l: pick('写进配置', 'Fixed in config') },
]);
const passwordMode = computed(() => (fixedPassword.value ? 'fixed' : 'setup'));

/**
 * Arrow keys, Home and End move through a radio group or tab list and select
 * as they go, as the ARIA patterns describe; Tab leaves the group.
 */
function arrows(e: KeyboardEvent, values: string[], current: string, select: (v: string) => void) {
  const i = values.indexOf(current);
  const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: values.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  select(values[(to + values.length) % values.length]);
  const group = e.currentTarget as HTMLElement;
  nextTick(() => group.querySelector<HTMLElement>('[tabindex="0"]')?.focus());
}

/** Accepts "https://S.Example.com/admin/" and returns "s.example.com". */
function hostOf(input: string) {
  const raw = input.trim();
  if (!raw) return '';
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
    return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(host) ? host : '';
  } catch {
    return '';
  }
}
const domain = computed(() => hostOf(domainInput.value));

/** The files domain has to differ from the short one; empty is fine. */
const filesDomain = computed(() => {
  const host = hostOf(filesInput.value);
  return host && host !== (domain.value || EXAMPLE_DOMAIN) ? host : '';
});
const filesOK = computed(() => !filesInput.value.trim() || !!filesDomain.value);

const tz = computed(() => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tzInput.value.trim() });
    return tzInput.value.trim();
  } catch {
    return '';
  }
});

const redirectOK = computed(() => !rootRedirect.value.trim() || /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(rootRedirect.value.trim()));

const input = computed(() => ({
  domain: domain.value || EXAMPLE_DOMAIN,
  tz: tz.value || 'Asia/Shanghai',
  password: fixedPassword.value ? password.value : '',
  rootRedirect: redirectOK.value ? rootRedirect.value.trim() : '',
  filesDomain: filesDomain.value,
}));

interface File {
  id: string;
  name: string;
  /** Where the file goes: a path, or a description when it replaces one in the repo. */
  path?: string;
  where?: string;
  lang: string;
  built: Built;
}

const files = computed<File[]>(() => {
  const out: File[] = [];
  if (runtime.value === 'compose') {
    out.push({
      id: 'compose',
      name: 'compose.yaml',
      where: pick('保存到服务器上一个新建的目录里，比如 ~/sani', 'Save it in a new directory on the server, such as ~/sani'),
      lang: 'yaml',
      built: buildCompose(compose, input.value),
    });
  } else {
    out.push({
      id: 'service',
      name: 'sani.service',
      path: '/etc/systemd/system/sani.service',
      lang: 'ini',
      built: buildService(service, input.value),
    });
  }
  if (proxy.value === 'caddy') {
    out.push({ id: 'caddy', name: 'Caddyfile', path: '/etc/caddy/Caddyfile', lang: 'caddy', built: buildProxy(caddyfile, input.value, 'Caddyfile') });
  } else if (proxy.value === 'nginx') {
    out.push({ id: 'nginx', name: 'sani.conf', path: '/etc/nginx/conf.d/sani.conf', lang: 'nginx', built: buildProxy(nginxConf, input.value, 'nginx.conf') });
  }
  return out;
});

const tab = ref('compose');
watch(files, (fs) => {
  if (!fs.some((f) => f.id === tab.value)) tab.value = fs[0].id;
});
const file = computed(() => files.value.find((f) => f.id === tab.value) ?? files.value[0]);

/** Lines split into code and a trailing # comment, for quiet comments. */
const lines = computed(() => {
  const filled = new Set(file.value.built.filled);
  return file.value.built.text
    .replace(/\n$/, '')
    .split('\n')
    .map((text, i) => {
      const at = text.search(/(^|\s)#/);
      return {
        code: at < 0 ? text : text.slice(0, at),
        comment: at < 0 ? '' : text.slice(at),
        filled: filled.has(i),
      };
    });
});

const copied = ref('');
async function copy() {
  try {
    await navigator.clipboard.writeText(file.value.built.text);
    copied.value = file.value.id;
    setTimeout(() => (copied.value = ''), 1600);
  } catch {
    // The text stays selectable in the panel.
  }
}

function download() {
  const url = URL.createObjectURL(new Blob([file.value.built.text], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: file.value.name });
  a.click();
  URL.revokeObjectURL(url);
}

const host = computed(() => input.value.domain);
const steps = computed(() => {
  const compose = runtime.value === 'compose';
  const list: { text: string; code?: string }[] = [];
  if (compose) {
    list.push({
      text: pick('在服务器上新建一个目录，把上面的 compose.yaml 保存进去：', 'Create a directory on the server and save the compose.yaml above in it:'),
      code: 'mkdir ~/sani && cd ~/sani',
    });
    list.push({
      text: pick('拉取镜像并启动：', 'Pull the image and start it:'),
      code: 'docker compose up -d',
    });
  } else {
    list.push({
      text: pick(
        '在服务器上下载最新版本并安装。ARM 服务器把 amd64 换成 arm64 或 armv7：',
        'Download the latest release on the server and install it. On an ARM server, use arm64 or armv7 instead of amd64:',
      ),
      code: 'curl -fsSL https://github.com/DejavuMoe/sani/releases/latest/download/sani-linux-amd64.tar.gz | tar -xz sani && sudo install -m 755 sani /usr/local/bin/sani',
    });
    list.push({
      text: pick('把 sani.service 保存到上面的位置，然后启用：', 'Save sani.service where shown above, then enable it:'),
      code: 'sudo systemctl daemon-reload && sudo systemctl enable --now sani',
    });
  }
  if (proxy.value === 'caddy') {
    list.push({
      text: pick('把 Caddyfile 的内容加进 Caddy 的配置并重新加载，证书会自动签发：', 'Add the Caddyfile block to Caddy’s configuration and reload it; Caddy obtains the certificate:'),
      code: 'sudo systemctl reload caddy',
    });
  } else if (proxy.value === 'nginx') {
    if (input.value.filesDomain) {
      list.push({
        text: pick('两个域名用同一张证书，比如用 certbot 签发：', 'Get one certificate for both domains, for example with certbot:'),
        code: `sudo certbot certonly --nginx -d ${host.value} -d ${input.value.filesDomain}`,
      });
    }
    list.push({
      text: pick(
        '保存 sani.conf，按你的实际情况修改证书路径（示例是 Let’s Encrypt 的默认位置），检查后重新加载：',
        'Save sani.conf, point the certificate paths at yours (the example uses Let’s Encrypt’s defaults), then test and reload:',
      ),
      code: 'sudo nginx -t && sudo systemctl reload nginx',
    });
  } else {
    list.push({
      text: pick(
        '让你的代理把请求转发到 127.0.0.1:8080，并设置 X-Forwarded-For、X-Forwarded-Proto 和 X-Forwarded-Host 请求头。',
        'Have your proxy forward requests to 127.0.0.1:8080 and set the X-Forwarded-For, X-Forwarded-Proto and X-Forwarded-Host headers.',
      ),
    });
  }
  const files = input.value.filesDomain;
  list.push({
    text: files
      ? pick(`把 ${host.value} 和 ${files} 的 DNS 记录都指向这台服务器。`, `Point the DNS records of ${host.value} and ${files} at the server.`)
      : pick(`把 ${host.value} 的 DNS 记录指向这台服务器。`, `Point the DNS records of ${host.value} at the server.`),
  });
  if (fixedPassword.value) {
    list.push({ text: pick(`打开 https://${host.value}/admin/，用写进配置的密码登录。`, `Open https://${host.value}/admin/ and sign in with the password from the configuration.`) });
  } else {
    list.push({
      text: pick(
        `打开 https://${host.value}/admin/，填入启动日志里的设置码，再设置你的密码：`,
        `Open https://${host.value}/admin/, enter the setup code from the log, and choose your password:`,
      ),
      code: compose ? 'docker logs sani 2>&1 | grep setup_code' : 'journalctl -u sani | grep setup_code',
    });
  }
  return list;
});
</script>

<template>
  <div class="sn-builder">
    <div class="form">
      <div class="field">
        <span class="k" id="b-runtime">{{ pick('运行方式', 'Run with') }}</span>
        <div
          class="seg"
          role="radiogroup"
          aria-labelledby="b-runtime"
          @keydown="arrows($event, runtimes.map((o) => o.v), runtime, (v) => (runtime = v as Runtime))"
        >
          <button
            v-for="o in runtimes"
            :key="o.v"
            type="button"
            role="radio"
            :aria-checked="runtime === o.v"
            :tabindex="runtime === o.v ? 0 : -1"
            @click="runtime = o.v as Runtime"
          >
            {{ o.l }}
          </button>
        </div>
      </div>

      <div class="field">
        <span class="k" id="b-proxy">{{ pick('反向代理', 'Reverse proxy') }}</span>
        <div
          class="seg"
          role="radiogroup"
          aria-labelledby="b-proxy"
          @keydown="arrows($event, proxies.map((o) => o.v), proxy, (v) => (proxy = v as Proxy))"
        >
          <button
            v-for="o in proxies"
            :key="o.v"
            type="button"
            role="radio"
            :aria-checked="proxy === o.v"
            :tabindex="proxy === o.v ? 0 : -1"
            @click="proxy = o.v as Proxy"
          >
            {{ o.l }}
          </button>
        </div>
      </div>

      <label class="field">
        <span class="k">{{ pick('主域名', 'Main domain') }}</span>
        <input
          v-model="domainInput"
          class="input mono"
          spellcheck="false"
          autocomplete="off"
          :aria-invalid="domainInput.trim() && !domain ? true : undefined"
          aria-describedby="b-domain-hint"
        />
        <span id="b-domain-hint" class="hint" :class="{ bad: domainInput.trim() && !domain }">
          {{ domainInput.trim() && !domain ? pick('请填写一个域名，例如 s.example.com', 'Enter a domain such as s.example.com') : pick(`短链接：https://${host}/xxxxx；文本和文件分享页：https://${host}/p/xxxxx`, `Short links: https://${host}/xxxxx. Text and file pages: https://${host}/p/xxxxx.`) }}
        </span>
      </label>

      <label class="field">
        <span class="k">{{ pick('统计时区', 'Time zone for statistics') }}</span>
        <input v-model="tzInput" class="input mono" list="b-zones" spellcheck="false" autocomplete="off" :aria-invalid="!tz ? true : undefined" />
        <datalist id="b-zones">
          <option v-for="z in zones" :key="z" :value="z" />
        </datalist>
        <span class="hint" :class="{ bad: !tz }">
          {{ tz ? pick('“今天”和每日统计按这个时区划分', 'Days in the statistics follow this zone') : pick('无法识别这个时区', 'Unknown time zone') }}
        </span>
      </label>

      <div class="field">
        <span class="k" id="b-password">{{ pick('管理员密码', 'Admin password') }}</span>
        <div
          class="seg"
          role="radiogroup"
          aria-labelledby="b-password"
          @keydown="arrows($event, passwordModes.map((o) => o.v), passwordMode, (v) => (fixedPassword = v === 'fixed'))"
        >
          <button
            v-for="o in passwordModes"
            :key="o.v"
            type="button"
            role="radio"
            :aria-checked="passwordMode === o.v"
            :tabindex="passwordMode === o.v ? 0 : -1"
            @click="fixedPassword = o.v === 'fixed'"
          >
            {{ o.l }}
          </button>
        </div>
        <span v-if="!fixedPassword" class="hint">{{ pick('推荐：用启动日志里的设置码完成首次设置', 'Recommended: finish setup with the code from the log') }}</span>
        <span v-else class="pw">
          <code>{{ password }}</code>
          <button type="button" class="mini" @click="newPassword"><Icon name="refresh" :size="13" />{{ pick('换一个', 'New one') }}</button>
        </span>
      </div>

      <label class="field">
        <span class="k">{{ pick('根路径跳转（可选）', 'Where “/” goes (optional)') }}</span>
        <input
          v-model="rootRedirect"
          class="input mono"
          placeholder="https://example.com"
          spellcheck="false"
          autocomplete="off"
          :aria-invalid="!redirectOK ? true : undefined"
        />
        <span class="hint" :class="{ bad: !redirectOK }">
          {{ redirectOK ? pick('访问裸域名时去哪里；不填则进入管理界面', 'Where the bare domain sends visitors; empty opens the admin app') : pick('需要以 http:// 或 https:// 开头的完整地址', 'Use a full http:// or https:// address') }}
        </span>
      </label>

      <label class="field">
        <span class="k">{{ pick('文件下载域名（可选）', 'Download domain (optional)') }}</span>
        <input
          v-model="filesInput"
          class="input mono"
          placeholder="f.example.com"
          spellcheck="false"
          autocomplete="off"
          :aria-invalid="!filesOK ? true : undefined"
          aria-describedby="b-files-hint"
        />
        <span id="b-files-hint" class="hint" :class="{ bad: !filesOK }">
          {{ filesOK ? pick('上传文件时必填，仅用于文件下载和原始文本，指向同一个 Sani。留空仍可分享、阅读和复制文本，但没有原始文本和下载入口。', 'Required for file uploads. Serves downloads and raw text from the same Sani. Leave empty to share, read and copy text, without raw or download links.') : pick('请填写一个与主域名不同的主机名，子域名也可以', 'Use a different hostname from the main domain; a subdomain is fine') }}
        </span>
      </label>
    </div>

    <div class="out">
      <div class="bar">
        <div
          class="tabs"
          role="tablist"
          :aria-label="pick('生成的文件', 'Generated files')"
          @keydown="arrows($event, files.map((f) => f.id), file.id, (v) => (tab = v))"
        >
          <button
            v-for="f in files"
            :id="`b-tab-${f.id}`"
            :key="f.id"
            type="button"
            role="tab"
            :aria-selected="file.id === f.id"
            :aria-controls="`b-file-${f.id}`"
            :tabindex="file.id === f.id ? 0 : -1"
            @click="tab = f.id"
          >
            {{ f.name }}
          </button>
        </div>
        <button type="button" class="mini" @click="copy">
          <Icon :name="copied === file.id ? 'check' : 'copy'" :size="13" />{{ copied === file.id ? pick('已复制', 'Copied') : pick('复制', 'Copy') }}
        </button>
        <button type="button" class="mini" @click="download"><Icon name="download" :size="13" />{{ pick('下载', 'Download') }}</button>
      </div>
      <p class="where">
        <span v-if="file.path">{{ pick('保存到', 'Save to') }} <code>{{ file.path }}</code></span>
        <span v-else>{{ file.where }}</span>
        <span v-if="file.built.filled.length" class="legend"><i />{{ pick('按你的输入填写的行', 'lines filled in from your input') }}</span>
      </p>
      <pre :id="`b-file-${file.id}`" class="code" role="tabpanel" :aria-labelledby="`b-tab-${file.id}`" tabindex="0"><code><span v-for="(l, i) in lines" :key="i" class="line" :class="{ filled: l.filled }">{{ l.code }}<span v-if="l.comment" class="comment">{{ l.comment }}</span>
</span></code></pre>
    </div>

    <ol class="steps">
      <li v-for="(s, i) in steps" :key="i">
        <span>{{ s.text }}</span>
        <code v-if="s.code" class="cmd">{{ s.code }}</code>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.sn-builder {
  margin: 28px 0;
  border: 1px solid var(--sn-line);
  border-radius: 14px;
  background: var(--sn-surface);
  overflow: hidden;
}

.form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 20px;
  padding: 20px 20px 22px;
  background: var(--sn-canvas);
  border-bottom: 1px solid var(--sn-line);
}

.field {
  display: grid;
  align-content: start;
  gap: 7px;
  min-width: 0;
}

.k {
  color: var(--sn-text-2);
  font-size: 13px;
  font-weight: 550;
}

.input {
  width: 100%;
  height: 36px;
  padding: 0 11px;
  border: 1px solid var(--sn-line-2);
  border-radius: 8px;
  background: var(--sn-surface);
  color: var(--sn-text);
  font-size: 13.5px;
  transition:
    border-color 0.12s var(--sn-ease),
    box-shadow 0.12s var(--sn-ease);
}

.input.mono {
  font-family: var(--sn-font-mono);
  font-size: 13px;
}

.input:focus {
  outline: none;
  border-color: var(--sn-accent);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--sn-accent) 16%, transparent);
}

.input[aria-invalid='true'] {
  border-color: var(--sn-danger);
}

.hint {
  color: var(--sn-text-3);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.hint.bad {
  color: var(--sn-danger);
}

.seg {
  display: inline-flex;
  gap: 2px;
  width: fit-content;
  max-width: 100%;
  padding: 2px;
  border: 1px solid var(--sn-line-2);
  border-radius: 9px;
  background: var(--sn-surface-2);
}

.seg button {
  height: 30px;
  padding: 0 12px;
  border-radius: 7px;
  color: var(--sn-text-2);
  font-size: 13px;
  white-space: nowrap;
  transition:
    background-color 0.12s var(--sn-ease),
    color 0.12s var(--sn-ease);
}

.seg button:hover {
  color: var(--sn-text);
}

.seg button[aria-checked='true'] {
  background: var(--sn-surface);
  box-shadow: 0 1px 2px rgb(28 27 25 / 0.08), 0 0 0 1px var(--sn-line);
  color: var(--sn-text);
  font-weight: 550;
}

.seg button:focus-visible,
.mini:focus-visible,
.tabs [role='tab']:focus-visible,
.code:focus-visible {
  outline: 2px solid var(--sn-accent);
  outline-offset: 1px;
}

.pw {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pw code {
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--sn-surface);
  border: 1px solid var(--sn-line);
  color: var(--sn-text);
  font-size: 12.5px;
}

.mini {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 9px;
  border-radius: 7px;
  color: var(--sn-text-2);
  font-size: 12.5px;
  white-space: nowrap;
}

.mini:hover {
  background: var(--sn-surface-2);
  color: var(--sn-text);
}

.bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 10px 12px 0;
}

.tabs {
  display: flex;
  flex: 1;
  gap: 2px;
  min-width: 0;
}

.tabs [role='tab'] {
  position: relative;
  height: 32px;
  padding: 0 10px;
  color: var(--sn-text-3);
  font-family: var(--sn-font-mono);
  font-size: 12.5px;
}

.tabs [role='tab'][aria-selected='true'] {
  color: var(--sn-text);
}

.tabs [role='tab'][aria-selected='true']::after {
  content: '';
  position: absolute;
  right: 10px;
  bottom: -1px;
  left: 10px;
  height: 2px;
  border-radius: 2px;
  background: var(--sn-accent);
}

.where {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin: 0;
  padding: 8px 22px 10px;
  border-top: 1px solid var(--sn-line);
  color: var(--sn-text-3);
  font-size: 12.5px;
}

.where code {
  font-size: 12px;
}

.legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.legend i {
  width: 10px;
  height: 10px;
  border-left: 2px solid var(--sn-accent);
  background: var(--sn-accent-soft);
}

.code {
  margin: 0;
  padding: 12px 0 14px;
  overflow-x: auto;
  background: var(--sn-canvas);
  border-top: 1px solid var(--sn-line);
  color: var(--sn-text);
  font-family: var(--sn-font-mono);
  font-size: 12.5px;
  line-height: 1.7;
}

.line {
  display: block;
  min-height: 1.7em;
  padding: 0 22px 0 20px;
  border-left: 2px solid transparent;
  white-space: pre;
}

.line.filled {
  border-left-color: var(--sn-accent);
  background: var(--sn-accent-soft);
}

.comment {
  color: var(--sn-text-3);
}

/* One step darker on the highlight, to keep AA contrast. */
.line.filled .comment {
  color: var(--sn-text-2);
}

.steps {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 18px 22px 20px 44px;
  border-top: 1px solid var(--sn-line);
  color: var(--sn-text-2);
  font-size: 14px;
  line-height: 1.65;
}

.steps li {
  margin: 0;
}

.steps li::marker {
  color: var(--sn-text-3);
  font-size: 13px;
}

.steps .cmd {
  display: block;
  width: fit-content;
  max-width: 100%;
  margin-top: 6px;
  padding: 5px 10px;
  border-radius: 7px;
  background: var(--sn-canvas);
  border: 1px solid var(--sn-line);
  color: var(--sn-text);
  font-size: 12.5px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .form {
    grid-template-columns: 1fr;
  }

  .sn-builder {
    margin-inline: -24px;
    border-inline: 0;
    border-radius: 0;
  }
}
</style>
