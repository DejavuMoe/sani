<script setup lang="ts">
// Requests per second for each path of the latest load test: one series, so
// one color and no legend; the title names it. Values sit at the bar tips,
// latency lives in the tooltip and in the table underneath, which is also
// the chart's accessible twin.
import { computed, ref } from 'vue';
import { benchmark, type LoadRun } from '../../data/benchmark';
import { useLang } from '../i18n';

const { lang, pick } = useLang();

const names = computed<Record<LoadRun['id'], string>>(() =>
  pick(
    { hit: '命中缓存的跳转，计入点击', limited: '带访问上限的跳转', missing: '不存在的短码（404 页面）' },
    { hit: 'Cached redirect, click counted', limited: 'Redirect with a visit limit', missing: 'Unknown slug (404 page)' },
  ),
);

const num = (n: number) => n.toLocaleString(lang.value === 'zh' ? 'zh-CN' : 'en-US');
const ms = (n: number) => `${n.toFixed(2)} ms`;

// A clean round top for the axis, and hairlines at its steps.
const step = 50_000;
const top = Math.ceil(Math.max(...benchmark.runs.map((r) => r.rps)) / step) * step;
const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
const pct = (n: number) => `${(n / top) * 100}%`;

const active = ref<LoadRun['id'] | null>(null);
</script>

<template>
  <figure class="sn-perf">
    <figcaption class="head">
      <strong>{{ pick('每秒请求数', 'Requests per second') }}</strong>
      <span>
        {{ benchmark.tool }} · {{ benchmark.connections }} {{ pick('个连接', 'connections') }} · {{ benchmark.duration }} ·
        {{
          pick(
            `${benchmark.cpu}（${benchmark.cores} 核，${benchmark.environment}）`,
            `${benchmark.cpu} (${benchmark.cores} cores, ${benchmark.environment})`,
          )
        }}
      </span>
    </figcaption>

    <div class="plot" aria-hidden="true">
      <div class="grid">
        <span v-for="t in ticks" :key="t" class="tick" :style="{ left: pct(t) }">
          <span class="tick-label">{{ num(t) }}</span>
        </span>
      </div>
      <div
        v-for="r in benchmark.runs"
        :key="r.id"
        class="bar-row"
        :class="{ active: active === r.id, dim: active && active !== r.id }"
        @pointerenter="active = r.id"
        @pointerleave="active = null"
      >
        <span class="label">{{ names[r.id] }}</span>
        <span class="track">
          <span class="bar" :style="{ width: pct(r.rps) }" />
          <span class="value" :style="{ left: pct(r.rps) }">{{ num(r.rps) }}</span>
          <span v-if="active === r.id" class="tip" :style="{ left: pct(r.rps) }" role="presentation">
            <strong>{{ num(r.rps) }} {{ pick('次/秒', 'req/s') }}</strong>
            <span>p50 {{ ms(r.p50) }} · p99 {{ ms(r.p99) }}</span>
          </span>
        </span>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ pick('路径', 'Path') }}</th>
            <th class="n">{{ pick('每秒请求数', 'Requests/s') }}</th>
            <th class="n">p50</th>
            <th class="n">p99</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in benchmark.runs"
            :key="r.id"
            tabindex="0"
            :class="{ active: active === r.id }"
            @focus="active = r.id"
            @blur="active = null"
            @pointerenter="active = r.id"
            @pointerleave="active = null"
          >
            <td>{{ names[r.id] }} <code>GET {{ r.path }}</code></td>
            <td class="n">{{ num(r.rps) }}</td>
            <td class="n">{{ ms(r.p50) }}</td>
            <td class="n">{{ ms(r.p99) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </figure>
</template>

<style scoped>
.sn-perf {
  margin: 28px 0;
  padding: 20px 22px 8px;
  border: 1px solid var(--sn-line);
  border-radius: 12px;
  background: var(--sn-surface);
}

.head {
  display: grid;
  gap: 2px;
  margin-bottom: 22px;
}

.head strong {
  color: var(--sn-text);
  font-size: 15px;
  font-weight: 600;
}

.head span {
  color: var(--sn-text-3);
  font-size: 12.5px;
}

.plot {
  --label: 210px;
  --room: 64px; /* for the value at the longest bar's tip */
  position: relative;
  padding: 0 var(--room) 30px 0;
}

.grid {
  position: absolute;
  inset: 0 var(--room) 0 var(--label);
  pointer-events: none;
}

.tick {
  position: absolute;
  top: 0;
  bottom: 22px;
  width: 1px;
  background: var(--sn-line);
}

.tick-label {
  position: absolute;
  bottom: -22px;
  left: 0;
  color: var(--sn-text-3);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transform: translateX(-50%);
}

.tick:first-child .tick-label {
  transform: none;
}

.bar-row {
  position: relative;
  display: grid;
  grid-template-columns: var(--label) 1fr;
  align-items: center;
  min-height: 44px;
  transition: opacity 0.15s var(--sn-ease);
}

.bar-row.dim {
  opacity: 0.55;
}

.label {
  padding-right: 16px;
  color: var(--sn-text-2);
  font-size: 13px;
  line-height: 1.35;
}

.track {
  position: relative;
  height: 44px;
}

.bar {
  position: absolute;
  top: 15px;
  left: 0;
  height: 14px;
  border-radius: 0 4px 4px 0;
  background: var(--sn-accent);
  transition: filter 0.15s var(--sn-ease);
}

.bar-row.active .bar {
  filter: brightness(1.12);
}

.value {
  position: absolute;
  top: 12px;
  padding-left: 8px;
  color: var(--sn-text);
  font-size: 13px;
  font-weight: 550;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tip {
  position: absolute;
  bottom: 38px;
  z-index: 2;
  display: grid;
  gap: 2px;
  padding: 8px 11px;
  border: 1px solid var(--sn-line);
  border-radius: 8px;
  background: var(--sn-surface);
  box-shadow: var(--sn-shadow-pop);
  white-space: nowrap;
  transform: translateX(-100%);
  pointer-events: none;
}

.tip strong {
  color: var(--sn-text);
  font-size: 13.5px;
  font-weight: 600;
}

.tip span {
  color: var(--sn-text-3);
  font-size: 12px;
}

/* The .sn-perf prefix outranks the page's own table styles in style.css. */
.table-wrap {
  margin: 8px -22px 0;
  overflow-x: auto;
}

.sn-perf table {
  display: table;
  width: 100%;
  margin: 0;
  border-collapse: collapse;
  font-size: 13.5px;
}

.sn-perf tr {
  background: none !important;
}

.sn-perf :is(th, td) {
  padding: 9px 22px 9px 0;
  border: 0;
  border-top: 1px solid var(--sn-line);
  text-align: left;
  vertical-align: baseline;
}

.sn-perf :is(th, td):first-child {
  padding-left: 22px;
}

.sn-perf :is(th, td):last-child {
  padding-right: 22px;
}

.sn-perf th {
  color: var(--sn-text-3);
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
}

.sn-perf td code {
  margin-left: 6px;
  font-size: 11.5px;
  white-space: nowrap;
}

.sn-perf .n {
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

tbody tr.active td {
  background: var(--sn-canvas);
}

tbody tr:focus-visible {
  outline: 2px solid var(--sn-accent);
  outline-offset: -2px;
}

@media (max-width: 560px) {
  .sn-perf {
    padding-inline: 16px;
  }

  .plot {
    --label: 0px;
    --room: 56px;
    padding-bottom: 6px;
  }

  /* Labels sit above the bars here; every bar is labeled, so the grid goes. */
  .grid {
    display: none;
  }

  .bar-row {
    grid-template-columns: 1fr;
    padding-top: 4px;
  }

  .label {
    padding: 0;
  }

  .track {
    height: 34px;
  }

  .bar {
    top: 10px;
  }

  .value {
    top: 7px;
  }

  .table-wrap {
    margin-inline: -16px;
  }

  .sn-perf :is(th, td) {
    padding-right: 12px;
  }

  .sn-perf :is(th, td):first-child {
    padding-left: 16px;
  }

  .sn-perf :is(th, td):last-child {
    padding-right: 16px;
  }

  /* The path goes under its name, so four columns fit a phone. */
  .sn-perf td code {
    display: block;
    width: fit-content;
    margin: 4px 0 0;
  }
}
</style>
