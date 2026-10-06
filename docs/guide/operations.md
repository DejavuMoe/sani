# 运维

<p class="lead">Sani 的数据包含单个 SQLite 文件与可选的分享文件目录。日常运维十分轻量：定期备份、版本升级与管理员密码重置。</p>

## 在线备份 {#backup}

运行 `sani backup` 可在线生成一致的数据库快照，无需停机。该命令基于 SQLite 的 `VACUUM INTO`，备份同时会对数据页进行整理压缩：

::: code-group

```sh [Docker]
docker exec sani /sani backup - > sani-$(date +%F).db
```

```sh [systemd]
sudo SANI_DATA_DIR=/var/lib/sani sani backup /root/sani-$(date +%F).db
```

```sh [直接运行]
sani backup ~/backups/sani-$(date +%F).db
```

:::

- 指定文件名为 `-` 时直接流式输出至标准输出，便于容器备份（注意 `docker exec` 不要添加 `-t`，避免终端控制符损坏二进制文件）。
- 若目标文件已存在，将自动终止以防覆盖。
- 备份包含密码哈希与全部统计明细，应严格限制访问权限。

通过 cron 配置每日备份并保留最近 14 天副本：

```sh
# crontab -e
15 4 * * * docker exec sani /sani backup - > /srv/backup/sani-$(date +\%F).db && find /srv/backup -name 'sani-*.db' -mtime +14 -delete
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

在切换生产流量或 DNS 前，先在本地隔离实例中验证 `/healthz`、登录鉴权、链接跳转、文本展示、文件下载及 SHA-256 校验。升级后的版本回退依赖升级前的完整备份，禁止用旧版二进制直接运行新版迁移后的数据库。代码仓库中的 `go test ./cmd/sani -run TestStoppedBackup` 已涵盖完整的停机刷盘、备份、复制与恢复校验流程。

## 版本升级 {#upgrade}

完成[数据备份](#backup)后执行更新：

::: code-group

```sh [Docker]
docker compose pull
docker compose up -d
```

```sh [systemd]
curl -fsSL https://github.com/DejavuMoe/sani/releases/latest/download/sani-linux-amd64.tar.gz | tar -xz sani
sudo install -m 755 sani /usr/local/bin/sani
sudo systemctl restart sani
```

:::

更新要点与升级指引请参考[更新日志](../project/changelog)。数据库结构在启动时会自动递增迁移；旧版二进制无法打开迁移后的新数据库，如需回滚必须依靠升级前的备份。

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
爬虫、社交预览、浏览器预渲染以及管理员在管理后台中的自身点击均不计入。此外，若使用永久跳转（301），浏览器本地会缓存一天，后续请求不再经过服务端统计。详见[统计口径](./statistics)。

**“文件”标签页提示需要单独的文件域名。**  
参考[部署指南](./deploy#files-domain)绑定独立文件域名并配置 `SANI_FILES_URL`。

**上传未超限制的文件时报错提示文件过大。**  
请求体在前置反向代理层被直接拦截。需在 nginx 中增加 `client_max_body_size` 或调高对应代理服务的限制。

**访问管理界面提示 “The admin app is not part of this build”。**  
直接使用原生 `go build` 构建所致，缺少内嵌前端静态资源。请使用 `make build` 编译完整产物。
