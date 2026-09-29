# 部署

<p class="lead">Sani 本身是一个普通的 HTTP 服务。正式部署时，还需要在它前面放一个负责 HTTPS 的反向代理。下面的生成器会按照你的域名，改好仓库里现成的配置文件。</p>

## 生成配置

<ConfigBuilder />

生成器修改的是仓库里的 `compose.yaml`、`deploy/sani.service`、`deploy/Caddyfile` 和 `deploy/nginx.conf`，高亮的行填的是你的输入。每次构建文档时，都会检查这些行在仓库的文件里是否还在，所以生成结果和仓库不会脱节。

## 用 Docker Compose

`compose.yaml` 里值得了解的几点：

- **只监听本机**：端口映射为 `127.0.0.1:8080:8080`，外面的访问都要经过反向代理。
- **数据在卷里**：数据库保存在 `sani-data` 卷中，挂载到容器里的 `/data`。删除或重建容器不会丢数据。
- **镜像很小**：镜像基于 `scratch`，里面只有 `sani` 程序和 CA 证书，以 65532 号非特权用户运行，没有 shell。要在容器里执行命令，直接运行 `/sani`，比如 `docker exec -it sani /sani passwd`。
- **自带健康检查**：镜像定义了 `HEALTHCHECK`，`docker ps` 里能看到 `healthy`。

目前还没有发布预构建的镜像，`docker compose up -d` 会在本机构建。以后升级也是在仓库目录里：

```sh
git pull
docker compose up -d --build
```

## 用 systemd

不用 Docker 时，可以把二进制文件交给 systemd 管理。先得到二进制文件：

::: code-group

```sh [从源码构建]
make install build        # 需要 Go、Node 和 pnpm，产物为 bin/sani
scp bin/sani server:/tmp/sani
ssh server sudo install -m 755 /tmp/sani /usr/local/bin/sani
```

```sh [从镜像中取出]
docker build -t sani .
docker create --name sani-bin sani
docker cp sani-bin:/sani ./sani && docker rm sani-bin
```

:::

二进制文件是静态链接的，不依赖服务器上的任何库。构建机和服务器的系统或架构不同时，先 `make install web`，再用 `GOOS=linux GOARCH=arm64 make binary` 这样的方式交叉编译。

然后把生成的 `sani.service` 保存到 `/etc/systemd/system/`，启用它：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now sani
journalctl -u sani -f        # 日志里有首次设置用的设置码
```

示例的单元文件已经做好了这些事：

- **不用手动建用户**：`DynamicUser=yes` 让 systemd 临时分配一个系统用户来运行 Sani。
- **数据目录固定**：`StateDirectory=sani`，数据库保存在 `/var/lib/sani`。
- **只监听本机，并且在沙箱里运行**：监听 `127.0.0.1:8080`，系统目录只读，不能提权，只能使用网络和本地套接字。

## 反向代理 {#proxy}

Sani 不处理 TLS，Caddy、nginx 或者其他反向代理都可以。要求只有三条：

1. 把请求转发到 `127.0.0.1:8080`；
2. 设置 `X-Forwarded-For`、`X-Forwarded-Proto` 和 `X-Forwarded-Host` 请求头；
3. Sani 这边设置 [`SANI_TRUST_PROXY=true`](../reference/configuration#sani-trust-proxy)，否则这些请求头会被忽略。

### Caddy

Caddy 会自动申请和续期证书，也会自动设置上面这些请求头，所以配置只有三行：

::: code-group

<<< @/../deploy/Caddyfile{txt} [deploy/Caddyfile]

:::

### nginx

nginx 需要你自己准备证书，比如用 certbot 申请。示例里的证书路径是 Let’s Encrypt 的默认位置，第二个 `server` 块把 HTTP 请求跳转到 HTTPS：

::: code-group

<<< @/../deploy/nginx.conf{nginx} [deploy/nginx.conf]

:::

### 其他代理和 CDN

Traefik、Cloudflare Tunnel 这类方案也一样，满足上面三条要求就行。

如果最外层还有一个 CDN，要注意客户端地址：Sani 取的是 `X-Forwarded-For` 的**最后一项**，也就是离它最近的那层代理看到的地址。这时需要让这层代理先还原真实的访问者地址，比如 nginx 的 `real_ip` 模块。否则，经过同一个 CDN 节点的所有人会被当成同一个客户端来做登录限流。客户端地址只用于登录限流和日志，跳转和统计都不用它。

## 域名 {#domain}

短链接使用的地址按这个顺序确定：

1. 环境变量 [`SANI_BASE_URL`](../reference/configuration#sani-base-url)；
2. 设置页里填写的“短链接域名”；
3. 你打开管理界面时的地址。开启 `SANI_TRUST_PROXY` 后，取反向代理传来的 `X-Forwarded-Host` 和 `X-Forwarded-Proto`。

正式部署时建议设置 `SANI_BASE_URL`。这样短链接的地址不会因为你从哪里打开管理界面而改变，启动日志里的设置码也会附带一个可以直接打开的链接。

有人直接访问裸域名 `https://s.example.com/` 时，默认会进入管理界面的登录页。想让它跳到你的主页，设置 [`SANI_ROOT_REDIRECT`](../reference/configuration#sani-root-redirect)。

## 首次设置密码 {#first-password}

有两种方式：

- **用设置码（推荐）**：只要还没有设置密码，Sani 每次启动都会生成一个新的设置码写进日志。设置了 `SANI_BASE_URL` 时，同一行日志里还有一个已经带上设置码的链接，比如 `https://s.example.com/admin/#setup=k7m2-p9x4-hq3d`，打开就能直接设置密码。设置码放在 `#` 后面，浏览器不会把它发给服务器，所以它不会出现在任何访问日志里。
- **用 `SANI_PASSWORD`**：适合自动化部署。密码以环境变量为准：每次启动时，如果它和数据库里的密码不一致，就会替换掉，并让所有设备退出登录；设置页里也不能再修改密码。

## 升级与回退 {#upgrade}

升级时，Sani 会在启动时自动升级数据库结构。旧版本的程序打不开新版本升级过的数据库，会直接报错退出，而不是冒险读写：

```
sani: database schema version 2 is newer than this build supports (1)
```

所以升级前先[备份](./operations#backup)。想回退到旧版本，就用升级前的备份。
