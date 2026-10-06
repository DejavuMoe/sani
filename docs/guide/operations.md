# 运维

<p class="lead">Sani 的全部数据都在一个 SQLite 文件里，外加一个存放分享文件的目录，日常要做的事情不多：定期备份，偶尔升级，忘记密码时重设。</p>

## 备份 {#backup}

`sani backup` 会生成一份一致的数据库副本，服务不用停。它用的是 SQLite 的 `VACUUM INTO`，得到的副本同时也整理过，体积更小。

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

- 文件名写成 `-` 时，副本输出到标准输出，适合容器（`docker exec` 不要加 `-t`，否则输出会被终端改写）。
- 目标文件已经存在时会拒绝覆盖。
- 备份里有密码的哈希和所有链接的统计，请像对待数据库本身一样保管。

用 cron 每天备份一次，保留最近 14 份：

```sh
# crontab -e
15 4 * * * docker exec sani /sani backup - > /srv/backup/sani-$(date +\%F).db && find /srv/backup -name 'sani-*.db' -mtime +14 -delete
```

只想要一份可以导入别处的链接清单，用设置 → 数据 → 导出（见[导入与导出](./import-export)）。导出文件不包含每日统计、来源、令牌、文本和文件，不能代替备份。

### 数据库与文件一起备份 {#backup-files}

文本保存在数据库里，分享文件在 `files/` 中。**完整备份必须先停止所有 Sani 实例和其他数据库写入者，再复制整个数据目录。** 单独的 `sani backup` 只包含已经提交的数据库数据，不包含内存中的点击或文件字节。

即使上传后文件不会修改，在线清理仍会删除已取消分享的文件。先在线备份数据库、稍后再复制 `files/`，不能保证数据库引用的文件仍然存在。短码被重新占用时，旧文件也可能提前成为待清理对象。

下面的命令先确认服务正常退出，再复制数据库、可能存在的 WAL 和文件。复制失败时保持停机，处理错误后再启动；不要把失败或强制退出当作最后一批点击已保存的证明。

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
将这个目录作为一套备份保存，并记录 Sani 版本、时间和配置。数据库及配置可能含有敏感数据，应限制访问；复制到另一台机器后校验文件大小和 SHA-256。需要在线的完整备份时，应采用能对数据库与文件目录同时取快照的存储方案，并单独验证恢复，不要按复制先后顺序推断一致性。

## 恢复

恢复前先保留当前数据，停止全部写入者，再选择对应方式：

1. **完整目录备份**：恢复到新的空目录或空数据卷，保持同一份备份中的 `sani.db`、可能存在的 `sani.db-wal`/`sani.db-shm` 和 `files/` 配套；不要混入原运行目录的文件。把 `SANI_DATA_DIR` 或 Compose 卷改为新位置，并恢复所有者权限（镜像用户为 `65532:65532`）。
2. **`sani backup` 的数据库副本**：恢复到空目录中的 `sani.db`，不携带旧实例的 WAL/SHM。只分享网址和文本时就已完整；有文件分享时，还需要在同一次停机期间取得的 `files/`。只有在线数据库副本时，无法保证旧文件仍可下载。

先在隔离的本地实例上检查 `/healthz`、登录、网址跳转、文本正文、文件下载及 SHA-256，再切换正式实例或 DNS。升级后回退需要升级前的整套备份；不要用旧程序强行打开已迁移的数据库。仓库的 `go test ./cmd/sani -run TestStoppedBackup` 会演练停机、刷盘、数据库副本、文件复制、恢复和哈希校验。

## 升级 {#upgrade}

先[备份](#backup)，再换上新版本：

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

每个版本改了什么、升级时要注意什么，写在[更新日志](../project/changelog)里。数据库结构会在启动时自动升级，旧版本的程序打不开升级过的数据库，所以回退只能用升级前的备份。

## 重设密码

忘记密码时，用 `sani passwd` 设置新密码。它会让所有设备退出登录：

::: code-group

```sh [Docker]
docker exec -it sani /sani passwd
```

```sh [systemd]
sudo SANI_DATA_DIR=/var/lib/sani sani passwd
```

:::

也可以通过管道传入新密码，比如 `echo 'a-new-password' | docker exec -i sani /sani passwd`。

如果设置了 `SANI_PASSWORD`，下次启动时环境变量里的密码会再次生效，这时应该直接修改环境变量。

API 令牌不受修改密码的影响。怀疑令牌泄露时，到设置 → API 令牌里撤销它。

## 日志 {#logs}

日志输出到标准错误，Docker 下用 `docker logs sani` 查看，systemd 下用 `journalctl -u sani`。格式和级别由 [`SANI_LOG_FORMAT`](../reference/configuration#sani-log-format) 和 [`SANI_LOG_LEVEL`](../reference/configuration#sani-log-level) 控制。

| 级别 | 会记录 |
|---|---|
| `info` | 启动（监听地址、数据目录、时区、版本）、关闭、设置和修改密码、导入 |
| `warn` | 首次设置用的设置码，登录失败和设置码错误（带客户端地址） |
| `error` | 处理请求时出错，写入点击、清理数据等后台任务出错 |
| `debug` | 标题和图标抓取失败的原因 |

Sani 不记录访问日志，跳转请求不会出现在日志里。需要访问日志的话，用反向代理的。

## 健康检查

- `GET /healthz` 返回 `200` 和 `ok`，不需要登录，适合外部监控。
- `sani healthcheck` 在本机请求 `/healthz`，成功时退出码为 0。Docker 镜像的 `HEALTHCHECK` 用的就是它。

## 停止与重启

收到 `SIGTERM` 或 `SIGINT` 时，Sani 先停止接受请求，给进行中的请求 10 秒，超时后关闭连接；随后取消并等待后台任务和剩余处理器（最多 10 秒），最后为点击刷盘再留 5 秒。失败会以非零退出码报告。Compose 和 systemd 示例留出 30 秒停止时间。`docker stop` 手动执行时也请加 `--time 30`。

点击通常每 2 秒尝试写入。磁盘满、锁等待或持续写入失败会延长积压时间，强制结束时可能丢失全部尚未写入的点击。SQLite 使用 WAL 和 `synchronous=NORMAL`：数据库保持一致，但断电时最近已经提交的事务也可能丢失。因此“最多丢失 2 秒”不是持久性保证。

SQLite 对外部写锁的单次等待上限为 1 秒；Go 上下文取消不能立即打断驱动内部的忙等待。请关注 `flush clicks` 和 `final click flush` 错误，排查磁盘容量、权限及其他数据库写入者。`/healthz` 是进程存活检查，不能证明磁盘可写。

## 常见问题

**短链接的域名不对。** 设置 [`SANI_BASE_URL`](../reference/configuration#sani-base-url)，或者在设置页里填写短链接域名。

**登录失败几次后就被锁住，而且所有人一起被锁。** Sani 前面有反向代理，但没有设置 `SANI_TRUST_PROXY=true`，所以所有请求看起来都来自代理的地址。设置后重启即可。

**标题和图标一直获取不到。** 可能是服务器访问不了外网，目标网站拒绝了抓取，或者目标解析到了内网地址（Sani 不会访问内网）。服务器需要通过代理访问外网时，设置 `HTTPS_PROXY`。`SANI_LOG_LEVEL=debug` 能看到每次失败的原因。

**点击数比预想的少。** 爬虫、链接预览和你自己在管理界面里的点击都不计入。永久跳转（301）会被浏览器缓存，同一个浏览器之后的访问不再经过 Sani。详见[统计口径](./statistics)。

**“文件”标签页提示分享文件需要一个单独的域名。** 按[文件域名](./deploy#files-domain)的步骤配置好，并设置 `SANI_FILES_URL`。

**文件没超过上限，上传却提示太大。** 反向代理在 Sani 收到之前就拒绝了请求体：调大 nginx 的 `client_max_body_size`，或者你所用代理的对应设置。

**打开管理界面，只看到 “The admin app is not part of this build”。** 这个二进制文件是直接用 `go build` 构建的，没有先构建前端。用 `make build` 重新构建。
