# 配置项

<p class="lead">Sani 遵循现代云原生原则，服务器配置通过环境变量传递，创建默认值也可在后台保存。空值视作未设置。启动时会统一校验所有变量，若有异常将一次性列出并中断退出。</p>

后台修改的创建默认值保存在 SQLite 中，逐字段按“内置默认值 → 已保存设置 → 显式环境变量”取值，不另设配置文件。

## 配置一览

| 变量 | 默认值 | 作用 |
|---|---|---|
| [`SANI_LISTEN`](#sani-listen) | `:8080` | 监听地址 |
| [`SANI_DATA_DIR`](#sani-data-dir) | `data` | 数据库所在的目录 |
| [`SANI_BASE_URL`](#sani-base-url) | — | 短链接使用的域名 |
| [`SANI_PASSWORD`](#sani-password) | — | 固定的管理员密码 |
| [`SANI_SETUP_CODE`](#sani-setup-code) | 随机生成 | 首次设置密码时的设置码 |
| [`SANI_ROOT_REDIRECT`](#sani-root-redirect) | — | 访问根路径时跳转到哪里 |
| [`SANI_TRUST_PROXY`](#sani-trust-proxy) | `false` | 是否信任反向代理的请求头 |
| [`SANI_SLUG_LENGTH`](#sani-slug-length) | `5` | 自动生成的网址短码长度（3–32） |
| [`SANI_TEXT_SLUG_LENGTH`](#sani-text-slug-length) | `10` | 自动生成的文本／代码分享短码长度（3–32） |
| [`SANI_FILE_SLUG_LENGTH`](#sani-file-slug-length) | `10` | 自动生成的文件分享短码长度（3–32） |
| [`SANI_EXCLUDE_CONFUSABLE`](#sani-exclude-confusable) | `true` | 网址短码排除易混淆字符 |
| [`SANI_META_PROXY`](#sani-meta-proxy) | — | 网页信息专用 HTTP/HTTPS/SOCKS5 代理 |
| [`SANI_FETCH_META`](#sani-fetch-meta) | `true` | 是否自动获取网页标题和图标 |
| [`SANI_FORWARD_QUERY`](#sani-forward-query) | `true` | 是否把查询参数带到目标网址 |
| [`SANI_CACHE_SIZE`](#sani-cache-size) | `100000` | 内存中缓存的跳转目标数量 |
| [`SANI_FILES_URL`](#sani-files-url) | — | 提供文件下载和原始文本的域名 |
| [`SANI_MAX_FILE_MB`](#sani-max-file-mb) | `99` | 单文件默认上限（十进制 MB；显式变量保留 MiB 语义） |
| [`SANI_LOG_LEVEL`](#sani-log-level) | `info` | 日志级别 |
| [`SANI_LOG_FORMAT`](#sani-log-format) | `text` | 日志格式 |
| [`TZ`](#tz) | 系统时区 | 每日统计使用的时区 |

仓库根目录提供完整模板 `.env.example`，可直接复制使用。

## 服务网络与存储

### `SANI_LISTEN`

默认 `:8080`。绑定监听的网络地址与端口。缺省 `:8080` 监听所有网卡接口。若前置已有同机反代，推荐设置为 `127.0.0.1:8080`（如 systemd 示例）。Docker 容器内保持 `:8080`，外部网络由 `compose.yaml` 映射控制在本地。

### `SANI_DATA_DIR`

默认 `data`（相对于当前工作目录）。数据库文件 `sani.db` 与分享文件子目录 `files/` 均保存在此，路径缺失时自动创建。Docker 镜像中默认映射为 `/data`，systemd 部署建议使用 `/var/lib/sani`。

运行期间生成的 `sani.db-wal` 与 `sani.db-shm` 为 SQLite WAL 模式的核心伴生文件，禁止单独清理。数据库热备请使用 [`sani backup`](./cli#sani-backup)。

### `SANI_BASE_URL`

无默认值。短链接对外暴露的主机基础 URL，仅包含协议与域名（可带自定义端口），不得附带路径（如 `https://s.example.com`）。

若未设置，将依次尝试从后台设置项获取，或回退为访问后台时的来源地址。显式设置后，后台设置项中的短码域名将被锁定。配置该项后，启动日志输出的首次设置引导行将附带可直达的带 hash 链接。

### `SANI_ROOT_REDIRECT`

无默认值。访问站点根路径 `/` 时的重定向目标，必须是绝对 `http://` 或 `https://` 网址（如个人主页）。若留空，访问 `/` 默认引导至后台管理登录页 `/admin/`。

### `SANI_TRUST_PROXY`

默认 `false`。启用后（设为 `true`），信任前置代理透传的以下标头：

- 取 `X-Forwarded-For` 的**末位 IP** 作为访客客户端真实地址（缺失时回退取 `X-Real-IP`），用于登录频控与异常审计；
- 依据 `X-Forwarded-Proto` 判断通信是否走 HTTPS，以决定会话 Cookie 是否附加 `Secure` 标记；
- 在未指定 `SANI_BASE_URL` 时，取 `X-Forwarded-Host` 组装短链接前缀。

仅在前置确有可信反向代理且正确配置请求头时开启；直面公网时切勿开启，否则客户端可通过伪造标头绕过登录限流。

## 鉴权与安全

### `SANI_PASSWORD`

无默认值。固定管理员密码，至少 8 个 Unicode 码点、最多 1,024 个 UTF-8 字节。长度不合规时启动失败，不改变已存储的密码和会话。配置后：

- 每次启动时若与库内密码不一致，自动覆写库中哈希并注销全部活跃会话；
- 管理后台将禁用密码修改面板；
- 运行 `sani passwd` 重设的密码将在下次冷启动时被环境变量重新覆盖。

适合声明式或无状态自动化部署。日常使用建议通过设置码交互式初始化，避免密码明文留在环境参数中。

### `SANI_SETUP_CODE`

无默认值。首次初始化管理员密码所需的设置码。

若未显式指定，在无密码状态下每次启动将动态生成形如 `k7m2-p9x4-hq3d` 的随机设置码并打印在标准错误日志中（忽略日志级别过滤）。录入时不区分大小写且忽略空格及中划线。密码初次设定成功后该凭证即刻失效。可用于自动化部署时提前约定初始化凭证。

## 链接控制

### `SANI_SLUG_LENGTH`

默认 `5`（3–32 的整数）。只控制自动生成的网址短码长度，对应后台设置及 API 的 `slugLength`。未设置时可在后台保存；显式环境变量优先，并锁定该字段。

短码默认采用无歧义字符集 `23456789abcdefghjkmnpqrstuvwxyz`（31 个字符），可由 `SANI_EXCLUDE_CONFUSABLE` 调整。5 位长度具备约 2,860 万种排列组合。修改该项不影响已有短链接；当存储量上升且随机生成碰撞频次升高时，系统会自动在此基础上扩充一位。

### `SANI_TEXT_SLUG_LENGTH`

新安装默认 `10`（3–32 的整数）。控制自动生成的文本和代码分享短码长度，对应 `textSlugLength`；长度不包含 `/p/` 前缀。

### `SANI_FILE_SLUG_LENGTH`

新安装默认 `10`（3–32 的整数）。控制自动生成的文件分享短码长度，对应 `fileSlugLength`；长度不包含 `/p/` 前缀，普通上传与分片上传均使用该设置。

文本与文件的长度分别保存在 SQLite 中，重启后保留，均按“内置默认值 → 已保存设置 → 显式环境变量”取值。两个变量分别锁定自己的字段；留空不会锁定后台。分享始终使用上述无歧义字符集，不受 `SANI_EXCLUDE_CONFUSABLE` 影响。可保存低于 10 位的长度，没有隐藏的 10 位下限；后台会提示短码越短越容易被猜中。分享地址不提供访问密码，知道地址的人即可访问。

**旧实例升级**：首次升级时，缺少独立设置的分享类型按 `max(10, 旧版有效网址短码长度)` 初始化并持久化；该旧值按原有设置与环境变量优先级计算。例如原有效长度为 12，两类分享均保留 12 位；原值为 5 则保留 10 位。此后修改网址长度不再影响分享；各自的显式环境变量仍优先。三类长度设置只影响后续自动生成的短码，已有、手动指定与导入保留的短码不变。

### `SANI_EXCLUDE_CONFUSABLE`

默认 `true`，排除 `0`、`o`、`1`、`i`、`l`。`false` 使用全部小写字母和数字。只影响未来自动生成的网址短码，已有、手动与导入短码不变。文本／代码和文件分享始终排除这些字符，长度由各自的独立设置决定。显式值锁定后台相应设置。

### `SANI_META_PROXY`

无默认值。接受 `http://`、`https://`、`socks5://` 代理 URL，可带用户名与密码。设置此变量会覆盖后台保存的代理，并锁定后台的代理字段和连接测试；不设置时，可直接在后台填写主机、端口和可选认证。抓取启用且没有已保存模式时，自动选择已配置的专用代理。API 返回有效主机、端口、用户名及是否已保存密码，不返回密码。

后台保存的代理配置放在实例数据库中，密码可恢复以供连接使用，并未加密；数据库及备份应按含凭据的文件保护。连接测试只使用当前表单，不保存设置；更换协议、主机、端口或用户名时必须重新输入密码，不能把旧密码带到新的代理。

通过 CONNECT 或 SOCKS5 连接本机解析并校验的公网 IP，保留目标 Host 与 TLS SNI。失败不回退直连，不受 `NO_PROXY` 绕过。拒绝内网目标、不安全重定向，以及严格模式下的 fake-IP DNS 结果（`198.18.0.0/15`）。DNS 在本地解析，不承诺 DNS 隐私。代理端点自身可为私网地址；HTTP 代理需要支持对 HTTP 与 HTTPS 目标使用 CONNECT。

HTTPS 加密服务器到代理这一跳，普通 HTTP/SOCKS5 不加密；密码认证不等于加密。代理运营方仍能看到目标元数据。DuckDuckGo 搜索跳转不是通用网页信息中继。

### `SANI_FETCH_META`

默认 `true`。控制标题与图标抓取；`false` 同时禁用手动刷新，保留已有缓存。显式设置后，后台网页信息模式、代理字段及连接测试只读；未显式设置时可在后台开启或关闭抓取，并选择直接连接、HTTP(S) 或 SOCKS5。直接连接忽略系统代理；未更改设置的旧部署继续沿用 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`，界面说明正在使用环境代理，不会标成直连。切换模式前已开始的请求可能继续完成。

### `SANI_FORWARD_QUERY`

默认 `true`。将访客请求短链接时携带的查询参数完整透传并附加至目标 URL：

```
https://s.example.com/gh?utm_source=weekly
→ https://github.com/DejavuMoe/sani?utm_source=weekly
```

若目标本身包含查询参数，将自动使用 `&` 拼接；锚点 `#` 片段将始终被规范置于 URL 尾部。

### `SANI_CACHE_SIZE`

默认 `100000`（取值范围 64–100,000,000）。内存中缓存活跃短链接的最大数量。此外，不存在短码单独缓存，容量为 `64 × max(1, floor(SANI_CACHE_SIZE / 256))`，减少重复未命中查询；持续扫描新短码仍会访问数据库，应在入口按需要限制流量。

缓存分为 64 个分片，命中容量为 `64 × floor(SANI_CACHE_SIZE / 64)`。分片满时逐出其中一个条目（不是 LRU）；哈希分布不均可能在全局容量尚未用满时触发逐出，因此不保证容量以内的所有短链常驻。最小设置 64 时，未命中缓存也可容纳 64 条。

## 文本与文件分享

### `SANI_FILES_URL`

无默认值。提供文件下载与原始文本的地址（如 `https://f.example.com`）。仅支持协议与主机名（可带端口），不能包含路径，且 **主机名必须与主域名不同**。子域名也可以；仅改端口不被接受，因为浏览器跨端口共享 Cookie。

设置它不会改变分享页的地址：文本和文件分享页仍使用主域名的 `/p/短码`，只有下载和原始文本使用此地址。具体示例见 [部署指南](../guide/deploy#files-domain)。

未设置时仍支持短链接与文本分享（在主域名的 `/p/` 页面阅读与复制），但禁用文件上传，文本页也不提供“原始文本”或“下载”入口。

该域名仍由当前单一 Sani 进程提供服务，系统基于 `Host` 头（开启 [`SANI_TRUST_PROXY`](#sani-trust-proxy) 时为 `X-Forwarded-Host`）自动隔离路由。文件域名只响应分享内容与全量屏蔽爬虫的 `robots.txt`，其他路径默认 404。设计背景详见[安全机制](../internals/security#shares)。

### `SANI_MAX_FILE_MB`

未设置时默认 **99,000,000 字节**；后台接受 1–4096 的整数十进制 MB。为兼容旧部署，**显式环境变量**仍以 MiB 计：`99` 表示 103,809,024 字节。显式值优先并锁定后台相应字段。

后台对超过 25,000,000 字节的文件使用独立分片请求，每片最多 25,000,000 字节。完整文件仍受总上限控制，需要更大文件时先提高上限；分片不会自动提高限制。原单请求 API 保留，需匹配反代体积限制。纯文本分享仍限制为 1,048,576 字节。

## 运行日志

### `SANI_LOG_LEVEL`

默认 `info`。可选 `debug`、`info`、`warn`（或 `warning`）及 `error`。排查标题与图标解析问题可临时调为 `debug`。各级别输出定义详见[运维日志](../guide/operations#logs)。

### `SANI_LOG_FORMAT`

默认 `text`。`text` 为便于人工查阅的 `key=value` 文本格式；`json` 每行输出结构化 JSON，适合云原生日志采集组件。所有日志统一打向标准错误输出。

## 通用系统变量

### `TZ`

默认继承操作系统时区。自然日指标统计与“今日”判定均依此时区计算。程序静态内置完整时区数据库，在精简 `scratch` 容器中配置 `TZ=Asia/Shanghai` 亦可原生解析。Docker 镜像未显式指定时默认采用 UTC。

### `HTTPS_PROXY` 与 `HTTP_PROXY`

用于拉取网页元数据与 Favicon 时的出站代理设置，由标准库 `http.ProxyFromEnvironment` 处理，支持 `NO_PROXY` 旁路规则。目标仍经过 `checkHost` 校验；仅实际经代理的请求可将本机 DNS 失败交给代理处理。直连请求（包括 `NO_PROXY`）使用独立连接池，并始终执行拨号时的公网 IP 校验。代理地址本身允许位于私网；Sani 不验证代理最终连接的地址，代理必须可信，并在代理端落实 DNS 与出站访问限制，详见[抓取安全边界](../internals/security#fetching)。

## 配置错误拦截

Sani 在启动初始阶段执行全面的配置合规性扫描。若检测到非法配置，会集中列出全部异常并安全退出：

```
sani: invalid configuration:
  SANI_SLUG_LENGTH: expected a number from 3 to 32, got "2"
  SANI_LOG_FORMAT: expected text or json
```
