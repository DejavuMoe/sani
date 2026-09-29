<script setup lang="ts">
// What the build verified about this documentation, what the repository
// contains and which toolchain it pins. Everything here is computed from the
// source tree when the site is built (status.data.ts), not written by hand.
import { computed } from 'vue';
import { data as status } from '../../data/status.data';
import type { Check } from '../../sync/check';
import type { Stats, Versions } from '../../sync/source';
import { useLang } from '../i18n';
import Icon from './Icon.vue';

defineProps<{ part: 'checks' | 'stats' | 'versions' }>();

const { lang, pick } = useLang();
const num = (n: number) => n.toLocaleString(lang.value === 'zh' ? 'zh-CN' : 'en-US');

const checkCopy: Record<Check['id'], { zh: [string, string, string]; en: [string, string, string] }> = {
  pages: {
    zh: ['页面', '侧边栏里的每一页都有中文和英文版本，没有多余的页面', '页'],
    en: ['Pages', 'Every page in the sidebar exists in Chinese and English, and nothing else does', 'pages'],
  },
  config: {
    zh: ['配置项', '配置页的变量、默认值和取值范围与 internal/config 一致', '个变量'],
    en: ['Configuration', 'Variables, defaults and ranges on the configuration page match internal/config', 'variables'],
  },
  readme: {
    zh: ['README', '中英文 README 的配置表与源码一致', '份'],
    en: ['READMEs', 'The configuration tables of both READMEs match the source', 'files'],
  },
  api: {
    zh: ['API 接口', 'API 参考列出了服务端注册的每一个接口，不多也不少', '个接口'],
    en: ['API endpoints', 'The API reference lists every route the server registers, no more and no fewer', 'endpoints'],
  },
  errors: {
    zh: ['错误码', '错误码表与服务端实际返回的错误码和状态码一致', '个错误码'],
    en: ['Error codes', 'The error table matches the codes and statuses the server returns', 'codes'],
  },
  cli: {
    zh: ['命令行', '命令行参考与二进制文件自带的用法说明一致', '个命令'],
    en: ['Command line', 'The command reference matches the binary’s own usage text', 'commands'],
  },
  reserved: {
    zh: ['保留短码', '日常使用页列出了所有不能用作短码的路径', '个短码'],
    en: ['Reserved slugs', 'The usage page lists every path that can’t be a slug', 'slugs'],
  },
  benchmark: {
    zh: ['性能数据', 'README 引用的压测结果与文档的数据文件相同', '个数字'],
    en: ['Benchmark', 'The READMEs quote the same results as the docs’ data file', 'figures'],
  },
  builder: {
    zh: ['配置生成器', '部署页的生成器在仓库的部署文件里找得到要改的每一行', '个文件'],
    en: ['Config builder', 'The deploy page’s builder finds every line it edits in the repository’s files', 'files'],
  },
  release: {
    zh: ['发布', '部署页列出的下载文件和镜像平台，正是发布流程实际构建的那些', '项'],
    en: ['Releases', 'The downloads and image platforms on the deploy page are the ones a release builds', 'items'],
  },
  assets: {
    zh: ['图标', '文档站的图标与管理界面相同', '个文件'],
    en: ['Icon', 'The site’s icon is the admin app’s', 'file'],
  },
};

const checks = computed(() =>
  status.checks.map((c) => {
    const [label, what, unit] = checkCopy[c.id][lang.value];
    return { ...c, label, what, unit, ok: c.problems.length === 0 };
  }),
);
const failed = computed(() => checks.value.filter((c) => !c.ok).length);
const facts = computed(() => status.checks.reduce((n, c) => n + c.count, 0));

// Formatted from the ISO string itself, so the server render and the
// browser agree whatever the reader's time zone.
const builtAt = computed(() => {
  const [date, time] = status.builtAt.split('T');
  return `${date} ${time.slice(0, 5)} UTC`;
});

interface StatRow {
  key: keyof Stats;
  label: string;
  note?: string;
}

const statGroups = computed<{ id: string; name: string; rows: StatRow[] }[]>(() => [
  {
    id: 'code',
    name: pick('代码', 'Code'),
    rows: [
      { key: 'goLines', label: pick('行 Go 代码', 'lines of Go'), note: pick('不含测试', 'excluding tests') },
      { key: 'webLines', label: pick('行前端代码', 'lines of frontend code'), note: 'Svelte · TS · CSS' },
      { key: 'goPackages', label: pick('个 Go 包', 'Go packages'), note: pick('cmd 和 internal 下', 'in cmd and internal') },
    ],
  },
  {
    id: 'tests',
    name: pick('测试', 'Tests'),
    rows: [
      { key: 'goTests', label: pick('个 Go 测试', 'Go tests'), note: pick('以 -race 运行', 'run with -race') },
      { key: 'goBenchmarks', label: pick('组基准测试', 'benchmarks'), note: pick('跳转、缓存、点击', 'redirects, cache, clicks') },
      { key: 'unitTests', label: pick('个前端单元测试', 'frontend unit tests'), note: 'Vitest' },
      { key: 'e2eTests', label: pick('个端到端测试', 'end-to-end tests'), note: 'Playwright' },
    ],
  },
  {
    id: 'surface',
    name: pick('接口与界面', 'Interfaces'),
    rows: [
      { key: 'apiRoutes', label: pick('个 API 接口', 'API endpoints'), note: pick('都在 /api/ 下', 'all under /api/') },
      { key: 'envVars', label: pick('个配置项', 'settings'), note: 'SANI_*' },
      { key: 'uiStrings', label: pick('条界面文案', 'UI strings'), note: pick('中英文各一份', 'in both languages') },
    ],
  },
]);

const versionRows = computed<{ key: keyof Versions; name: string; role: string }[]>(() => [
  { key: 'go', name: 'Go', role: pick('服务端', 'server') },
  { key: 'sqlite', name: 'modernc.org/sqlite', role: pick('纯 Go 的 SQLite', 'SQLite in pure Go') },
  { key: 'node', name: 'Node.js', role: pick('构建前端', 'builds the frontend') },
  { key: 'pnpm', name: 'pnpm', role: pick('包管理', 'packages') },
  { key: 'svelte', name: 'Svelte', role: pick('管理界面', 'admin app') },
  { key: 'vite', name: 'Vite', role: pick('前端构建', 'frontend build') },
  { key: 'typescript', name: 'TypeScript', role: pick('类型检查', 'type checking') },
  { key: 'vitepress', name: 'VitePress', role: pick('本文档站', 'this site') },
]);
</script>

<template>
  <div v-if="part === 'checks'" class="sn-sync">
    <div class="summary" :class="{ bad: failed }">
      <span class="dot" aria-hidden="true" />
      <p>
        <strong v-if="!failed">{{ pick('文档与源码一致', 'The docs match the source') }}</strong>
        <strong v-else>{{ pick(`${failed} 项检查没有通过`, `${failed} ${failed === 1 ? 'check' : 'checks'} failed`) }}</strong>
        <span>
          {{
            pick(
              `${checks.length} 项检查，比对了 ${num(facts)} 处事实`,
              `${checks.length} checks comparing ${num(facts)} facts`,
            )
          }}
        </span>
      </p>
      <time :datetime="status.builtAt">{{ pick('构建于', 'Built') }} {{ builtAt }}</time>
    </div>
    <ul class="checks">
      <li v-for="c in checks" :key="c.id" :class="{ bad: !c.ok }">
        <span class="mark" :aria-label="c.ok ? pick('通过', 'passed') : pick('未通过', 'failed')" role="img">
          <Icon :name="c.ok ? 'check' : 'x'" :size="14" :stroke="2" />
        </span>
        <span class="what">
          <b>{{ c.label }}</b>
          <span>{{ c.what }}</span>
          <code v-for="p in c.problems" :key="p" class="problem">{{ p }}</code>
        </span>
        <span class="count">{{ num(c.count) }} {{ c.unit }}</span>
      </li>
    </ul>
  </div>

  <div v-else-if="part === 'stats'" class="sn-stats">
    <div v-for="g in statGroups" :key="g.id" class="group">
      <p :id="`stats-${g.id}`" class="name">{{ g.name }}</p>
      <dl :aria-labelledby="`stats-${g.id}`">
        <div v-for="s in g.rows" :key="s.key">
          <dt>
            {{ s.label }}
            <span v-if="s.note" class="note">{{ s.note }}</span>
          </dt>
          <dd>{{ num(status.stats[s.key]) }}</dd>
        </div>
      </dl>
    </div>
  </div>

  <dl v-else class="sn-versions">
    <div v-for="v in versionRows" :key="v.key">
      <dt>{{ v.name }}</dt>
      <dd>
        <code>{{ status.versions[v.key] }}</code>
        <span>{{ v.role }}</span>
      </dd>
    </div>
  </dl>
</template>

<style scoped>
.sn-sync {
  margin: 20px 0 8px;
  border: 1px solid var(--sn-line);
  border-radius: 12px;
  background: var(--sn-surface);
  overflow: hidden;
}

.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--sn-line);
  background: var(--sn-canvas);
}

.summary p {
  display: grid;
  flex: 1;
  gap: 1px;
  min-width: 14em;
  margin: 0;
  line-height: 1.5;
}

.summary strong {
  color: var(--sn-text);
  font-size: 15px;
  font-weight: 600;
}

.summary p span,
.summary time {
  color: var(--sn-text-3);
  font-size: 13px;
}

.summary time {
  font-variant-numeric: tabular-nums;
}

.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--sn-success);
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--sn-success) 16%, transparent);
}

.summary.bad .dot {
  background: var(--sn-danger);
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--sn-danger) 16%, transparent);
}

.checks {
  margin: 0;
  padding: 0;
  list-style: none;
}

.checks li {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: baseline;
  margin: 0;
  padding: 11px 20px;
  border-top: 1px solid var(--sn-line);
}

.checks li:first-child {
  border-top: 0;
}

.mark {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: color-mix(in oklab, var(--sn-success) 13%, transparent);
  color: var(--sn-success);
  transform: translateY(4px);
}

.bad .mark {
  background: color-mix(in oklab, var(--sn-danger) 13%, transparent);
  color: var(--sn-danger);
}

.what {
  display: grid;
  gap: 1px;
  font-size: 14px;
  line-height: 1.55;
}

.what b {
  color: var(--sn-text);
  font-weight: 550;
}

.what > span {
  color: var(--sn-text-2);
  font-size: 13.5px;
}

.problem {
  justify-self: start;
  margin-top: 6px;
  padding: 3px 7px;
  border-radius: 5px;
  background: color-mix(in oklab, var(--sn-danger) 9%, transparent);
  color: var(--sn-danger);
  font-size: 12px;
  white-space: normal;
}

.count {
  color: var(--sn-text-3);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* One row per group: its name on the left, up to four numbers beside it. */
.sn-stats {
  margin: 20px 0 8px;
  border: 1px solid var(--sn-line);
  border-radius: 12px;
  background: var(--sn-surface);
  overflow: hidden;
}

.group {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
}

.group + .group {
  border-top: 1px solid var(--sn-line);
}

.name {
  margin: 0;
  padding: 18px 0 0 18px;
  color: var(--sn-text-3);
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.5;
}

.group dl {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
}

/* The number reads first, although the label comes first in the markup. */
.group dl > div {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 14px 14px 15px;
}

.sn-stats dd {
  order: -1;
  margin: 0;
  color: var(--sn-text);
  font-size: 24px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1.3;
}

.sn-stats dt {
  color: var(--sn-text-2);
  font-size: 13.5px;
  line-height: 1.45;
}

.sn-stats .note {
  display: block;
  margin-top: 2px;
  color: var(--sn-text-3);
  font-size: 12px;
}

.sn-versions {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 0 24px;
  margin: 16px 0 8px;
}

.sn-versions > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--sn-line);
}

.sn-versions dt {
  color: var(--sn-text);
  font-size: 14px;
  font-weight: 500;
}

.sn-versions dd {
  display: flex;
  flex-direction: row-reverse;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  color: var(--sn-text-3);
  font-size: 12.5px;
  text-align: right;
}

.sn-versions code {
  padding: 0;
  background: none;
  color: var(--sn-text-2);
  font-size: 12.5px;
}

@media (max-width: 640px) {
  .group {
    grid-template-columns: 1fr;
  }

  .name {
    padding: 14px 16px 0;
  }

  .group dl {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .group dl > div {
    padding-inline: 16px;
  }
}

@media (max-width: 560px) {
  .checks li {
    grid-template-columns: 22px minmax(0, 1fr);
  }

  .count {
    grid-column: 2;
  }
}
</style>
