# 快速开始

<p class="lead">先在自己的电脑上试一试，几分钟就够了。准备放到服务器上时，再看“部署”一页。</p>

## 启动 Sani

::: code-group

```sh [Docker]
docker run -d --name sani -p 127.0.0.1:8080:8080 -v sani-data:/data ghcr.io/dejavumoe/sani
```

```sh [二进制文件]
curl -fsSL https://github.com/DejavuMoe/sani/releases/latest/download/sani-linux-amd64.tar.gz | tar -xz sani
SANI_LISTEN=127.0.0.1:8080 ./sani     # 数据保存在 ./data 目录
```

```sh [从源码构建]
git clone https://github.com/DejavuMoe/sani && cd sani
make install build                      # 需要 Go 1.27+、Node 24 和 pnpm
SANI_LISTEN=127.0.0.1:8080 ./bin/sani   # 数据保存在 ./data 目录
```

:::

其他系统和架构的二进制文件见[部署](./deploy#binaries)一页。仓库里的 `compose.yaml` 是为正式部署准备的，写好了域名和反向代理的设置；在本机试用，直接 `docker run` 更省事。

## 设置管理员密码

打开 `http://127.0.0.1:8080/admin/`，第一次访问时需要设置管理员密码。除了密码，还要填写 Sani 启动时打印在日志里的**设置码**：

```sh
docker logs sani 2>&1 | grep setup_code
```

直接运行二进制文件时，设置码就在终端的输出里。那一行大致是这样的：

```log
time=2026-09-29T14:03:12.418+08:00 level=WARN msg="no admin password yet: open /admin/ and enter this setup code, or set SANI_PASSWORD" setup_code=k7m2-p9x4-hq3d
```

<Screenshot name="setup" alt="首次设置页面：先填写设置码，再输入两次新密码。" />

::: tip 为什么需要设置码
一个刚部署好、还没有密码的实例，谁先打开谁就能设置密码。设置码只出现在服务器日志里，所以只有能看到日志的人才能完成首次设置。如果想跳过这一步，可以用 [`SANI_PASSWORD`](../reference/configuration#sani-password) 事先指定密码。
:::

## 缩短第一条链接

1. 在浏览器里复制任意一个长链接。
2. 回到 Sani，直接按 <kbd>Ctrl</kbd> <kbd>V</kbd>（Mac 上是 <kbd>⌘</kbd> <kbd>V</kbd>），不需要先点输入框。
3. 按 <kbd>回车</kbd>。

短链接已经复制到剪贴板，列表最上面多了一行。过几秒，网页标题和网站图标也会补上。

在本机试用时，短链接形如 `http://127.0.0.1:8080/k7m2p`：没有设置 [`SANI_BASE_URL`](../reference/configuration#sani-base-url) 时，Sani 使用你访问管理界面时的地址。

## 看看统计

点开列表中的一行，或者用 <kbd>J</kbd> <kbd>K</kbd> 选中后按 <kbd>回车</kbd>，就能看到每日点击、来源网站和二维码，也可以编辑、停用或删除这条链接。

<Screenshot name="detail" alt="链接详情：每日点击柱状图、来源网站排行和二维码，旁边是编辑、停用和删除等操作。" />

从管理界面里点开的短链接不算点击，你自己测试不会影响数字。想看计数变化，可以把短链接粘贴到另一个浏览器的地址栏里打开。

## 下一步

- [部署](./deploy)：放到服务器上，配好域名和 HTTPS。
- [日常使用](./usage)：快捷键、书签小工具、手机上的分享菜单。
- [HTTP API](../reference/api)：在脚本里创建和管理链接。
