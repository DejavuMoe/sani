# 命令行

<p class="lead">Sani 采用单一二进制交付，主服务运行与运维管理命令集成于一体。各子命令遵循相同的 SANI_* 环境变量约定，维护命令需与主服务指定相同的数据目录。</p>

| 命令 | 作用 |
|---|---|
| [`sani serve`](#sani-serve) | 启动服务。不带参数直接运行 `sani` 亦同 |
| [`sani passwd`](#sani-passwd) | 设置新管理员密码并注销所有设备的会话 |
| [`sani backup`](#sani-backup) | 导出数据库的一致性副本至文件或标准输出 |
| [`sani healthcheck`](#sani-healthcheck) | 探测本机服务健康度状态 |
| [`sani version`](#sani-version) | 查看版本信息 |
| `sani help` | 输出命令行帮助指南 |

在 Docker 容器内部，可执行文件位于根路径 `/sani`（如 `docker exec -it sani /sani passwd`）。

命令执行状态码：成功为 0，运行异常为 1，子命令不存在为 2。

## `sani serve`

启动主服务进程。生命周期依次执行：解析并校验配置环境变量、打开 SQLite 数据库并在必要时运行迁移升级、若无密码则在日志中输出首次设置码，最后开始监听网络端口。接收到 `SIGTERM` 或 `SIGINT` 时，平滑等待在途请求（最多 10 秒），将内存中积压的统计点击刷盘后优雅退出。

## `sani passwd`

重置管理员密码，并立即使所有活跃会话失效。遗忘密码时使用。

交互式终端环境下将提示隐式录入两次新密码；非交互环境下自动从标准输入读取单行文本作为新密码：

```sh
echo 'a-new-password' | sani passwd
```

密码长度至少 8 个 Unicode 码点、最多 1,024 个 UTF-8 字节；长度不合规时拒绝操作，已有密码和会话保持不变。若当前实例配置了环境变量 `SANI_PASSWORD`，下次重启将再次被环境变量覆盖（命令会输出提示信息）。`sani password` 为其等价别名。

## `sani backup`

在线导出一致的数据库快照副本，无需中断服务：

```sh
sani backup /backups/sani-2026-09-29.db
(umask 077; set -C; docker exec sani /sani backup - > sani-2026-09-29.db)
```

- 底层使用 SQLite 原生 `VACUUM INTO`，输出的副本经过自动整理压缩，体积通常优于原始数据库。
- 目标路径设为 `-` 时直接流式输出至标准输出；若标准输出直连 TTY 终端将拒绝执行，防止乱码冲毁屏幕。
- 直接指定文件时，以 `0600` 权限创建备份（Windows 仍需配置目录 ACL），拒绝已有文件及符号链接，失败时清理未完成副本。备份目录应仅允许受信任的用户写入。
- 标准输出重定向的权限和覆盖行为由宿主 shell 决定，需像示例一样设置 `umask 077` 与 `set -C`。这些设置不会修复旧备份的权限。
- 仅执行只读读取，不触发表结构升级，支持使用任意版本的 `sani` 备份正在运行的旧版本实例。
- 仅备份已提交的数据库数据；分享文件与内存待刷盘点击不包含在内。完整灾备请停机执行[配套备份](../guide/operations#backup-files)。

数据恢复指南详见[运维文档](../guide/operations#backup)。

## `sani healthcheck`

请求当前实例的 `/healthz` 端点。响应 HTTP `200` 时以 0 退出，否则以 1 退出。监听端口解析自 `SANI_LISTEN`；当监听通配地址时默认探测 `127.0.0.1`。Docker 官方镜像内置此命令充当 `HEALTHCHECK`，容器无需额外安装 curl。

## `sani version`

输出当前构建版本（例如 `sani v0.4.0`）。从源码构建时，版本号提取自 `git describe`；无 Git 元数据时标记为 `dev`。`-v` 与 `--version` 标志效果等同。
