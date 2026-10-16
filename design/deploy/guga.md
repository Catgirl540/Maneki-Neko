# guga 网页站点

客户网页：`https://bank.waveflow.men/`；工作人员：`/staff/`。

此站点只托管当前 `app/` 构建（包含共享的工作人员页面），不迁移银行数据库或 Agent。同源 `/api/`、`/staff-api/`、三个 Agent 通道及 `/downloads/` 代理到原服务器 `http://120.48.123.112/bank/`。Agent 代理禁用缓冲，保留流式输出。

## 构建

```sh
VITE_USE_MOCK=false VITE_BASE_PATH=/ VITE_API_BASE_URL='' VITE_AGENT_URL=/agent-api npm run build --prefix app
```

本域名使用根路径，不能使用为裸 IP `/bank/` 准备的 `build:server` 配置。下载仍使用已发布的 Flutter 安装包，本次不重新构建 APK。

## 发布与回滚

通过已配置的 SSH 别名 `guga` 连接。静态产物放在 `/var/www/bank.waveflow.men/releases/<版本>/`，校验摘要和入口文件后，原子替换 `current` 软链接。保留旧版本及原链接目标；回滚时用同样方式将 `current` 指回旧目录，无需重启银行或 Agent。

Nginx 配置：

- `bank.waveflow.men.conf` → `/etc/nginx/sites-available/bank.waveflow.men`，链接到 `sites-enabled/`。
- `bank.waveflow.men-app.conf` → `/etc/nginx/snippets/bank.waveflow.men-app.conf`。
- 证书由服务器现有 Certbot 的 webroot 方式续期；挑战目录 `/var/www/letsencrypt`。证书及私钥不进入仓库。

配置修改先运行 `sudo nginx -t`，通过后 reload。检查 HTTPS 证书、HTTP 跳转、客户和员工深链接、JS/CSS 响应类型、未知资源 404、未登录 API 的 JSON 401、安卓下载清单和 APK 文件头，同时确认 `waveflow.men` 原站点仍可访问。最后用浏览器查看登录页。

## 运维终端

模板中的新增终端通道经过 guga 本机 `127.0.0.1:18080` 的加密 SSH 转发，不使用普通 API 的公网 HTTP 上游。启用条件、凭据和回收规则见 [运维终端说明](../../docs/api/ops-terminal.md)。工作人员新版页面已发布；公网终端后端和 SSH 转发尚未启用，不要直接用带有该通道的模板覆盖当前可用 Nginx 配置。

## 2026-10-16 发布记录

应用代码版本为 `3dc9bfd`（功能提交 `8ccbd24`，已合入远端文档）。静态目录为 `/var/www/bank.waveflow.men/releases/20261016-3dc9bfd/`，`current` 已原子切换。旧目录 `/var/www/bank.waveflow.men/releases/20261016T012646Z-a2ad43b7a988/` 保留用于回滚。

**线上银行与 AI 会话已经使用 PostgreSQL，不能直接用本地 SQLite 版覆盖。** 银行服务仍运行 `/srv/maneki-bank/current`，本次未替换银行代码、环境文件、数据库或凭据。客户 Agent 在 `/srv/maneki-neko/framework`；仅将技能选择补丁叠加到线上 bridge，保留原有异步 PostgreSQL 事件提交、加密会话存储及恢复逻辑，并安装客户技能 bundle。员工与运维 Agent 未重启。

Agent 备份、发布文件清单及原/新 bridge 摘要保存在原银行服务器的 `/srv/maneki-neko/deployments/20261016-3dc9bfd/`。`before.tgz` 保存原代码与客户 profile，`absent.json` 记录此次新增文件，`RELEASE.json` 记录代码版本和兼容叠加摘要；不包含客户数据库。回滚时先停止客户 Agent，按清单移除新增文件并恢复备份，然后只启动客户 Agent，不能回滚客户数据。

后续应先把线上 PostgreSQL 改造纳入对应代码分支，再做完整后端发布。当前前端更新仍可独立原子切换，技能更新需保留线上存储兼容层。

验收结果：客户/员工 HTML 与 JS/CSS、深链接、未知资源 404、HTTPS 和受保护接口 401、既有 Flutter 下载均通过。线上银行保持 `BANK_INTEGRATION_MODE=live`，短信服务未接入，`POST /api/auth/sms-code` 返回 `503 INTEGRATION_NOT_CONFIGURED`，因此尚未完成公网客户登录及实际聊天验收；不能为通过测试而把现有银行改为 sandbox。本次客户 Agent 已启动、技能目录校验通过，持久化仍为 PostgreSQL。
