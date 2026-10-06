# 配置项

<p class="lead">Sani 遵循现代云原生原则，所有配置均通过环境变量传递，不依赖配置文件。空值视作未设置。启动时会统一校验所有变量，若有异常将一次性列出并中断退出。</p>

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
| [`SANI_SLUG_LENGTH`](#sani-slug-length) | `5` | 自动生成的短码长度 |
| [`SANI_FETCH_META`](#sani-fetch-meta) | `true` | 是否自动获取网页标题和图标 |
| [`SANI_FORWARD_QUERY`](#sani-forward-query) | `true` | 是否把查询参数带到目标网址 |
| [`SANI_CACHE_SIZE`](#sani-cache-size) | `100000` | 内存中缓存的跳转目标数量 |
| [`SANI_FILES_URL`](#sani-files-url) | — | 提供文件下载和原始文本的域名 |
| [`SANI_MAX_FILE_MB`](#sani-max-file-mb) | `64` | 单个文件的大小上限（MB） |
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

无默认值。固定管理员密码（最小长度 8 个字符）。配置后：

- 每次启动时若与库内密码不一致，自动覆写库中哈希并注销全部活跃会话；
- 管理后台将禁用密码修改面板；
- 运行 `sani passwd` 重设的密码将在下次冷启动时被环境变量重新覆盖。

适合声明式或无状态自动化部署。日常使用建议通过设置码交互式初始化，避免密码明文留在环境参数中。

### `SANI_SETUP_CODE`

无默认值。首次初始化管理员密码所需的设置码。

若未显式指定，在无密码状态下每次启动将动态生成形如 `k7m2-p9x4-hq3d` 的随机设置码并打印在标准错误日志中（忽略日志级别过滤）。录入时不区分大小写且忽略空格及中划线。密码初次设定成功后该凭证即刻失效。可用于自动化部署时提前约定初始化凭证。

## 链接控制

### `SANI_SLUG_LENGTH`

默认 `5`（取值范围 3–32）。自动生成随机短码的字符长度。

短码采用安全无歧义字符集 `23456789abcdefghjkmnpqrstuvwxyz`（31 个字符）。5 位长度具备约 2,860 万种排列组合。修改该项不影响已有短链接；当存储量上升且随机生成碰撞频次升高时，系统会自动在此基础上扩充一位。

### `SANI_FETCH_META`

默认 `true`。开启后，新建短链接时后台异步抓取目标页面的标题与 Favicon 图标。关闭后新链接不自动解析（列表展示目标域名）。在详情页手动点击“重新获取标题”仍可按需触发单次抓取。

抓取器内置严格的私网过滤，禁止访问内部网络（详见[安全机制](../internals/security#fetching)）。若服务器需代理访问公网，可配置标准 `HTTPS_PROXY` 与 `HTTP_PROXY`。

### `SANI_FORWARD_QUERY`

默认 `true`。将访客请求短链接时携带的查询参数完整透传并附加至目标 URL：

```
https://s.example.com/gh?utm_source=weekly
→ https://github.com/DejavuMoe/sani?utm_source=weekly
```

若目标本身包含查询参数，将自动使用 `&` 拼接；锚点 `#` 片段将始终被规范置于 URL 尾部。

### `SANI_CACHE_SIZE`

默认 `100000`（取值范围 64–100,000,000）。内存中缓存活跃短链接的最大数量。此外，系统还会自动缓存最多该值 1/4 容量的“未命中短码”，杜绝恶意枚举穿透打崩底层数据库。

缓存满后采用随机置换策略淘汰。当链接总规模处于该限制以内时，所有访问过的条目均常驻内存。

## 文本与文件分享

### `SANI_FILES_URL`

无默认值。托管文件下载与原始文本流的专用域名（如 `https://f.example.com`）。仅支持协议与域名（可带端口），且**必须与短链接主域名为主机名完全隔离的不同域名**（仅改端口无效，因浏览器跨端口共享 Cookie）。

未设置时仍支持文本在线分享（在 `/p/` 页面阅读与一键复制），但禁用二进制文件上传，亦不提供“原始文本”直链。

该域名仍由当前单一 Sani 进程提供服务，系统基于 `Host` 头（开启 [`SANI_TRUST_PROXY`](#sani-trust-proxy) 时为 `X-Forwarded-Host`）自动隔离路由。文件域名只响应分享内容与全量屏蔽爬虫的 `robots.txt`，其他路径默认 404。设计背景详见[安全机制](../internals/security#shares)。

### `SANI_MAX_FILE_MB`

默认 `64`（取值范围 1–4096）。允许上传的单文件大小阈值（单位 MB，1 MB = 1,048,576 字节）。超限请求将被立即拒绝并中断接收。

前置反代（如 nginx）常有默认体积上限，需配套调大（详见[部署指南](../guide/deploy#files-domain)）。纯文本分享上限固定为 1 MB，不受此项约束。

## 运行日志

### `SANI_LOG_LEVEL`

默认 `info`。可选 `debug`、`info`、`warn`（或 `warning`）及 `error`。排查标题与图标解析问题可临时调为 `debug`。各级别输出定义详见[运维日志](../guide/operations#logs)。

### `SANI_LOG_FORMAT`

默认 `text`。`text` 为便于人工查阅的 `key=value` 文本格式；`json` 每行输出结构化 JSON，适合云原生日志采集组件。所有日志统一打向标准错误输出。

## 通用系统变量

### `TZ`

默认继承操作系统时区。自然日指标统计与“今日”判定均依此时区计算。程序静态内置完整时区数据库，在精简 `scratch` 容器中配置 `TZ=Asia/Shanghai` 亦可原生解析。Docker 镜像未显式指定时默认采用 UTC。

### `HTTPS_PROXY` 与 `HTTP_PROXY`

用于拉取网页元数据与 Favicon 时的出站代理设置，支持标准的 `NO_PROXY` 旁路规则。代理地址本身允许设在私网（如宿主机本地代理通道）；目标网址仍必须遵循公网安全校验。

## 配置错误拦截

Sani 在启动初始阶段执行全面的配置合规性扫描。若检测到非法配置，会集中列出全部异常并安全退出：

```
sani: invalid configuration:
  SANI_SLUG_LENGTH: expected a number from 3 to 32, got "2"
  SANI_LOG_FORMAT: expected text or json
```
