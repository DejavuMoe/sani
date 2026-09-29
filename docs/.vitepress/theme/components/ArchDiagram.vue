<script setup lang="ts">
// How a request moves through Sani, drawn with real text so it follows the
// theme, reads in order for screen readers and reflows on phones. Numbers
// come from the source (shard counts, flush interval) and the benchmark.
import { computed } from 'vue';
import { benchmark } from '../../data/benchmark';
import { useLang } from '../i18n';

const { pick } = useLang();

const us = (ns: number) => `${(ns / 1000).toFixed(2)} µs`;

interface Node {
  title: string;
  sub: string;
  kind?: 'actor' | 'fast' | 'store' | 'outside';
}

const lanes = computed(() => [
  {
    id: 'hot',
    title: pick('访客跳转', 'A visitor follows a link'),
    note: pick('热路径：不碰数据库，也不等任何写入', 'The hot path: no database, no waiting on writes'),
    main: [
      { title: pick('访客', 'Visitor'), sub: 'GET /k7m2p', kind: 'actor' },
      { title: pick('跳转缓存', 'Redirect cache'), sub: pick('内存 · 64 个分片 · 读锁下一次查找', 'Memory · 64 shards · one lookup under a read lock'), kind: 'fast' },
      { title: '302 Location', sub: pick(`处理耗时约 ${us(benchmark.micro.redirectNs)}`, `about ${us(benchmark.micro.redirectNs)} to handle`) },
    ] as Node[],
    branchLabel: pick('同时计一次点击', 'and counts a click'),
    branch: [
      { title: pick('点击聚合', 'Click aggregation'), sub: pick('内存累加 · 32 个分片 · 每 2 秒写入一次', 'In-memory counters · 32 shards · written every 2 s'), kind: 'fast' },
      { title: 'SQLite', sub: pick('每次一个事务 · 单个写连接 · WAL 模式', 'One transaction each time · one writer · WAL mode'), kind: 'store' },
    ] as Node[],
    foot: pick(
      '未命中时从读连接池查一次数据库，同一个短码的并发未命中只查一次；不存在的短码记入有上限的未命中缓存，随机扫描挤不掉真实链接。',
      'On a miss, one read from the reader pool, shared by concurrent misses for the same slug. Unknown slugs go into a bounded miss cache, so random scans can’t push real links out.',
    ),
  },
  {
    id: 'cold',
    title: pick('你在管理界面里', 'You, in the admin app'),
    note: pick('冷路径：写入之后立即刷新缓存', 'The cold path: writes refresh the cache at once'),
    main: [
      { title: pick('管理界面或脚本', 'Admin app or script'), sub: pick('会话 Cookie · API 令牌', 'Session cookie · API token'), kind: 'actor' },
      { title: 'JSON API', sub: pick('/api · 同源校验 · 登录限流', '/api · same-origin check · sign-in limits') },
      { title: 'SQLite', sub: pick('写入即生效，缓存随之失效', 'Changes apply at once; the cache entry is dropped'), kind: 'store' },
    ] as Node[],
    branchLabel: pick('新链接', 'for a new link'),
    branch: [
      { title: pick('标题与图标抓取', 'Title and icon fetcher'), sub: pick('后台进行 · 最多 3 个并发', 'In the background · 3 at a time'), kind: 'fast' },
      { title: pick('目标网站', 'The destination'), sub: pick('只访问公网地址：解析后查一次，连接时再查一次', 'Public addresses only: checked after DNS and again on connect'), kind: 'outside' },
    ] as Node[],
    foot: pick(
      '抓取在后台进行，不会拖慢创建链接；标题获取失败时，列表显示目标域名。',
      'Fetching happens in the background and never delays creating a link; when it fails, the list shows the domain instead.',
    ),
  },
]);
</script>

<template>
  <figure class="sn-arch">
    <section v-for="lane in lanes" :key="lane.id" class="lane" :class="lane.id">
      <header>
        <strong>{{ lane.title }}</strong>
        <span>{{ lane.note }}</span>
      </header>
      <div class="flow">
        <template v-for="(n, i) in lane.main" :key="n.title">
          <span v-if="i > 0" class="edge" :style="{ gridArea: `e${i - 1}` }" aria-hidden="true" />
          <div class="node" :class="n.kind" :style="{ gridArea: `m${i}` }">
            <b>{{ n.title }}</b>
            <small>{{ n.sub }}</small>
          </div>
        </template>
        <span class="drop" aria-hidden="true"><i>{{ lane.branchLabel }}</i></span>
        <span class="visually-hidden">{{ lane.branchLabel }}：</span>
        <div class="node" :class="lane.branch[0].kind" style="grid-area: b0">
          <b>{{ lane.branch[0].title }}</b>
          <small>{{ lane.branch[0].sub }}</small>
        </div>
        <span class="edge" style="grid-area: be" aria-hidden="true" />
        <div class="node" :class="lane.branch[1].kind" style="grid-area: b1">
          <b>{{ lane.branch[1].title }}</b>
          <small>{{ lane.branch[1].sub }}</small>
        </div>
      </div>
      <p class="foot">{{ lane.foot }}</p>
    </section>
  </figure>
</template>

<style scoped>
.sn-arch {
  display: grid;
  gap: 14px;
  margin: 28px 0;
}

.lane {
  padding: 18px 20px 16px;
  border: 1px solid var(--sn-line);
  border-radius: 12px;
  background: var(--sn-surface);
}

.lane.hot {
  border-color: color-mix(in oklab, var(--sn-accent) 24%, var(--sn-line));
}

header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  margin-bottom: 16px;
}

header strong {
  color: var(--sn-text);
  font-size: 14.5px;
  font-weight: 600;
}

header span {
  color: var(--sn-text-3);
  font-size: 12.5px;
}

.flow {
  display: grid;
  grid-template-areas:
    'm0 e0 m1 e1 m2'
    '.  .  d  .  .'
    '.  .  b0 be b1';
  grid-template-columns: minmax(0, 1fr) 36px minmax(0, 1fr) 36px minmax(0, 1fr);
  align-items: stretch;
}

.node {
  display: grid;
  align-content: center;
  gap: 3px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--sn-line-2);
  border-radius: 10px;
  background: var(--sn-surface);
}

.node b {
  color: var(--sn-text);
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.35;
}

.node small {
  color: var(--sn-text-3);
  font-size: 12px;
  line-height: 1.45;
}

.node.actor {
  border-style: solid;
  background: var(--sn-canvas);
}

.node.fast {
  border-color: var(--sn-accent-line);
  background: color-mix(in oklab, var(--sn-accent) 6%, var(--sn-surface));
}

.node.store {
  background: var(--sn-surface-2);
}

.node.outside {
  border-color: var(--sn-line);
  background: transparent;
}

/* A hairline with an arrowhead, centered between two nodes. */
.edge {
  position: relative;
  align-self: center;
  height: 1px;
  margin: 0 5px;
  background: var(--sn-text-4);
}

.edge::after {
  content: '';
  position: absolute;
  top: -3.5px;
  right: -1px;
  width: 7px;
  height: 7px;
  border-top: 1px solid var(--sn-text-4);
  border-right: 1px solid var(--sn-text-4);
  transform: rotate(45deg);
}

/* From the middle node down to the branch. */
.drop {
  position: relative;
  grid-area: d;
  justify-self: center;
  width: 1px;
  height: 34px;
  background: var(--sn-text-4);
}

.drop::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: -3.5px;
  width: 7px;
  height: 7px;
  border-right: 1px solid var(--sn-text-4);
  border-bottom: 1px solid var(--sn-text-4);
  transform: rotate(45deg);
}

.drop i {
  position: absolute;
  top: 50%;
  left: 10px;
  color: var(--sn-text-3);
  font-size: 11px;
  font-style: normal;
  white-space: nowrap;
  transform: translateY(-50%);
}

.foot {
  margin: 14px 0 0;
  color: var(--sn-text-3);
  font-size: 12.5px;
  line-height: 1.65;
}

@media (max-width: 1100px) and (min-width: 721px) {
  .flow {
    grid-template-columns: minmax(0, 1fr) 28px minmax(0, 1fr) 28px minmax(0, 1fr);
  }
}

/* Phones: one column, in reading order. */
@media (max-width: 720px) {
  .flow {
    grid-template-areas: none;
    grid-template-columns: 1fr;
    gap: 0;
  }

  .flow > * {
    grid-area: auto !important;
  }

  .edge {
    justify-self: center;
    width: 1px;
    height: 22px;
    margin: 0;
  }

  .edge::after {
    top: auto;
    right: auto;
    bottom: -1px;
    left: -3.5px;
    transform: rotate(135deg);
  }

  .drop {
    height: 30px;
  }
}
</style>
