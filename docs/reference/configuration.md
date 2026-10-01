# 配置项

<p class="lead">Sani 的全部配置都通过环境变量设置，没有配置文件。空值等同于没有设置。启动时会检查所有变量，有问题时一次性列出来并退出。</p>

## 一览

| 变量 | 默认值 | 作用 |
|---|---|---|
| [`SANI_LISTEN`](#sani-listen) | `:8080` | 监听地址 |
| [`SANI_DATA_DIR`](#sani-data-dir) | `data` | 数据库所在的目录 |
| [`SANI_BASE_URL`](#sani-base-url) | — | 短链接使用的域名 |
| [`SANI_PASSWORD`](#sani-password) | — | 固定的管理员密码 |
| [`SANI_SETUP_CODE`](#sani-setup-code) | 随机生成 | 首次设置密码时的设置码 |
| [`SANI_ROOT_REDIRECT`](#sani-root-redirect) | — | 访问根路径时跳转到哪里 |
| [`SANI_TRUST_PROXY`](#sani-trust-proxy) | `false` | 是否信任反向代理的请求头 |
| [`SANI_SLUG_LENGTH`](#sani-slug-length) | `5` | 自动生成的短码长度 |
| [`SANI_FETCH_META`](#sani-fetch-meta) | `true` | 是否自动获取网页标题和图标 |
| [`SANI_FORWARD_QUERY`](#sani-forward-query) | `true` | 是否把查询参数带到目标网址 |
| [`SANI_CACHE_SIZE`](#sani-cache-size) | `100000` | 内存中缓存的跳转目标数量 |
| [`SANI_FILES_URL`](#sani-files-url) | — | 提供文件下载和原始文本的域名 |
| [`SANI_MAX_FILE_MB`](#sani-max-file-mb) | `64` | 单个文件的大小上限（MB） |
| [`SANI_LOG_LEVEL`](#sani-log-level) | `info` | 日志级别 |
| [`SANI_LOG_FORMAT`](#sani-log-format) | `text` | 日志格式 |
| [`TZ`](#tz) | 系统时区 | 每日统计使用的时区 |

仓库里的 `.env.example` 列出了全部变量和说明，可以复制一份作为起点。

## 服务

### `SANI_LISTEN`

默认 `:8080`。监听的地址和端口。`:8080` 表示监听所有网卡。只让同一台机器上的反向代理访问时，设为 `127.0.0.1:8080`，示例的 systemd 单元就是这样做的。Docker 镜像里保持 `:8080`，由 `compose.yaml` 把端口映射限制在本机。

### `SANI_DATA_DIR`

默认 `data`，是相对于工作目录的路径。数据库文件 `sani.db` 放在这个目录里，分享的文件放在其中的 `files` 目录，目录不存在时会自动创建。Docker 镜像里是 `/data`，systemd 示例里是 `/var/lib/sani`。

目录里还会出现 `sani.db-wal` 和 `sani.db-shm`，这是 SQLite WAL 模式的正常文件，不要单独删除它们。复制数据库请用 [`sani backup`](./cli#sani-backup)。

### `SANI_BASE_URL`

没有默认值。短链接对外的地址，只能包含协议和域名（可以带端口），不能有路径，比如 `https://s.example.com`。

不设置时，短链接的地址取设置页里填写的域名；设置页也没有填写时，取你访问管理界面时的地址。设置了这个变量，设置页里的域名就不能再修改。

设置它还有一个好处：启动日志里的设置码会附带一个可以直接打开的链接。

### `SANI_ROOT_REDIRECT`

没有默认值。有人访问根路径 `/` 时跳转到哪里，必须是完整的 `http://` 或 `https://` 地址，比如你的个人主页。不设置时，`/` 跳转到管理界面 `/admin/`。

### `SANI_TRUST_PROXY`

默认 `false`。设为 `true` 后，Sani 信任反向代理传来的这些请求头：

- `X-Forwarded-For` 的**最后一项**作为客户端地址，没有时用 `X-Real-IP`。客户端地址用于登录限流和日志。
- `X-Forwarded-Proto` 判断访问是否经过 HTTPS，决定会话 Cookie 是否带 `Secure` 标记。
- `X-Forwarded-Host` 在没有设置 `SANI_BASE_URL` 时用来生成短链接的地址。

只有在 Sani 前面确实有反向代理、并且代理会设置这些请求头时才开启。否则，任何人都可以伪造请求头来冒充别的地址，绕过登录限流。

## 账户

### `SANI_PASSWORD`

没有默认值。固定的管理员密码，至少 8 个字符。设置之后：

- 每次启动时，如果它和数据库里的密码不一致，就会替换数据库里的密码，并让所有设备退出登录；
- 设置页里不能再修改密码；
- 用 `sani passwd` 设置的密码，会在下次启动时被它覆盖。

适合自动化部署。手动部署时，更推荐用设置码完成首次设置，这样密码不会出现在配置文件和进程环境里。

### `SANI_SETUP_CODE`

没有默认值。首次设置密码时需要填写的设置码。

不设置时，只要还没有密码，Sani 每次启动都会随机生成一个设置码，形如 `k7m2-p9x4-hq3d`，并写入日志；无论日志级别设为什么，这一行都会输出。填写时不区分大小写，空格和短横线会被忽略。设置好密码之后，设置码就不再有用。

需要在自动化流程里预先知道设置码时，可以用这个变量指定。

## 链接

### `SANI_SLUG_LENGTH`

默认 `5`，可以设为 3 到 32。自动生成的短码的长度。

生成的短码只使用 `23456789abcdefghjkmnpqrstuvwxyz` 这 31 个字符，5 位大约有 2,860 万种组合。已有的链接不受这个设置影响。链接很多、随机生成开始频繁撞车时，新短码会自动加长。

### `SANI_FETCH_META`

默认 `true`。新建链接后，在后台访问目标网页，获取标题和网站图标。关闭后，新链接不会被自动抓取，列表中显示目标网站的域名。在详情里手动点击“重新获取标题”时，仍然会访问目标网页。

抓取只会访问公网地址，详见[安全](../internals/security#fetching)。服务器需要通过代理访问外网时，设置标准的 `HTTPS_PROXY` 和 `HTTP_PROXY` 变量。

### `SANI_FORWARD_QUERY`

默认 `true`。把访问者带来的查询参数拼接到目标网址上：

```
https://s.example.com/gh?utm_source=weekly
→ https://github.com/DejavuMoe/sani?utm_source=weekly
```

目标网址本身已经有查询参数时，用 `&` 连接；目标网址里的 `#` 片段保持在最后。

### `SANI_CACHE_SIZE`

默认 `100000`，可以设为 64 到 100,000,000。内存中最多缓存多少个跳转目标。另外，Sani 还会缓存最多这个数量四分之一的“不存在的短码”，这样有人扫描随机短码时，既不会反复查询数据库，也不会把真实的链接挤出缓存。

缓存满了之后随机淘汰。链接总数明显小于这个值时，访问过的链接都会留在内存里。

## 分享

### `SANI_FILES_URL`

没有默认值。文本和文件的原始内容从这个地址提供，比如 `https://f.example.com`。和 `SANI_BASE_URL` 一样，只能包含协议和域名（可以带端口），而且**必须是另一个域名**：只换端口不行，因为浏览器在同一个域名的不同端口之间共享 Cookie。

不设置时，仍然可以分享文本，访问者在 `/p/` 页面上阅读和复制；但不能上传文件，文本页面上也没有“原始文本”和“下载”按钮。

这个域名指向同一个 Sani 进程，不需要单独部署。Sani 按请求的 `Host`（开启了 [`SANI_TRUST_PROXY`](#sani-trust-proxy) 时按 `X-Forwarded-Host`）区分两个域名。文件域名只提供分享的内容和一个拒绝所有爬虫的 `robots.txt`，其他路径一律 404。为什么要单独一个域名，见[安全](../internals/security#shares)。

### `SANI_MAX_FILE_MB`

默认 `64`，可以设为 1 到 4096。单个文件的大小上限，单位是 MB（1 MB = 1,048,576 字节）。超过上限的上传会被拒绝，已经收到的部分随即删除。

反向代理通常也有自己的请求体上限，要同时调大，见[部署](../guide/deploy#files-domain)。文本的上限固定为 1 MB，不受这个变量影响。

## 日志

### `SANI_LOG_LEVEL`

默认 `info`。可以是 `debug`、`info`、`warn`（也可以写作 `warning`）或 `error`。`debug` 会记录标题和图标抓取失败的原因。每个级别记录的内容见[运维](../guide/operations#logs)。

### `SANI_LOG_FORMAT`

默认 `text`。`text` 是便于阅读的 `key=value` 格式，`json` 每行一个 JSON 对象，方便日志系统采集。日志都输出到标准错误。

## 其他环境变量

### `TZ`

默认使用系统时区。“今天”和每日统计按这个时区划分日期。程序内置了时区数据，即使在没有时区文件的 `scratch` 镜像里，`TZ=Asia/Shanghai` 也能正常工作。Docker 镜像不设置 `TZ` 时使用 UTC。

### `HTTPS_PROXY` 和 `HTTP_PROXY`

获取标题和图标时使用的代理，写法和其他程序相同，`NO_PROXY` 也会生效。代理本身可以是内网地址，比如本机的代理程序；目标网址仍然要通过公网地址检查。

## 配置有误时

Sani 启动时检查全部变量。发现问题时，一次性列出所有问题，然后退出：

```
sani: invalid configuration:
  SANI_SLUG_LENGTH: expected a number from 3 to 32, got "2"
  SANI_LOG_FORMAT: expected text or json
```
