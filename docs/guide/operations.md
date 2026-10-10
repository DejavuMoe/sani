# 运维

<p class="lead">Sani 的数据包含单个 SQLite 文件与可选的分享文件目录。日常运维十分轻量：定期备份、版本升级与管理员密码重置。</p>

## 分享过期、删除与文件回收 {#share-cleanup}

过期、达到访问上限和手动停用只会阻止后续访问，**不会自动删除记录、文本或文件**。管理员仍可调整限制或删除分享。访问上限为 1 表示一次有效访问，不是读完后销毁：文件在开始发送有效的 `200`/`206` 内容时计数，不能据此证明访客已完整下载。

通过管理 API 或后台手动删除网址、文本或文件分享后，到达源站的新请求立即失效，后台按以下步骤清理：

1. 先软删除，保留记录供恢复。每分钟检查一次，清除删除时间超过一小时的记录及关联统计、文本和文件引用。
2. 文件扫描约每十分钟运行一次，移除已无数据库引用、且修改时间超过十分钟的文件。遗留的 `.upload-*` 临时文件需超过一小时才可回收。

服务持续运行、没有权限错误或活跃上传阻挡时，普通文件通常在删除后约 **60–70 分钟**回收；这是后台周期，不是严格期限。扫描与上传互斥，有上传正在写入时会跳过本轮文件扫描。服务停止时不会清理，重启后第一次维护约在一分钟后运行，仍按原删除时间判断。排查时查看 `purge deleted links`、`list files`、`list stored files`、`remove file` 错误，以及 `removed unused files` 成功日志。

记录尚未被清理且短码未被复用时可以恢复；复用短码会提前移除旧记录，旧文件随后进入回收流程。恢复不会重置过期时间或已用访问次数。这套回收机制不会修改已有备份，也不承诺磁盘层面的安全擦除。

`files/` 中的 32 位十六进制名称是随机存储名。删除分享后短时间内仍看到它属于预期行为；只有过期、未删除时它会一直保留。`sani.db` 保存整个实例的链接、配置、账号和统计，`sani.db-wal` 与 `sani.db-shm` 是 SQLite 运行时文件，它们继续存在也正常。删除一条分享不会删除数据库，数据库文件也不一定立即缩小。不要手动删除正在使用的数据库、WAL/SHM 或不明引用的文件；先按下面的步骤备份。

## 在线备份 {#backup}

运行 `sani backup` 可在线生成一致的数据库快照，无需停机。该命令基于 SQLite 的 `VACUUM INTO`，备份同时会对数据页进行整理压缩：

::: code-group

```sh [Docker]
(umask 077; set -C; docker exec sani /sani backup - > sani-$(date +%F).db)
```

```sh [systemd]
sudo SANI_DATA_DIR=/var/lib/sani sani backup /root/sani-$(date +%F).db
```

```sh [直接运行]
sani backup ~/backups/sani-$(date +%F).db
```

:::

- 指定文件名为 `-` 时直接流式输出至标准输出，便于容器备份（注意 `docker exec` 不要添加 `-t`，避免终端控制符损坏二进制文件）。
- 直接指定文件时，以 `0600` 创建备份并拒绝已有文件或符号链接；失败时清理未完成副本。Windows 需通过目录 ACL 限制访问；备份目录应仅允许受信任的用户写入。
- 标准输出重定向由宿主 shell 创建文件，示例中的 `umask 077` 与 `set -C` 分别限制权限和禁止覆盖。失败的重定向可能留下不完整文件，不可用作恢复。
- 备份包含密码哈希、会话与令牌哈希、保存的代理密码和统计数据。旧备份的权限不会随升级改变，应单独检查；文件限制为 `0600`，目录可用 `0700`，Windows 使用对应 ACL。

通过 cron 配置每日备份并保留最近 14 天副本：

```sh
# crontab -e
15 4 * * * (umask 077; set -C; docker exec sani /sani backup - > /srv/backup/sani-$(date +\%F).db) && find /srv/backup -name 'sani-*.db' -mtime +14 -delete
```

若仅需可导入其他服务的纯链接列表，可在管理后台通过 设置 → 数据 → 导出（详见[导入与导出](./import-export)）。导出数据不含每日走势、来源排行、令牌、文本与文件，不可作为容灾备份。

### 数据库与文件完整备份 {#backup-files}

文本保存在数据库内，分享的文件则存放在 `files/` 目录下。**制作完整备份前，必须停止所有 Sani 实例及其他数据库写入进程，再完整复制数据目录。** 单独执行 `sani backup` 仅导出已提交的数据库数据，不包含内存中的未刷盘点击与文件二进制。

上传后的文件虽不可修改，但后台清理任务会异步移除已取消分享的文件。若先在线备份数据库、稍后再复制 `files/`，无法保证数据库所引用的文件在复制时尚未被清理；短码被复用时旧文件也可能提前变为待清理项。

执行冷备前应先确认进程完全退出，再复制数据库、WAL 文件及文件目录。复制失败时应保持停机排查错误，不可将异常退出视为最后一批点击已落库：

::: code-group

```sh [Docker]
set -eu
backup="$PWD/sani-full-$(date +%Y%m%d-%H%M%S)"
test ! -e "$backup"
docker stop --time 30 sani
test "$(docker inspect -f '{{.State.ExitCode}}' sani)" = 0
docker cp sani:/data "$backup"
docker start sani
```

```sh [systemd]
set -eu
backup="/root/sani-full-$(date +%Y%m%d-%H%M%S)"
sudo test ! -e "$backup"
sudo systemctl stop sani
test "$(systemctl show sani -p ExecMainStatus --value)" = 0
sudo cp -a /var/lib/sani "$backup"
sudo systemctl start sani
```

:::

建议将该目录作为完整灾备归档，记录对应的 Sani 版本、备份时间及环境变量。复制到异地后校验文件大小与 SHA-256。如需热备方案，应使用底层存储卷或文件系统级的原子快照，并独立演练验证，不可依赖先后复制顺序来推断一致性。

## 数据恢复

恢复前请先保护当前损坏或存疑的数据，确保完全停机后按需操作：

1. **完整目录恢复**：还原至全新的空目录或空数据卷。必须确保同批次备份中的 `sani.db`、WAL/SHM 文件与 `files/` 目录严格配套，切勿混入旧环境残留文件。调整 `SANI_DATA_DIR` 或 Compose 挂载路径，并修复文件所属权限（镜像内置运行用户为 `65532:65532`）。
2. **`sani backup` 数据库快照恢复**：还原为空目录下的 `sani.db`，无需携带原实例的 WAL/SHM 文件。若仅使用网址与文本分享，恢复该文件即可；若包含文件分享，仍需搭配同一停机时间点提取的 `files/`。仅凭在线数据库副本无法保证早期文件完整可下。

在切换生产流量或 DNS 前，先在本地隔离实例中验证 `/healthz`、登录鉴权、链接跳转、文本展示、文件下载及 SHA-256 校验。升级后的版本回退依赖升级前的完整备份，禁止用旧版二进制直接运行新版迁移后的数据库。`go test ./cmd/sani -run TestStoppedBackup` 验证存储层刷盘、快照和文件复制；`make smoke` 进一步运行真实二进制，覆盖 SIGTERM 停机、CLI 标准输出备份，以及恢复后通过 HTTP 访问网址、文本、文件和标签。两者都不能替代对自己部署的恢复演练。

## 版本升级 {#upgrade}

**v0.9.5 含不兼容的 API 变更与 schema 6 迁移**，是[修订版本规则的一次性例外](../project/versioning#v095-exception)。从 v0.9.4 或更早版本升级须完成以下流程。

本次移除旧管理 API，改用 `/api/admin/v1` 和 Sani 资源 API `/api/v1`。升级前必须**先在旧后台导出 JSON**，再正常停机，完整备份数据库（包括仍存在的 WAL/SHM）、`files/`、Compose/环境变量/密钥、代理与域名配置，以及固定的旧镜像或二进制。副本保存在运行目录之外。后台 JSON 只有网址链接和标签，不能恢复分享文本/文件、凭据和完整统计；CSV 可作额外副本。**正常升级是原地增量迁移，不要导出再导入。**

第一次启动前，在原配置和部署 UID（Docker 为 `65532:65532`）下，用新版 [`preflight`](../reference/cli#sani-preflight) 检查已停机数据或完整副本。Compose 已选定并校验目标镜像、旧服务已停止后，执行 `docker compose run --rm --no-deps sani preflight`。检查输出，处理缺失/损坏文件及权限错误，并为数据库安全副本、事务/WAL 和上传文件预留空间。启动会先保存数据库安全副本，再将 schema 1–5 原子升级到 6；保留 ID、短码、密码/令牌/会话哈希、设置、统计和文件名，只新增随机文件删除密钥。旧公开地址与毫秒时间戳不变。使用资源 API 前须配置已有的规范主域名，不能从 Host 猜测历史域名。

验收旧登录/会话/令牌、网址跳转（含旧长目标）、文本原文、文件下载 SHA-256、标签和统计，重复启动并验证 HTTP 契约。失败时保留标准错误日志与完整快照，按预检或 migration 步骤诊断，修复原因后重试。回滚时先停止新版并另存失败现场，将**升级前完整快照恢复到空目录**，再用原镜像/二进制和原配置启动。禁止旧程序直接连接 schema 6，也不要混用不同时间的文件与配置；升级后新增的数据不在旧快照里。

仓库演练（仅一次性测试数据）：`OLD_BIN=/absolute/path/to/old-sani make upgrade-drill`。脚本创建 schema 5 旧实例、导出 JSON、保存停机数据/文件/配置，完成升级与 HTTP 契约/旧公开地址验收、重复启动和缺失文件拒绝，最后恢复完整快照并运行旧二进制。CI 使用基线提交 `8e374df55bdbd4a45353c1f6eeec2bfc3a671635`。这补充了 `make smoke`，不能替代自己部署环境的恢复演练。


先阅读目标版本的[更新日志](../project/changelog)，选择并固定版本标签或镜像摘要，并按[制品校验](./deploy#verify)下载、验证二进制。升级前执行[完整停机备份](#backup-files)，保留原版本制品与配置；此次备份完成后暂不执行备份示例末尾的启动命令，直到完成版本替换：

::: code-group

```sh [Docker]
docker compose pull
docker compose up -d
```

```sh [systemd]
# sani 为事先下载并校验的目标版本二进制
sudo systemctl stop sani
sudo install -m 755 sani /usr/local/bin/sani
sudo systemctl start sani
SANI_LISTEN=127.0.0.1:8080 sani healthcheck
```

:::

启动后检查日志、`/healthz`，并实际登录、跳转、读取文本和下载文件；健康检查地址需与你的 `SANI_LISTEN` 一致。`/healthz` 只检查进程存活，不能证明数据库可写或备份可恢复。数据库结构在启动时自动迁移；若需要回退，停止新版本，将升级前备份恢复至空目录，再使用原版本与原配置启动。单纯回退镜像或二进制不足以回退已迁移的数据。

## 重置管理员密码

遗忘密码时可通过 `sani passwd` 重设，该操作会强制使所有设备的登录会话失效：

::: code-group

```sh [Docker]
docker exec -it sani /sani passwd
```

```sh [systemd]
sudo SANI_DATA_DIR=/var/lib/sani sani passwd
```

:::

非交互式环境下支持通过标准输入管道传递新密码，如 `echo 'a-new-password' | docker exec -i sani /sani passwd`。

若配置了环境变量 `SANI_PASSWORD`，下次启动时仍会以环境变量值为准，此时应直接修改环境变量配置。

API 令牌不受密码变更影响。若怀疑令牌泄漏，请在后台 设置 → API 令牌 中手动撤销。

## 服务日志 {#logs}

日志统一输出至标准错误流（Docker 可通过 `docker logs sani` 查看，systemd 通过 `journalctl -u sani` 查看）。输出格式与过滤级别由 [`SANI_LOG_FORMAT`](../reference/configuration#sani-log-format) 及 [`SANI_LOG_LEVEL`](../reference/configuration#sani-log-level) 控制。

| 级别 | 记录内容 |
|---|---|
| `info` | 进程生命周期（监听端口、数据目录、时区、版本）、关闭、密码设置与更新、批量导入 |
| `warn` | 首次设置码、登录失败及设置码校验错误（含来源 IP） |
| `error` | 请求处理异常、点击刷盘失败、后台清理失败 |
| `debug` | 网页标题及图标抓取调试与失败原因 |

Sani 不记录单次跳转流水日志。如需访问日志，请在前置反向代理层开启。

## 健康检查

- `GET /healthz`：返回 HTTP `200` 与纯文本 `ok`，无需鉴权，适用于各类负载均衡和存活探针。
- `sani healthcheck`：在宿主机直接请求 `/healthz`，检测成功返回状态码 0，被内置作为 Docker 镜像的 `HEALTHCHECK`。

## 进程停止与退出机制

接收到 `SIGTERM` 或 `SIGINT` 信号后，Sani 立即停止接收新连接；随后提供最多 10 秒等待在途请求处理完毕，超时强制切断；接着取消并等待后台任务与残留处理器（上限 10 秒）；最后预留 5 秒尝试将内存中的点击数据全部刷盘。任何超时异常都会以非零状态码退出。配置模板为 systemd 与 Compose 预留了 30 秒的平滑退出时间；手动执行 `docker stop` 时也请加上 `--time 30`。

点击统计在内存中聚合，通常每 2 秒尝试异步刷盘。若遭遇磁盘爆满、锁争用或写入持续失败，积压周期会被拉长；非正常强制退出可能导致未落盘的点击全部丢失。SQLite 运行于 WAL 模式并启用 `synchronous=NORMAL`：能够保障文件结构一致性，但在突发断电时最近已提交的事务依然可能丢失。因此 2 秒仅为正常调度周期，并非持久性保证上限。

SQLite 单次等待外部写锁的超时上限为 1 秒；Go 上下文取消无法直接中断驱动内部的忙轮询。生产运维中应重点监控 `flush clicks` 与 `final click flush` 日志，排查磁盘容量、IOPS 及并发写入冲突。`/healthz` 仅代表进程活跃度，不能代表磁盘仍处于可写状态。

## 常见问题排查

**短链接生成的前缀域名不符合预期。**  
显式配置环境变量 [`SANI_BASE_URL`](../reference/configuration#sani-base-url)，或在管理后台设置中指定短链接域名。

**连续登录失败几次后触发限流锁定，且所有访客都被同时锁住。**  
Sani 置于反向代理之后但未配置 `SANI_TRUST_PROXY=true`，导致所有请求的客户端 IP 均被识别为反代机器的内网 IP。开启配置并重启即可。

**新建链接后标题和网站图标始终无法抓取。**  
可能原因包括：服务器无公网出站权限、目标站点封禁爬虫、或目标域名解析到了内网私有地址（Sani 安全机制严格禁止内网访问）。若需通过代理访问外部网络，请设置 `HTTPS_PROXY`。调高日志级别至 `SANI_LOG_LEVEL=debug` 可查看具体的请求阻断原因。

**统计点击数明显低于预期。**  
爬虫、社交预览、浏览器预渲染以及管理员在管理后台中的自身点击均不计入。此外，未设有效期或访问上限的永久跳转（301/308）允许浏览器缓存一天，后续请求不再经过服务端统计。详见[统计口径](./statistics)与 [CDN 缓存配置](./deploy#cdn-cache)。

**“文件”标签页提示需要单独的文件域名。**  
参考[部署指南](./deploy#files-domain)绑定独立文件域名并配置 `SANI_FILES_URL`。

**上传未超限制的文件时报错提示文件过大。**  
请求体在前置反向代理层被直接拦截。需在 nginx 中增加 `client_max_body_size` 或调高对应代理服务的限制。

**访问管理界面提示 “The admin app is not part of this build”。**  
直接使用原生 `go build` 构建所致，缺少内嵌前端静态资源。请使用 `make build` 编译完整产物。

资源 API 删除会立即从 SQLite 永久移除记录；字节仍由原有十分钟文件回收周期与文件年龄阈值异步清理。管理 API 的删除继续保留一小时恢复窗口。
