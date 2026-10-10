<script setup>
import capacity from '../../.vitepress/data/capacity.json'
import { benchmark } from '../../.vitepress/data/benchmark'

const num = (n) => n.toLocaleString('en-US')
const workloadNames = { list: 'List', search: 'Search', 'click-sort': 'Click sort', 'cold-redirect': 'Cold redirect', flush: 'Flush', mixed: 'Mixed I/O' }
</script>

# Performance

<p class="lead">Redirecting is what Sani does most, so every step on that path is designed to be fast and predictable. The recorded redirect baseline and current working-tree capacity measurements below each retain their date and method.</p>

<PerfChart />

## How it was measured

`make load` runs the repository’s `scripts/load.sh`:

1. It builds an optimized local binary and starts it with a temporary data directory and title fetching turned off.
2. It creates two links: `/hot` is a plain link; `/limited` has a very large visit limit, so every visit goes through the atomic visit counter.
3. It runs [bombardier](https://github.com/codesenberg/bombardier) against `/hot`, `/limited` and the unknown `/nope` in turn, each with {{ benchmark.connections }} connections for {{ benchmark.duration }}. Requests carry a desktop browser’s User-Agent and a referrer, so every redirect counts as a click.
4. Once the last batch of clicks is written, it compares the clicks recorded for `/hot` with the redirects bombardier counted, and fails if they differ.

This run used an {{ benchmark.cores }}-core laptop ({{ benchmark.cpu }}, {{ benchmark.environment }}), with the load generator on the same machine competing for the CPU. Repeated runs on the laptop vary by about 10%. In a real deployment the network and the reverse proxy add latency, but none of that is Sani’s.

## Click count verification

During the {{ benchmark.duration }} on `/hot`, Sani served {{ num(benchmark.clicks.served) }} redirects, and the database recorded {{ num(benchmark.clicks.counted) }} clicks. Counting holds up under load because clicks are first added up in memory per link and then written in batches by a background task; a cached redirect never waits for a write.

This checks count consistency after flushing in a normal run, not lossless persistence through crashes or power failure. See [Operations](../guide/operations) for those durability limits.

## Microbenchmarks

`make bench` measures single steps with Go’s benchmarks. All three run in parallel: every CPU core works on the same link at once, so the numbers include contention on the same lock.

| Benchmark | Per operation | Measures |
|---|---|---|
| `BenchmarkRedirect` | {{ benchmark.micro.redirectNs }} ns | The whole redirect handler: routing, cache lookup, state checks, recording the click, writing headers |
| `BenchmarkGetHit` | {{ benchmark.micro.cacheHitNs }} ns | A cache hit |
| `BenchmarkRecord` | {{ benchmark.micro.recordClickNs }} ns | Recording one click |

## Why it’s fast

- **A sharded cache.** Redirect targets sit in 64 shards; a hit is one map lookup under a read lock, and shards don’t get in each other’s way.
- **Clicks stay in memory.** Recording a click never touches the database. Every 2 seconds all clicks go out in one transaction, however many there were.
- **Unknown slugs are cached too.** A separate bounded cache reduces repeated misses without evicting valid links. Scanning new slugs still queries the database; prerendered error pages reduce response work.
- **Separate readers and writer.** SQLite WAL permits normal reads alongside writes; pool contention, external writers and cold counter snapshots can still wait.
- **Precompressed assets.** The admin app is compressed with Brotli and gzip at build time and sent as is, never compressed at runtime.

The details are in [Architecture](./architecture).

## Run it yourself

```sh
go install github.com/codesenberg/bombardier@latest
make load                           # 128 connections, 15 seconds per path
CONNS=256 DURATION=30s make load    # other connection counts and durations
make bench                          # the microbenchmarks
```

The numbers on this site and in the READMEs come from `docs/.vitepress/data/benchmark.ts`. After a new run, update that file and the tables in both READMEs; the docs build checks that they agree.

## Capacity and dataset size {#capacity}

`make capacity` uses disposable SQLite databases with 1k, 10k and 100k URL links, 200 samples per workload, and 8 mixed workers (2 writers and 6 readers, 200 operations each). List, search and import timings cover the store layer; cold redirects use the real HTTP handler without network transport. Each flush records one click on 200 links and includes aggregation plus the transaction. RSS is sampled every 10 ms. WAL is the file size, not the amount awaiting a checkpoint.

Measured at {{ capacity.at }} using {{ capacity.go }}, {{ capacity.os }} / WSL2, {{ capacity.cpus }} Go scheduler cores, Intel Core Ultra 7 255H. This is a working-tree measurement, not a new published release. Sampled tail latency and shared machine resources vary; these numbers are not a production SLA.

<div class="table-wrap" tabindex="0"><table>
<thead><tr><th>Links</th><th>Workload</th><th>P50 (ms)</th><th>P95 (ms)</th><th>P99 (ms)</th></tr></thead>
<tbody><template v-for="d in capacity.datasets" :key="d.links"><tr v-for="r in d.runs" :key="r.name">
<td>{{ num(d.links) }}</td><td>{{ workloadNames[r.name] }}</td><td>{{ r.p50_ms }}</td><td>{{ r.p95_ms }}</td><td>{{ r.p99_ms }}</td>
</tr></template></tbody>
</table></div>

<div class="table-wrap" tabindex="0"><table>
<thead><tr><th>Links</th><th>Batch import (ms)</th><th>Sampled peak RSS (MiB)</th><th>Recorded / stored</th><th>SQLITE_BUSY</th></tr></thead>
<tbody><tr v-for="d in capacity.datasets" :key="d.links">
<td>{{ num(d.links) }}</td><td>{{ d.import_ms }}</td><td>{{ (d.peak_rss_kib / 1024).toFixed(1) }}</td><td>{{ num(d.recorded_clicks) }} / {{ num(d.stored_clicks) }}</td><td>{{ d.sqlite_busy }}</td>
</tr></tbody>
</table></div>

Ordinary count queries avoid an unnecessary contents join. In this run, the 100k list P50 is 1.158 ms. Search retains substring matching and a full count, with P95 92.477 ms. Keep that implementation for current single-owner use; consider FTS or a pagination-contract change only when an observed interaction bottleneck warrants it.

There were no reader-pool waits. The 100k mixed workload queued on the single writer 399 times for 188.071 ms in total; the largest observed WAL file was 20.2 MiB. Raw results in `docs/.vitepress/data/capacity.json` include per-workload `WaitCount`, `WaitDuration` and WAL bytes. Ordinary CI validates counts at 1k, while the weekly scheduled run covers all three sizes. Noisy absolute timings are not CI failure thresholds.

## 2026-10-10 ablation comparison {#ablation}

The baseline is `2817cdc`; the experiment uses the subsequent local Sani API changes, Go 1.27.2, WSL2 Linux amd64, an Intel Core Ultra 7 255H and eight Go scheduler cores. `make ablation` runs each case three times. `internal/server/ablation_test.go` gives every case its own temporary SQLite database and the same target, User-Agent and Referer. Only one condition changes; there are no production switches.

| Condition | Three runs, ns/op | B/op | allocs/op | Database loads/request | Click write transactions/request |
|---|---|---|---|---|---|
| Cache + batch aggregation | 891.3 / 891.7 / 875.9 | 440 | 5 | 0 | One for the whole run |
| Invalidate before every request | 12715 / 12537 / 12686 | 2864–2865 | 60 | 1 | One for the whole run |
| Flush after every click | 52846 / 53354 / 53418 | 5672 | 92 | 0 | 1 |

Every case checks the redirect target and asserts that persisted clicks and referrer counts equal requests. At the median, forced cold loading is about 14.2 times slower and flushing each click is about 59.9 times slower; the existing cache and aggregation stay. The cold case also includes invalidation overhead. This serial microbenchmark times the final flush and is not the parallel `BenchmarkRedirect` or a network throughput test. Temporary SQLite uses the project's WAL/NORMAL settings; results are not production disk latency or durability guarantees.

Protocol ablation removes GET creation/deletion, query credentials, duplicate domain discovery, the upload field alias and placeholder response fields. Resource operations shrink from 15 to 12, with real HTTP checks for statuses, Location, shapes, rejected parameters and public URLs. Schema 6 and existing file keys remain; this change adds no migration.
