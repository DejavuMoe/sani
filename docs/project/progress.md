# 进度

<p class="lead">Sani 目前的版本是 v0.1.0：功能已经完整，经过了测试和压测，但还没有正式发布。这一页记录做到了哪里、接下来做什么，以及哪些事情刻意不做。页面上的核对结果和数字，都是在构建文档时从源码中得出的。</p>

## 现状 {#current}

| 部分 | 状态 | 包括 |
|---|---|---|
| 跳转与统计 | <span class="sn-status done">已完成</span> | 内存缓存、点击聚合、爬虫和预览过滤、有效期、访问上限 |
| 管理界面 | <span class="sn-status done">已完成</span> | 中英文、深浅主题、键盘操作、二维码、书签小工具、手机分享菜单 |
| HTTP API | <span class="sn-status done">已完成</span> | 全部功能都有接口，API 令牌 |
| 导入与导出 | <span class="sn-status done">已完成</span> | Sani、Shlink、Sink 和各种 CSV |
| 部署 | <span class="sn-status done">已完成</span> | 基于 `scratch` 的 Docker 镜像，systemd、Caddy 和 nginx 示例 |
| 运维 | <span class="sn-status done">已完成</span> | 在线备份、重设密码、健康检查 |
| 文档 | <span class="sn-status done">已完成</span> | 本站：中英双语，构建时与源码核对 |
| 正式发布 | <span class="sn-status planned">计划中</span> | 打版本标签，发布 amd64 和 arm64 的镜像与二进制文件 |
| 持续集成 | <span class="sn-status planned">计划中</span> | 每次提交运行检查、测试、端到端测试和文档核对 |
| 文档站上线 | <span class="sn-status planned">计划中</span> | 目前在本地用 `make docs-dev` 浏览 |

## 构建时核对 {#checks}

每次构建文档之前，都会把文档与源码逐项比对，任何一项对不上，构建就会失败。所以你在这里看到的，就是这一版文档实际通过的检查。

<SyncStatus part="checks" />

## 项目规模 {#size}

<SyncStatus part="stats" />

## 工具链 {#toolchain}

版本固定在 `mise.toml`、`go.mod` 和 `pnpm-workspace.yaml` 中：

<SyncStatus part="versions" />

## 接下来 {#next}

1. **正式发布**：给 v0.1.0 打标签，自动构建多架构的镜像和二进制文件，并附上校验和。之后部署就不需要在本机构建了。
2. **持续集成**：每次提交都运行 `make check test e2e`，其中包括文档与源码的核对。
3. **文档站上线**：把本站部署为静态网站。

还在考虑、没有决定的功能：

- **批量操作**：在列表里多选链接，一次停用或删除。
- **按标签整理链接**：链接多了之后方便分组查找，但要找到不增加复杂度的做法。

## 不做什么 {#non-goals}

Sani 的定位是一个人用的、简单的短链接服务。下面这些功能会让它变成另一种东西，所以不在计划里：

- 多用户、团队和权限管理；
- 访客追踪：地理位置、设备、浏览器、UTM 汇总；
- 按设备、地区或比例把访问者分流到不同的地址；
- 跳转前的中间页和广告；
- 依赖 PostgreSQL、Redis 这类外部服务。
