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

新增终端通道单独经过 guga 本机 `127.0.0.1:18080` 的加密 SSH 转发，不使用普通 API 的公网 HTTP 上游。启用条件、凭据和回收规则见 [运维终端说明](../../docs/api/ops-terminal.md)。当前公网配置仍为前一版；本轮新增终端尚未发布。
