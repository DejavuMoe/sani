<script setup lang="ts">
// The home page. Everything on it is real: the demo runs the app's own
// rules, the screenshot is the app, the numbers come from the latest load
// test, and the compose lines are read from the repository's compose.yaml.
import { withBase } from 'vitepress';
import { computed, ref } from 'vue';
import compose from '../../../../compose.yaml?raw';
import { data as app } from '../../data/app.data';
import { benchmark } from '../../data/benchmark';
import { compact, useLang } from '../i18n';
import Icon from './Icon.vue';
import Screenshot from './Screenshot.vue';
import ShortenDemo from './ShortenDemo.vue';

const { lang, pick, home } = useLang();
const href = (path: string) => withBase(home.value + path);
const s = (key: string) => app[lang.value][key] ?? key;
const num = (n: number) => n.toLocaleString(lang.value === 'zh' ? 'zh-CN' : 'en-US');

const hit = benchmark.runs.find((r) => r.id === 'hit')!;

// The title in phrases, so a narrow screen breaks it between them and never
// leaves one character on a line of its own.
const title = computed(() => pick(['粘贴，', '回车，', '已复制。'], ['Paste.', 'Enter.', 'Copied.']));

const numbers = computed(() => [
  {
    value: compact(hit.rps, lang.value),
    unit: pick('次/秒', 'req/s'),
    label: pick('命中缓存的跳转', 'cached redirects'),
    note: pick(`${benchmark.connections} 个并发连接`, `${benchmark.connections} connections`),
  },
  {
    value: hit.p50.toFixed(2),
    unit: 'ms',
    label: pick('中位延迟', 'median latency'),
    note: `p99 ${hit.p99.toFixed(2)} ms`,
  },
  {
    value: num(benchmark.clicks.counted),
    unit: '',
    label: pick('次点击，一次不漏', 'clicks, every one recorded'),
    note: pick(`完成的跳转也是 ${num(benchmark.clicks.served)} 次`, `out of ${num(benchmark.clicks.served)} redirects`),
  },
  {
    value: String(Math.round(benchmark.imageMB)),
    unit: 'MB',
    label: pick('Docker 镜像', 'Docker image'),
    note: pick('FROM scratch，无 cgo', 'FROM scratch, no cgo'),
  },
]);

// Fourteen days of clicks for the statistics tile.
const bars = [3, 5, 4, 7, 6, 9, 8, 6, 11, 9, 13, 10, 15, 12];
const barMax = Math.max(...bars);

const keys = computed(() => [
  { keys: ['N'], label: s('keys.new') },
  { keys: ['/'], label: s('keys.search') },
  { keys: ['J', 'K'], label: s('keys.move') },
  { keys: ['C'], label: s('keys.copy') },
  { keys: ['E'], label: s('keys.edit') },
  { keys: ['?'], label: s('keys.help') },
]);

// The lines of compose.yaml a new deployment has to look at.
const composeLines = compose
  .split('\n')
  .filter((l) => /^\s+(TZ|SANI_BASE_URL):/.test(l))
  .map((l) => l.replace(/\s+#.*$/, '').trim());

interface Line {
  text: string;
  dim?: boolean;
}

const steps = computed<{ title: string; note: string; lines: Line[]; copy: boolean }[]>(() => [
  {
    title: pick('下载 compose.yaml', 'Download compose.yaml'),
    note: pick('镜像来自 GHCR，支持 amd64、arm64 和 armv7。', 'The image comes from GHCR, for amd64, arm64 and armv7.'),
    lines: [{ text: 'mkdir sani && cd sani' }, { text: 'curl -fsSLO https://raw.githubusercontent.com/DejavuMoe/sani/master/compose.yaml' }],
    copy: true,
  },
  {
    title: pick('在 compose.yaml 里填上你的域名', 'Put your domain in compose.yaml'),
    note: pick('短链接用这个域名；TZ 决定每日统计按哪个时区划分。', 'Short links use this domain, and TZ sets where the statistics’ days begin.'),
    lines: [{ text: 'environment:', dim: true }, ...composeLines.map((text) => ({ text: `  ${text}` }))],
    copy: false,
  },
  {
    title: pick('启动，然后打开 /admin/', 'Start it, then open /admin/'),
    note: pick('第一次打开时，填上日志里的设置码，再设置密码。', 'On the first visit, enter the setup code from the log and choose a password.'),
    lines: [{ text: 'docker compose up -d' }, { text: 'docker logs sani 2>&1 | grep setup_code', dim: true }],
    copy: true,
  },
]);

const copied = ref(-1);
async function copy(i: number) {
  try {
    await navigator.clipboard.writeText(steps.value[i].lines.map((l) => l.text).join('\n'));
    copied.value = i;
    setTimeout(() => copied.value === i && (copied.value = -1), 1600);
  } catch {
    // The commands stay selectable.
  }
}

</script>

<template>
  <div class="sn-home">
    <main>
      <section class="hero">
        <div class="intro">
          <p class="eyebrow">{{ pick('可以自己部署的短链接服务', 'A link shortener you host yourself') }}</p>
          <h1>
            <template v-for="(p, i) in title" :key="p"><span class="phrase">{{ p }}</span>{{ i < title.length - 1 ? pick('', ' ') : '' }}</template>
          </h1>
          <p class="lead">
            {{
              pick(
                'Sani 小而快：一个二进制文件，一个 SQLite 数据库，不依赖任何外部服务。跳转直接从内存返回，统计只留下你真正会看的那几项。',
                'Sani is small and fast: one binary and one SQLite file, with no other services to run. Redirects come straight from memory, and the statistics keep only what you’ll actually look at.',
              )
            }}
          </p>
          <div class="actions">
            <a class="btn primary" :href="href('guide/quick-start')">
              {{ pick('快速开始', 'Get started') }}<Icon name="arrowRight" :size="15" />
            </a>
            <a class="btn" :href="href('guide/introduction')">{{ pick('了解 Sani', 'What Sani is') }}</a>
          </div>
          <p class="meta">
            <span>{{ pick('MIT 许可证', 'MIT licensed') }}</span>
            <span>Go · SQLite · Svelte</span>
            <span>{{ pick('中文 / English', 'English / 中文') }}</span>
          </p>
        </div>
        <ShortenDemo class="demo" />
      </section>

      <Screenshot
        class="shot"
        name="dashboard"
        narrow="mobile"
        priority
        :alt="pick('Sani 的管理界面：顶部是缩短链接的输入框和点击总数，下面是短链接列表。', 'The Sani dashboard: the box for new links and the click totals at the top, the list of short links below.')"
      />

      <section class="numbers" :aria-label="pick('性能', 'Performance')">
        <dl>
          <div v-for="n in numbers" :key="n.label">
            <dt>
              {{ n.label }}
              <span class="note">{{ n.note }}</span>
            </dt>
            <dd>{{ n.value }}<small v-if="n.unit">{{ n.unit }}</small></dd>
          </div>
        </dl>
        <p class="source">
          {{
            pick(
              `在一台 ${benchmark.cores} 核笔记本上测得（${benchmark.cpu}，${benchmark.environment}），压测工具和服务在同一台机器上。`,
              `Measured on an ${benchmark.cores}-core laptop (${benchmark.cpu}, ${benchmark.environment}), with the load generator on the same machine.`,
            )
          }}
          <a :href="href('internals/performance')">{{ pick('测试方法与完整结果', 'Method and full results') }}<Icon name="chevronRight" :size="13" /></a>
        </p>
      </section>

      <section class="features">
        <h2>{{ pick('只做一件事，并把它做好', 'One job, done well') }}</h2>

        <div class="grid">
          <article class="tile wide">
            <div class="art http" aria-hidden="true">
              <p><span class="method">GET</span> /k7m2p</p>
              <p><span class="ok">302 Found</span></p>
              <p class="dim">Location: https://example.com/blog/…</p>
              <p class="dim">Cache-Control: private, max-age=0</p>
              <span class="timing">{{ (benchmark.micro.redirectNs / 1000).toFixed(2) }} µs</span>
            </div>
            <h3>{{ pick('跳转不碰数据库', 'Redirects never touch the database') }}</h3>
            <p>
              {{
                pick(
                  '短链接的目标放在内存缓存里，命中时只是一次查找。点击在内存里累加，每两秒合并写入一次，所以数据库再忙也拖不慢跳转。',
                  'Targets live in an in-memory cache, so a hit is one lookup. Clicks are added up in memory and written every two seconds, so a busy database never slows a redirect down.',
                )
              }}
            </p>
          </article>

          <article class="tile">
            <div class="art bars" aria-hidden="true">
              <span v-for="(b, i) in bars" :key="i" :style="{ height: `${(b / barMax) * 100}%` }" />
            </div>
            <h3>{{ pick('统计，但不打扰', 'Statistics without the surveillance') }}</h3>
            <p>
              {{
                pick(
                  '总点击、每日趋势、主要来源和最近一次访问。爬虫、链接预览和浏览器预取不计入；不记录访问者的 IP，也不设置 Cookie。',
                  'Totals, a daily trend, top referrers and the last visit. Crawlers, link previews and prefetches don’t count, and visitors’ IP addresses are never stored.',
                )
              }}
            </p>
          </article>

          <article class="tile">
            <dl class="art keys">
              <div v-for="k in keys" :key="k.label">
                <dt><kbd v-for="key in k.keys" :key="key">{{ key }}</kbd></dt>
                <dd>{{ k.label }}</dd>
              </div>
            </dl>
            <h3>{{ pick('键盘就够了', 'Keyboard first') }}</h3>
            <p>
              {{
                pick(
                  '在页面任意位置粘贴链接就能开始缩短。删除可以撤销，不弹确认框。',
                  'Paste a link anywhere on the page to shorten it. Deleting offers undo instead of a confirmation dialog.',
                )
              }}
            </p>
          </article>

          <article class="tile">
            <div class="art slug" aria-hidden="true">
              <span class="host">s.example.com</span><span class="path">/简历</span>
            </div>
            <h3>{{ pick('中文短码', 'Slugs in any script') }}</h3>
            <p>
              {{
                pick(
                  '任何语言的字母和数字都能做短码，不区分大小写。自动生成的短码去掉了 0/o、1/l/i 这类容易看错的字符。',
                  'Letters and digits of any language make a slug, matched case-insensitively. Generated slugs leave out look-alikes such as 0/o and 1/l/i.',
                )
              }}
            </p>
          </article>

          <article class="tile">
            <div class="art term" aria-hidden="true">
              <p><span class="prompt">$</span> sani backup backup.db</p>
              <p class="dim">Backed up /data/sani.db to backup.db</p>
            </div>
            <h3>{{ pick('一个文件', 'One file') }}</h3>
            <p>
              {{
                pick(
                  '管理界面内嵌在二进制文件里，数据都在一个 SQLite 文件中。备份是一条命令，服务不用停。',
                  'The admin app is inside the binary and the data is in one SQLite file. Backing up is one command, and the service keeps running.',
                )
              }}
            </p>
          </article>

          <article class="tile wide">
            <div class="art flow" aria-hidden="true">
              <span class="chips">
                <span>Shlink</span><span>Sink</span><span>YOURLS</span><span>Kutt</span><span>CSV</span>
              </span>
              <Icon name="arrowRight" :size="16" class="arrow" />
              <span class="sani">Sani</span>
              <Icon name="arrowRight" :size="16" class="arrow" />
              <span class="chips"><span>JSON</span><span>CSV</span></span>
            </div>
            <h3>{{ pick('数据随时带走', 'Your links, portable') }}</h3>
            <p>
              {{
                pick(
                  '从其他短链接服务导入，已有的短码不会被覆盖，出问题的行会逐条列出来。全部链接随时可以导出为 JSON 或 CSV。',
                  'Import from other shorteners: existing slugs are never overwritten, and every row that couldn’t be imported is listed. Export everything as JSON or CSV at any time.',
                )
              }}
            </p>
          </article>

          <article class="tile">
            <div class="art pages" aria-hidden="true">
              <div>
                <span class="code">404</span>
                <b>这个短链接不存在</b>
              </div>
              <div>
                <span class="code">410</span>
                <b>This short link is no longer available</b>
              </div>
            </div>
            <h3>{{ pick('中文和英文', 'Chinese and English') }}</h3>
            <p>
              {{
                pick(
                  '管理界面可以切换语言；访问者看到的错误页面按浏览器语言显示。浅色和深色主题跟随系统。',
                  'The admin app speaks both, and the pages visitors see follow their browser’s language. Light and dark themes follow the system.',
                )
              }}
            </p>
          </article>
        </div>
      </section>

      <section class="deploy">
        <h2>{{ pick('三步部署', 'Deploy in three steps') }}</h2>
        <ol>
          <li v-for="(step, i) in steps" :key="i">
            <div>
              <h3>{{ step.title }}</h3>
              <p class="note">{{ step.note }}</p>
            </div>
            <div class="block">
              <code><span v-for="(l, j) in step.lines" :key="j" class="line" :class="{ dim: l.dim }">{{ l.text }}</span></code>
              <button
                v-if="step.copy"
                type="button"
                class="copy"
                :aria-label="pick('复制命令', 'Copy the commands')"
                @click="copy(i)"
              >
                <Icon :name="copied === i ? 'check' : 'copy'" :size="15" />
              </button>
            </div>
          </li>
        </ol>
        <span class="visually-hidden" role="status">{{ copied >= 0 ? pick('已复制', 'Copied') : '' }}</span>
        <p class="more">
          {{ pick('还需要 HTTPS 反向代理，或者想用 systemd？', 'Need the HTTPS proxy in front, or systemd instead?') }}
          <a :href="href('guide/deploy')">{{ pick('用配置生成器，填上域名就能拿到全部配置', 'The config builder writes every file for your domain') }}<Icon name="chevronRight" :size="13" /></a>
        </p>
      </section>

    </main>

    <footer>
      <span>{{ pick('Sani 以 MIT 许可证开源。', 'Sani is open source under the MIT license.') }}</span>
      <a href="https://github.com/DejavuMoe/sani">GitHub</a>
    </footer>
  </div>
</template>

<style scoped>
.sn-home {
  --pad: 24px;
  width: 100%;
  max-width: calc(1120px + 2 * var(--pad));
  margin: 0 auto;
  padding: 0 var(--pad);
}

.sn-home :is(p, dt, dd, h2, h3) {
  text-wrap: pretty;
}

@media (min-width: 768px) {
  .sn-home {
    --pad: 40px;
  }
}

/* Hero */
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 48px;
  padding: 48px 0 0;
}

@media (min-width: 960px) {
  .hero {
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
    gap: 64px;
    align-items: center;
    padding-top: 88px;
  }
}

.eyebrow {
  margin: 0 0 18px;
  color: var(--sn-accent);
  font-size: 14px;
  font-weight: 550;
}

:lang(en) .eyebrow {
  font-size: 13px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  color: var(--sn-text);
  font-size: clamp(38px, 6vw, 56px);
  font-weight: 650;
  line-height: 1.12;
  letter-spacing: -0.012em;
  text-wrap: balance;
}

h1 .phrase {
  white-space: nowrap;
}

:lang(en) h1 {
  letter-spacing: -0.035em;
}

.lead {
  max-width: 32em;
  margin: 22px 0 0;
  color: var(--sn-text-2);
  font-size: 18px;
  line-height: 1.75;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 32px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 18px;
  border: 1px solid var(--sn-line-2);
  border-radius: 9px;
  background: var(--sn-surface);
  color: var(--sn-text);
  font-size: 15px;
  font-weight: 550;
  text-decoration: none;
  transition:
    background-color 0.12s var(--sn-ease),
    border-color 0.12s var(--sn-ease);
}

.btn:hover {
  border-color: var(--sn-text-4);
}

.btn.primary {
  border-color: var(--sn-ink);
  background: var(--sn-ink);
  color: var(--sn-on-ink);
}

.btn.primary:hover {
  border-color: var(--sn-ink-hover);
  background: var(--sn-ink-hover);
}

.btn:focus-visible,
a:focus-visible {
  outline: 2px solid var(--sn-accent);
  outline-offset: 2px;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 0;
  margin: 26px 0 0;
  color: var(--sn-text-3);
  font-size: 13px;
}

.meta span + span::before {
  content: '·';
  margin: 0 10px;
  color: var(--sn-text-4);
}

.shot {
  margin-top: 88px;
}

/* Numbers */
.numbers {
  margin-top: 64px;
}

.numbers dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 28px 0;
  margin: 0;
}

@media (min-width: 860px) {
  .numbers dl {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.numbers dl > div {
  display: flex;
  flex-direction: column;
  padding: 2px 20px 2px 18px;
  border-left: 1px solid var(--sn-line-2);
}

.numbers dd {
  order: -1;
  margin: 0;
  color: var(--sn-text);
  font-size: clamp(26px, 3.2vw, 34px);
  font-weight: 620;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.numbers dd small {
  margin-left: 5px;
  color: var(--sn-text-3);
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0;
}

.numbers dt {
  margin-top: 6px;
  color: var(--sn-text-2);
  font-size: 14px;
}

.numbers .note {
  display: block;
  margin-top: 1px;
  color: var(--sn-text-3);
  font-size: 12.5px;
}

.source {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 26px 0 0;
  color: var(--sn-text-3);
  font-size: 13px;
  line-height: 1.6;
}

.source a,
.more a,
.sync a {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--sn-accent);
  font-weight: 500;
  text-decoration: none;
}

.source a:hover,
.more a:hover,
.sync a:hover {
  color: var(--sn-accent-hover);
}

/* Features */
section h2 {
  margin: 0 0 28px;
  color: var(--sn-text);
  font-size: clamp(24px, 3vw, 30px);
  font-weight: 640;
  letter-spacing: -0.01em;
  line-height: 1.3;
}

:lang(en) section h2 {
  letter-spacing: -0.025em;
}

.features {
  margin-top: 112px;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}

@media (min-width: 720px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .tile.wide {
    grid-column: span 2;
  }
}

@media (min-width: 1024px) {
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.tile {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 22px 22px 24px;
  border: 1px solid var(--sn-line);
  border-radius: 14px;
  background: var(--sn-surface);
}

.tile h3 {
  margin: 20px 0 6px;
  color: var(--sn-text);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}

.tile p {
  margin: 0;
  color: var(--sn-text-2);
  font-size: 14.5px;
  line-height: 1.7;
}

.art {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 132px;
  border: 1px solid var(--sn-line);
  border-radius: 10px;
  background: var(--sn-canvas);
  overflow: hidden;
}

/* A redirect, as it goes over the wire. */
.http {
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 16px 18px;
  font-family: var(--sn-font-mono);
  font-size: 13px;
}

.http p {
  margin: 0;
  overflow: hidden;
  color: var(--sn-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.http p:nth-child(2) {
  margin-top: 8px;
}

.http .method {
  color: var(--sn-accent);
  font-weight: 500;
}

.http .ok {
  color: var(--sn-success);
  font-weight: 500;
}

.dim {
  color: var(--sn-text-3) !important;
}

.timing {
  position: absolute;
  top: 14px;
  right: 14px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--sn-accent-soft);
  color: var(--sn-accent);
  font-family: var(--sn-font-sans);
  font-size: 12px;
  font-weight: 550;
}

/* Two weeks of clicks, drawn like the app's detail chart. */
.bars {
  align-items: flex-end;
  gap: 4px;
  padding: 22px 18px 0;
  border-bottom: 1px solid var(--sn-line);
}

.bars span {
  flex: 1;
  border-radius: 3px 3px 0 0;
  background: var(--sn-accent);
  opacity: 0.85;
}

.bars span:last-child {
  opacity: 1;
}

.keys {
  flex-direction: column;
  justify-content: center;
  margin: 0;
  padding: 10px 16px;
}

.keys div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 0;
}

.keys dt {
  display: flex;
  gap: 4px;
}

.keys dd {
  margin: 0;
  overflow: hidden;
  color: var(--sn-text-2);
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.keys kbd {
  font-size: 11px;
}

.slug {
  align-items: center;
  justify-content: center;
  padding: 16px;
  font-family: var(--sn-font-mono);
  font-size: clamp(17px, 2vw, 20px);
  white-space: nowrap;
}

.slug .host {
  color: var(--sn-text-3);
}

.slug .path {
  color: var(--sn-text);
  font-weight: 500;
}

.term {
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding: 16px 18px;
  font-family: var(--sn-font-mono);
  font-size: 12.5px;
}

.term p {
  margin: 0;
  color: var(--sn-text);
  overflow-wrap: anywhere;
}

.term .prompt {
  margin-right: 6px;
  color: var(--sn-text-4);
}

.flow {
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 12px 14px;
  padding: 18px;
}

.flow .chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.flow .chips span {
  padding: 3px 9px;
  border: 1px solid var(--sn-line-2);
  border-radius: 7px;
  background: var(--sn-surface);
  color: var(--sn-text-2);
  font-size: 12.5px;
}

.flow .sani {
  padding: 6px 14px;
  border-radius: 8px;
  background: var(--sn-ink);
  color: var(--sn-on-ink);
  font-size: 13.5px;
  font-weight: 600;
}

.flow :deep(.arrow) {
  color: var(--sn-text-4);
}

/* The page a visitor sees for a missing or retired link. */
.pages {
  flex-direction: column;
  justify-content: center;
  gap: 14px;
  padding: 16px 18px;
}

.pages div {
  display: grid;
  gap: 4px;
}

.pages .code {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--sn-text-3);
  font-family: var(--sn-font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
}

.pages .code::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--sn-line);
}

.pages b {
  color: var(--sn-text);
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.4;
}

/* Deploy */
.deploy {
  margin-top: 112px;
}

/* One card, one row per step: the step on the left, what to type on the right. */
.deploy ol {
  margin: 0;
  padding: 0;
  border: 1px solid var(--sn-line);
  border-radius: 14px;
  background: var(--sn-surface);
  list-style: none;
  counter-reset: step;
}

.deploy li {
  display: grid;
  gap: 14px 40px;
  min-width: 0;
  padding: 20px;
  counter-increment: step;
}

.deploy li + li {
  border-top: 1px solid var(--sn-line);
}

@media (min-width: 900px) {
  .deploy li {
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    align-items: center;
    padding: 22px 26px;
  }
}

.deploy h3 {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0;
  color: var(--sn-text);
  font-size: 15.5px;
  font-weight: 600;
  line-height: 1.45;
}

.deploy .note {
  margin: 4px 0 0 36px;
  color: var(--sn-text-2);
  font-size: 14px;
  line-height: 1.65;
}

.deploy h3::before {
  content: counter(step);
  display: grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--sn-surface-2);
  color: var(--sn-text-2);
  font-size: 12.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.block {
  position: relative;
  min-width: 0;
  padding: 11px 46px 11px 14px;
  border: 1px solid var(--sn-line);
  border-radius: 9px;
  background: var(--sn-canvas);
  color: var(--sn-text);
  font-family: var(--sn-font-mono);
  font-size: 12.5px;
  line-height: 1.75;
}

/* Long lines wrap rather than scroll; a phone shows the whole command. */
.block .line {
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.copy {
  position: absolute;
  top: 6px;
  right: 6px;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 7px;
  color: var(--sn-text-3);
  transition:
    background-color 0.12s var(--sn-ease),
    color 0.12s var(--sn-ease);
}

.copy:hover {
  background: var(--sn-surface-3);
  color: var(--sn-text);
}

.copy:focus-visible {
  outline: 2px solid var(--sn-accent);
  outline-offset: 1px;
}

.more {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 22px 0 0;
  color: var(--sn-text-2);
  font-size: 14.5px;
}

footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  justify-content: space-between;
  margin-top: 72px;
  padding: 24px 0 40px;
  border-top: 1px solid var(--sn-line);
  color: var(--sn-text-3);
  font-size: 13px;
}

footer a {
  color: var(--sn-text-2);
  text-decoration: none;
}

footer a:hover {
  color: var(--sn-text);
}
</style>

<style>
/* The home layout adds room below the content for its own footer. */
.VPHome:has(.sn-home) {
  margin-bottom: 0 !important;
}
</style>
