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

1. It builds a release binary and starts it with a temporary data directory and title fetching turned off.
2. It creates two links: `/hot` is a plain link; `/limited` has a very large visit limit, so every visit goes through the atomic visit counter.
3. It runs [bombardier](https://github.com/codesenberg/bombardier) against `/hot`, `/limited` and the unknown `/nope` in turn, each with {{ benchmark.connections }} connections for {{ benchmark.duration }}. Requests carry a desktop browser’s User-Agent and a referrer, so every redirect counts as a click.
4. Once the last batch of clicks is written, it compares the clicks recorded for `/hot` with the redirects bombardier counted, and fails if they differ.

This run used an {{ benchmark.cores }}-core laptop ({{ benchmark.cpu }}, {{ benchmark.environment }}), with the load generator on the same machine competing for the CPU. Repeated runs on the laptop vary by about 10%. In a real deployment the network and the reverse proxy add latency, but none of that is Sani’s.

## Not a click lost

During the {{ benchmark.duration }} on `/hot`, Sani served {{ num(benchmark.clicks.served) }} redirects, and the database recorded {{ num(benchmark.clicks.counted) }} clicks. Counting holds up under load because clicks are first added up in memory per link and then written in batches by a background task; a cached redirect never waits for a write.

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
- **Unknown slugs are cached too.** They’re kept separately and bounded, so a scan for random slugs neither keeps querying the database nor pushes real links out. The 404 page is prerendered and costs a few writes.
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

<div class="table-wrap"><table>
<thead><tr><th>Links</th><th>Workload</th><th>P50 (ms)</th><th>P95 (ms)</th><th>P99 (ms)</th></tr></thead>
<tbody><template v-for="d in capacity.datasets" :key="d.links"><tr v-for="r in d.runs" :key="r.name">
<td>{{ num(d.links) }}</td><td>{{ workloadNames[r.name] }}</td><td>{{ r.p50_ms }}</td><td>{{ r.p95_ms }}</td><td>{{ r.p99_ms }}</td>
</tr></template></tbody>
</table></div>

<div class="table-wrap"><table>
<thead><tr><th>Links</th><th>Batch import (ms)</th><th>Sampled peak RSS (MiB)</th><th>Recorded / stored</th><th>SQLITE_BUSY</th></tr></thead>
<tbody><tr v-for="d in capacity.datasets" :key="d.links">
<td>{{ num(d.links) }}</td><td>{{ d.import_ms }}</td><td>{{ (d.peak_rss_kib / 1024).toFixed(1) }}</td><td>{{ num(d.recorded_clicks) }} / {{ num(d.stored_clicks) }}</td><td>{{ d.sqlite_busy }}</td>
</tr></tbody>
</table></div>

At 100k links, removing the unnecessary contents join from ordinary count queries reduced the same-machine list P50 from 5.229 ms to 1.085 ms. Search retains substring matching and a full count, with P95 82.170 ms. Keep that implementation for current single-owner use; consider FTS or a pagination-contract change only when an observed interaction bottleneck warrants it.

There were no reader-pool waits. The 100k mixed workload queued on the single writer 399 times for 149.815 ms in total; the largest observed WAL file was 20.2 MiB. Raw results in `docs/.vitepress/data/capacity.json` include per-workload `WaitCount`, `WaitDuration` and WAL bytes. Ordinary CI validates counts at 1k, while the weekly scheduled run covers all three sizes. Noisy absolute timings are not CI failure thresholds.
