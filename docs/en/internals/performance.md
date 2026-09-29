<script setup>
import { benchmark } from '../../.vitepress/data/benchmark'

const num = (n) => n.toLocaleString('en-US')
</script>

# Performance

<p class="lead">Redirecting is what Sani does most, so every step on that path is designed to be fast and predictable. Here are the latest load test results, how they were measured, and what’s behind them.</p>

<PerfChart />

## How it was measured

`make load` runs the repository’s `scripts/load.sh`:

1. It builds a release binary and starts it with a temporary data directory and title fetching turned off.
2. It creates two links: `/hot` is a plain link; `/limited` has a very large visit limit, so every visit goes through the atomic visit counter.
3. It runs [bombardier](https://github.com/codesenberg/bombardier) against `/hot`, `/limited` and the unknown `/nope` in turn, each with {{ benchmark.connections }} connections for {{ benchmark.duration }}. Requests carry a desktop browser’s User-Agent and a referrer, so every redirect counts as a click.
4. Once the last batch of clicks is written, it compares the clicks recorded for `/hot` with the redirects bombardier counted, and fails if they differ.

This run used an {{ benchmark.cores }}-core laptop ({{ benchmark.cpu }}, {{ benchmark.environment }}), with the load generator on the same machine competing for the CPU. Repeated runs on the laptop vary by about 10%. In a real deployment the network and the reverse proxy add latency, but none of that is Sani’s.

## Not a click lost

During the {{ benchmark.duration }} on `/hot`, Sani served {{ num(benchmark.clicks.served) }} redirects, and the database recorded {{ num(benchmark.clicks.counted) }} clicks. Counting holds up under load because clicks are first added up in memory per link and then written in batches by a background task; a redirect never waits for a write.

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
- **Reads don’t wait for writes.** SQLite runs in WAL mode with one writer connection and a pool of readers.
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
