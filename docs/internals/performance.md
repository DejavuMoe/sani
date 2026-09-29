<script setup>
import { benchmark } from '../.vitepress/data/benchmark'

const num = (n) => n.toLocaleString('zh-CN')
</script>

# 性能

<p class="lead">跳转是 Sani 最常做的事，所以跳转路径上的每一步都为速度和可预测性而设计。下面是最近一次压测的结果、测试的方法，以及这些数字背后的做法。</p>

<PerfChart />

## 怎么测的

`make load` 运行仓库里的 `scripts/load.sh`：

1. 构建发布版的二进制文件，用一个临时的数据目录启动，关闭标题抓取。
2. 创建两条链接：`/hot` 是普通链接；`/limited` 设置了一个很大的访问上限，这样每次访问都要经过访问次数的原子计数。
3. 用 [bombardier](https://github.com/codesenberg/bombardier) 依次压测 `/hot`、`/limited` 和不存在的 `/nope`，每个路径 {{ benchmark.connections }} 个并发连接、持续 {{ benchmark.duration }}。请求带着桌面浏览器的 User-Agent 和一个来源网址，所以每一次跳转都会计为一次点击。
4. 等最后一批点击写入数据库之后，比较 `/hot` 记录的点击数和 bombardier 统计的跳转次数，两者不一致就判定失败。

这次测试在一台 {{ benchmark.cores }} 核的笔记本上进行（{{ benchmark.cpu }}，{{ benchmark.environment }}），压测工具和 Sani 运行在同一台机器上，互相争抢 CPU。同一台笔记本上多次运行，结果会有 10% 左右的浮动。真实部署时，网络和反向代理会增加延迟，但这部分与 Sani 无关。

## 点击一次不差

压测 `/hot` 的这 {{ benchmark.duration }} 里，Sani 完成了 {{ num(benchmark.clicks.served) }} 次跳转，数据库里记录了 {{ num(benchmark.clicks.counted) }} 次点击。高并发下计数不丢失，是因为点击先在内存中按链接累加，再由一个后台任务批量写入；跳转本身从不等待写入完成。

## 微基准

`make bench` 用 Go 的基准测试测量单个环节的开销。三项都是并行基准：所有 CPU 核心同时对同一条链接执行，所以包含了争抢同一把锁的开销。

| 基准测试 | 每次操作 | 测量的内容 |
|---|---|---|
| `BenchmarkRedirect` | {{ benchmark.micro.redirectNs }} ns | 完整的跳转处理：路由、查缓存、检查状态、记录点击、写响应头 |
| `BenchmarkGetHit` | {{ benchmark.micro.cacheHitNs }} ns | 缓存命中 |
| `BenchmarkRecord` | {{ benchmark.micro.recordClickNs }} ns | 记录一次点击 |

## 为什么快

- **缓存分片**：跳转目标缓存分成 64 个分片，命中时只是读锁下的一次 map 查找，不同分片之间互不影响。
- **点击只在内存里累加**：记录一次点击不碰数据库。每 2 秒，所有点击合并成一个事务写入，无论这 2 秒里有多少次点击。
- **不存在的短码也缓存**：它们单独缓存、有数量上限，扫描随机短码既不会反复查询数据库，也不会把真实的链接挤出缓存。404 页面预先渲染好，返回时只需要写几段字节。
- **读写分离**：SQLite 使用 WAL 模式，一个写连接加一组读连接，读取不会被写入阻塞。
- **静态资源预压缩**：管理界面在构建时压缩成 Brotli 和 gzip，服务时直接发送，不在运行时压缩。

具体的实现见[架构](./architecture)。

## 自己测一遍

```sh
go install github.com/codesenberg/bombardier@latest
make load                           # 默认 128 个连接，每个路径 15 秒
CONNS=256 DURATION=30s make load    # 调整连接数和时长
make bench                          # 微基准
```

本站和 README 里的数字都来自 `docs/.vitepress/data/benchmark.ts`。重新测试之后，更新这个文件和两份 README 里的表格；文档构建时会检查它们是否一致。
