# 快速开始

<p class="lead">只需数分钟即可在本地启动并体验 Sani。准备正式上线时，请参阅“部署”文档。</p>

## 启动 Sani

::: code-group

```sh [Docker]
mkdir -p ~/sani && cd ~/sani
sudo install -d -m 750 -o 65532 -g 65532 ./sani-data
docker run -d --name sani -p 127.0.0.1:8080:8080 \
  --mount "type=bind,source=$(pwd)/sani-data,target=/data" ghcr.io/dejavumoe/sani:v0.9.5
```

```sh [二进制文件]
curl -fsSL https://github.com/DejavuMoe/sani/releases/download/v0.9.5/sani-linux-amd64.tar.gz | tar -xz sani
SANI_LISTEN=127.0.0.1:8080 ./sani     # 数据保存在 ./data 目录
```

```sh [从源码构建]
git clone https://github.com/DejavuMoe/sani && cd sani
make install build                      # 需 Go 1.27+、Node 24 和 pnpm
SANI_LISTEN=127.0.0.1:8080 ./bin/sani   # 数据保存在 ./data 目录
```

:::

Docker 数据保存在 `~/sani/sani-data`，启动前必须运行上面的权限初始化命令，否则容器用户 `65532:65532` 无法写入数据库；已有 root 目录请按[数据目录权限](./deploy#data-permissions)修复。

其他平台架构的预编译文件请见[部署](./deploy#binaries)。仓库中的 `compose.yaml` 面向生产部署（已预设域名与反代）；本地体验直接使用 `docker run` 更快捷。

## 设置管理员密码

访问 `http://127.0.0.1:8080/admin/`。初次使用需设定管理员密码，并填入启动时输出至日志的**设置码**：

```sh
docker logs sani 2>&1 | grep setup_code
```

直接运行二进制时，设置码会输出在终端控制台中，格式如下：

```log
time=2026-09-29T14:03:12.418+08:00 level=WARN msg="no admin password yet: open /admin/ and enter this setup code, or set SANI_PASSWORD" setup_code=k7m2-p9x4-hq3d
```

<Screenshot name="setup" alt="首次设置页面：先填写设置码，再输入两次新密码。" />

::: tip 为什么需要设置码
未设密码的新建实例容易被抢先初始化。设置码仅输出在服务日志中，确保只有具备宿主机权限的管理员可完成初始化。若需跳过此步骤，可通过环境变量 [`SANI_PASSWORD`](../reference/configuration#sani-password) 预先指定密码。
:::

## 缩短第一条链接

1. 复制任意长链接。
2. 切回 Sani 界面，直接按 <kbd>Ctrl</kbd> <kbd>V</kbd>（Mac 为 <kbd>⌘</kbd> <kbd>V</kbd>），无需聚焦输入框。
3. 按 <kbd>回车</kbd>。

短链接生成后会自动复制到剪贴板，并置顶显示在列表中。数秒后，后台会自动补全网页标题与图标。

本地试用时短链接格式如 `http://127.0.0.1:8080/k7m2p`：未配置 [`SANI_BASE_URL`](../reference/configuration#sani-base-url) 时，将默认采用访问管理后台时的地址。

## 查看统计

点击列表条目，或使用键盘 <kbd>J</kbd> / <kbd>K</kbd> 选中后按 <kbd>回车</kbd>，可查看每日点击、来源域名与二维码，并支持编辑、停用或删除链接。

<Screenshot name="detail" alt="链接详情：每日点击柱状图、来源网站排行和二维码，旁边是编辑、停用和删除等操作。" />

管理后台中点击链接不会计入统计，自测不污染数据。如需验证计数，可在无痕窗口或外部浏览器中打开短链接。

## 下一步

- [部署](./deploy)：生产服务器部署、域名解析与 HTTPS 配置。
- [日常使用](./usage)：快捷键、书签脚本及移动端快捷分享。
- [HTTP API](../reference/api)：通过接口自动化创建与管理链接。
