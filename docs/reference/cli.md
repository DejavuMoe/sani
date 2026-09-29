# 命令行

<p class="lead">Sani 只有一个可执行文件，服务和维护命令都由它提供。所有命令都从同样的 SANI_* 环境变量读取配置，所以维护命令要和服务使用相同的数据目录。</p>

| 命令 | 作用 |
|---|---|
| [`sani serve`](#sani-serve) | 启动服务。不带参数运行 `sani` 也是启动服务 |
| [`sani passwd`](#sani-passwd) | 设置新的管理员密码，并让所有设备退出登录 |
| [`sani backup`](#sani-backup) | 把数据库的一致副本写入文件或标准输出 |
| [`sani healthcheck`](#sani-healthcheck) | 检查本机的服务是否正常 |
| [`sani version`](#sani-version) | 显示版本 |
| `sani help` | 显示用法说明 |

在 Docker 里，可执行文件的路径是 `/sani`，比如 `docker exec -it sani /sani passwd`。

命令成功时退出码为 0，出错时为 1，命令不存在时为 2。

## `sani serve`

启动服务。启动时依次做这些事：读取并检查配置，打开数据库并在需要时升级结构，还没有密码时在日志里写出设置码，然后开始监听。收到 `SIGTERM` 或 `SIGINT` 时，等待进行中的请求完成（最多 10 秒），写入内存中剩余的点击后退出。

## `sani passwd`

设置新的管理员密码，并让所有设备退出登录。忘记密码时用它。

在终端里运行时，会提示输入两次新密码，输入的内容不会显示。不在终端里时，从标准输入读取一行作为新密码：

```sh
echo 'a-new-password' | sani passwd
```

密码至少 8 个字符。设置了 `SANI_PASSWORD` 时，下次启动会恢复为环境变量里的密码，命令会提示这一点。`sani password` 是它的别名。

## `sani backup`

把数据库的一致副本写入指定文件，服务不用停止：

```sh
sani backup /backups/sani-2026-09-29.db
docker exec sani /sani backup - > sani-2026-09-29.db
```

- 使用 SQLite 的 `VACUUM INTO`，得到的副本是整理过的，通常比原文件小。
- 文件名为 `-` 时，副本写到标准输出。标准输出是终端时会拒绝执行，以免把二进制内容打印到屏幕上。
- 目标文件已经存在时拒绝覆盖。
- 只读取数据库，不会升级数据库结构，所以可以用任何版本的 `sani` 备份正在运行的实例。

恢复方法见[运维](../guide/operations#backup)。

## `sani healthcheck`

请求本机服务的 `/healthz`，返回 `200` 时以 0 退出，否则以 1 退出。监听地址取自 `SANI_LISTEN`；监听所有网卡时，请求 `127.0.0.1`。Docker 镜像的 `HEALTHCHECK` 用的就是这个命令，因为镜像里没有 curl。

## `sani version`

显示版本号，比如 `sani v0.1.0`。从源码构建时，版本号来自 `git describe`，没有 Git 信息时为 `dev`。`sani -v` 和 `sani --version` 效果相同。
