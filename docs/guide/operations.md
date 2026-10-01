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

### 分享的文件 {#backup-files}

文本保存在数据库里，但[分享的文件](./usage#shares)放在数据库旁边的 `files/` 目录里，`sani backup` 也会提醒你这一点。请在备份数据库**之后**复制这个目录：文件上传后就不会再变，所以之后复制的目录里，一定有数据库提到的每一个文件。

::: code-group

```sh [Docker]
docker run --rm --volumes-from sani -v "$PWD":/backup alpine \
  tar -czf /backup/sani-files-$(date +%F).tar.gz -C /data files
```

```sh [systemd]
sudo tar -czf /root/sani-files-$(date +%F).tar.gz -C /var/lib/sani files
```

:::

文件很多时，每次用 `rsync` 同步到同一个位置，只会复制新增的文件。链接删除后大约一小时，它的文件会从 `files/` 里自动删除。

## 恢复

先停止 Sani，用备份替换 `sani.db`，同时删除旁边的 `sani.db-wal` 和 `sani.db-shm`（如果有），再启动。

::: code-group

```sh [Docker]
docker compose stop
docker run --rm --volumes-from sani -v "$PWD":/backup alpine sh -c \
  'cp /backup/sani-2026-09-29.db /data/sani.db && rm -f /data/sani.db-wal /data/sani.db-shm && chown 65532:65532 /data/sani.db'
docker compose start
```

```sh [systemd]
sudo systemctl stop sani
sudo cp sani-2026-09-29.db /var/lib/sani/sani.db
sudo rm -f /var/lib/sani/sani.db-wal /var/lib/sani/sani.db-shm
sudo chown --reference=/var/lib/sani /var/lib/sani/sani.db
sudo systemctl start sani
```

:::

镜像里没有 shell，所以 Docker 下借一个临时的 `alpine` 容器来复制文件，并把文件的所有者改成 Sani 运行时的用户。分享的文件也要恢复时，在同一步里把压缩包解到数据目录，比如 `tar -xzf /backup/sani-files-2026-09-29.tar.gz -C /data && chown -R 65532:65532 /data/files`。恢复后的数据库不认识的文件会被自动清理。

迁移到另一台服务器也是同样的步骤：在旧服务器上备份，在新服务器上恢复，最后把 DNS 指过去。

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

收到 `SIGTERM` 或 `SIGINT` 时，Sani 不再接受新请求，最多等 10 秒让进行中的请求完成，再把内存里还没写入的点击写进数据库，然后退出。`docker stop` 和 `systemctl stop` 发送的都是 `SIGTERM`。

点击每 2 秒写入一次。如果进程被强制杀掉或者机器断电，最多丢失最后这 2 秒里的点击。

## 常见问题

**短链接的域名不对。** 设置 [`SANI_BASE_URL`](../reference/configuration#sani-base-url)，或者在设置页里填写短链接域名。

**登录失败几次后就被锁住，而且所有人一起被锁。** Sani 前面有反向代理，但没有设置 `SANI_TRUST_PROXY=true`，所以所有请求看起来都来自代理的地址。设置后重启即可。

**标题和图标一直获取不到。** 可能是服务器访问不了外网，目标网站拒绝了抓取，或者目标解析到了内网地址（Sani 不会访问内网）。服务器需要通过代理访问外网时，设置 `HTTPS_PROXY`。`SANI_LOG_LEVEL=debug` 能看到每次失败的原因。

**点击数比预想的少。** 爬虫、链接预览和你自己在管理界面里的点击都不计入。永久跳转（301）会被浏览器缓存，同一个浏览器之后的访问不再经过 Sani。详见[统计口径](./statistics)。

**“文件”标签页提示分享文件需要一个单独的域名。** 按[文件域名](./deploy#files-domain)的步骤配置好，并设置 `SANI_FILES_URL`。

**文件没超过上限，上传却提示太大。** 反向代理在 Sani 收到之前就拒绝了请求体：调大 nginx 的 `client_max_body_size`，或者你所用代理的对应设置。

**打开管理界面，只看到 “The admin app is not part of this build”。** 这个二进制文件是直接用 `go build` 构建的，没有先构建前端。用 `make build` 重新构建。
