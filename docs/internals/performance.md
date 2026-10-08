<script setup>
import capacity from '../.vitepress/data/capacity.json'
import { benchmark } from '../.vitepress/data/benchmark'

const num = (n) => n.toLocaleString('zh-CN')
const workloadNames = { list: '列表', search: '搜索', 'click-sort': '按点击排序', 'cold-redirect': '冷缓存跳转', flush: '刷盘', mixed: '混合读写' }
</script>

# 性能

<p class="lead">短链跳转为 Sani 最核心的工作负载，其执行链路上每个环节均针对极低延迟与高确定性深入优化。以下展示跳转基准与存储容量压测数据。</p>

<PerfChart />

## 测试方法与度量准则

执行 `make load` 触发压测套件 `scripts/load.sh`：

1. 编译正式发行版二进制，挂载临时数据目录启动并关闭异步元数据抓取。
2. 预设两条基准链接：`/hot` 为无限制常规链接；`/limited` 设定高访问上限以覆盖原子计数器损耗。
3. 使用 [bombardier](https://github.com/codesenberg/bombardier) 对 `/hot`、`/limited` 及未命中路径 `/nope` 展开全量压测，每路径施加 {{ benchmark.connections }} 并发连接，持续 {{ benchmark.duration }}。请求携带完整桌面端 User-Agent 与 Referer 标头，保证每次跳转均触发统计计数。
4. 等待内存最后一批点击安全落库后，比对 `/hot` 记录的点击总量与 bombardier 压测统计的跳转总量，二者必须绝对一致。

本次测试运行于一台 {{ benchmark.cores }} 核笔记本（{{ benchmark.cpu }}，{{ benchmark.environment }}），压测程序与 Sani 本机同跑且竞争 CPU。同机多次测试通常存在约 10% 波动。生产落地时网络往返与反向代理会引入附加延迟，但不属于 Sani 自身开销。

## 压测计数核对

在 `/hot` 压测的 {{ benchmark.duration }} 内，Sani 累计完成了 {{ num(benchmark.clicks.served) }} 次跳转，刷盘后数据库记录了 {{ num(benchmark.clicks.counted) }} 次点击。点击在内存分片中累加并批量落库，缓存命中的跳转不等待数据库写入。这验证了本次正常运行的计数一致性，不代表崩溃或断电时无数据丢失；持久性边界见[运维](../guide/operations)。

## 纳秒级微基准

`make bench` 采用 Go 标准基准框架测量核心代码路径的纯耗时。三项指标均采用并行基准（所有 CPU 核心同时高并发竞争同一条记录）：

| 基准测试 | 单次操作耗时 | 度量内容 |
|---|---|---|
| `BenchmarkRedirect` | {{ benchmark.micro.redirectNs }} ns | 完整跳转处理链路：路由、缓存查找、状态校验、点击累加、响应头输出 |
| `BenchmarkGetHit` | {{ benchmark.micro.cacheHitNs }} ns | 内存缓存直接命中 |
| `BenchmarkRecord` | {{ benchmark.micro.recordClickNs }} ns | 内存分片记录单次点击 |

## 性能优化要点

- **读写分片缓存**：跳转目标缓存均分为 64 个独立分片，命中只需在读锁下执行一次哈希查找，分片间无锁冲突。
- **纯内存统计累加**：记录有效点击完全不触碰数据库。每 2 秒将全量点击合并为单一 SQLite 事务批量提交，吞吐与单次 I/O 解耦。
- **负缓存减少重复回源**：不存在的短码独立放入有容量上限的缓存，不挤占有效链接。扫描新短码仍会触发查询；预渲染错误页减少响应生成开销。
- **读写隔离设计**：SQLite WAL 允许普通读与写并发；连接池竞争、外部写锁和冷加载计数快照仍可能等待。
- **构建期静态预压缩**：管理后台静态资源在构建期预先生成 Brotli 与 gzip，服务时按需直传，避免运行时压缩 CPU 损耗。

完整底层实现细节参见[架构设计](./architecture)。

## 本地复现测试

```sh
go install github.com/codesenberg/bombardier@latest
make load                           # 默认 128 连接，每路径压测 15 秒
CONNS=256 DURATION=30s make load    # 调整并发连接与压测时间
make bench                          # 运行 Go 微基准
```

文档与 README 中的基准数字源自 `docs/.vitepress/data/benchmark.ts`。重新测试后更新该文件并同步 README，文档构建时会自动执行一致性核对。

## 容量与存储规模度量 {#capacity}

`make capacity` 基于临时 SQLite 库，分别在 1千、1万、10万条链接规模下对各项指标采集 200 个样本；混合场景采用 8 个并发工作协程（2 写、6 读，各 200 次）。列表、搜索与导入聚焦存储层度量；冷缓存跳转走真实 HTTP 链路（剔除物理网卡传输）。刷盘测试按每批 200 条链接记录耗时（含内存聚合与事务提交）。内存 RSS 每 10 ms 周期性采样；WAL 大小度量文件体积而非未 checkpoint 的数据量。

测试时间：{{ capacity.at }}；{{ capacity.go }}，{{ capacity.os }} / WSL2，{{ capacity.cpus }} 个 Go 调度核心，Intel Core Ultra 7 255H。数据采自当前开发工作树。小样本长尾延迟与同机环境波动不可直接视作生产 SLA。

<div class="table-wrap"><table>
<thead><tr><th>链接数</th><th>场景</th><th>P50 (ms)</th><th>P95 (ms)</th><th>P99 (ms)</th></tr></thead>
<tbody><template v-for="d in capacity.datasets" :key="d.links"><tr v-for="r in d.runs" :key="r.name">
<td>{{ num(d.links) }}</td><td>{{ workloadNames[r.name] }}</td><td>{{ r.p50_ms }}</td><td>{{ r.p95_ms }}</td><td>{{ r.p99_ms }}</td>
</tr></template></tbody>
</table></div>

<div class="table-wrap"><table>
<thead><tr><th>链接数</th><th>整批导入 (ms)</th><th>采样 RSS 峰值 (MiB)</th><th>记录 / 落库</th><th>SQLITE_BUSY</th></tr></thead>
<tbody><tr v-for="d in capacity.datasets" :key="d.links">
<td>{{ num(d.links) }}</td><td>{{ d.import_ms }}</td><td>{{ (d.peak_rss_kib / 1024).toFixed(1) }}</td><td>{{ num(d.recorded_clicks) }} / {{ num(d.stored_clicks) }}</td><td>{{ d.sqlite_busy }}</td>
</tr></tbody>
</table></div>

在 10 万条链接规模下，优化计数查询并去除冗余的内容表 JOIN 后，同机列表 P50 耗时由 5.229 ms 降至 1.085 ms。搜索当前仍使用包含匹配与全量计数，P95 为 82.170 ms；在当前个人使用场景下保持该设计，待出现交互瓶颈再评估 FTS 全文索引或调整分页契约。

本轮测试中读连接池未发生等待；10 万条混合读写场景下写连接排队 399 次，累计排队耗时 149.815 ms，符合单写连接预期；测试中观测到的最大 WAL 文件为 20.2 MiB。完整 JSON 原始指标请参见 `docs/.vitepress/data/capacity.json`。日常 CI 运行 1 千档校验逻辑正确性，定时任务运行全量三档压测。
