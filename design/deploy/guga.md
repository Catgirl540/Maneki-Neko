# guga 网页站点

> 2026-10-19 后本页仅保留旧分离部署记录。域名已迁往 `15.235.241.158`，前后端同机，见 [当前单机部署说明](../../deploy/single-host/README.md)。不要重新部署本页的跨机代理作为当前配置。

客户网页：`https://bank.waveflow.men/`；工作人员：`/staff/`。

此站点托管当前 `app/` 构建（包含共享的工作人员页面），后端位于原银行服务器。客户 `/api/` 和 `/agent-api/` 使用独立 `/bank-demo/` 演示环境，页面展示演示验证码；`/staff-api/`、员工/运维 Agent 及 `/downloads/` 保持原 `/bank/` 上游。Agent 代理禁用缓冲，保留流式输出。

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

## 2026-10-19 Agent 连接恢复修复

静态版本切到 `/var/www/bank.waveflow.men/releases/20261019-agent-health/`，以 `9f0656f` 为基础，仅叠加 `app/src/api/agent.ts` 与 `app/src/lib/useAgentChat.ts` 的连接修复；本地待发布的头像/视频等界面调整未包含。旧 `20261017-9f0656f` 保留，代理路由和银行/Agent 服务未更改。

公网带鉴权的健康请求实测约 2.8～5 秒，旧前端 3 秒超时并永久保持离线。现健康、语音与会话恢复探测统一允许 12 秒、禁用缓存；失败后退避重试，网络/页面恢复时可提前重试，成功后停止，卸载时清理。不会因此自动发送消息或重试办理操作。回归入口为 `node tools/check-agent-health.mjs`。 本次客户与员工生产构建通过，真实浏览器已通过公网演示登录、在线状态和模型回复验证，公网 HTML 摘要与发布清单一致；记录见 [连接修复发布清单](../../docs/deployments/bank-agent-connectivity-20261019.json)。

网页回滚备份在 guga 的 `/var/backups/bank-waveflow-men-health-20261019/`，`previous` 记录旧 current 目标，`manifest.json` 保存源文件摘要与 HTML 摘要。按该目标原子恢复 current 软链接即可回滚静态修复；后端、演示库和 live 数据保持各自状态。

## 2026-10-18 客户演示环境

用户明确选择恢复演示验证码。客户 API 与客服已切换到独立 `maneki_bank_demo` PostgreSQL 库及独立 bank/Agent 服务，源码基于 `9f0656f`。从空库创建演示数据，数据密钥、AI 会话密钥、运行角色、profile 与上传目录均独立；原 live 服务及客户数据保留。员工和运维路由仍使用 live。

部署位置、验证和代理回滚见[演示环境维护说明](../../deploy/demo/README.md)。不要为恢复验证码将原 `luckycat-bank.service` 改为 sandbox，也不要将演示源覆盖原 live 发布目录。后续发布须分别维护两套后端。

## 2026-10-17 发布记录

客户与工作人员网页已发布 `main` 的 `9f0656f`，目录为 `/var/www/bank.waveflow.men/releases/20261017-9f0656f/`；旧 `20261016-3dc9bfd` 保留。原服务器的 `/bank/` 同步更新，现有 Flutter 下载保留，未重新构建 APK。

PostgreSQL 改造已合入 main，本次银行与三类 Agent 一起发布到 `/srv/maneki-bank/releases/pg-20261017-9f0656f/`。Agent 的 systemd 发布覆盖将工作目录指向该版本的 `framework/`，客户原生日志与上传目录继续使用 `/srv/maneki-neko/framework/.dsh-home`，员工和运维仍使用各自 `/var/lib/luckycat/` 目录。后续不能只修改旧 `/srv/maneki-neko/framework` 源码来发布 Agent。

发布前已备份并完成隔离恢复、迁移及生产配置启动演练；正式迁移核对余额、冻结、原交易、凭证与 AI 会话不变。网页、接口代理、四个服务及发布后备份巡检通过。线上继续保持 `live`，真实银行通道仍未配置；本次没有完成新登录或真实模型交易验收。详细版本、摘要和备份见 [部署记录](../../docs/deployments/bank-deployment-20261017.json)。数据库回退须独立核对，不随静态网页指针自动回退。

## 2026-10-16 发布记录

应用代码版本为 `3dc9bfd`（功能提交 `8ccbd24`，已合入远端文档）。静态目录为 `/var/www/bank.waveflow.men/releases/20261016-3dc9bfd/`，`current` 已原子切换。旧目录 `/var/www/bank.waveflow.men/releases/20261016T012646Z-a2ad43b7a988/` 保留用于回滚。

**线上银行与 AI 会话已经使用 PostgreSQL，不能直接用本地 SQLite 版覆盖。** 银行服务仍运行 `/srv/maneki-bank/current`，本次未替换银行代码、环境文件、数据库或凭据。客户 Agent 在 `/srv/maneki-neko/framework`；仅将技能选择补丁叠加到线上 bridge，保留原有异步 PostgreSQL 事件提交、加密会话存储及恢复逻辑，并安装客户技能 bundle。员工与运维 Agent 未重启。

Agent 备份、发布文件清单及原/新 bridge 摘要保存在原银行服务器的 `/srv/maneki-neko/deployments/20261016-3dc9bfd/`。`before.tgz` 保存原代码与客户 profile，`absent.json` 记录此次新增文件，`RELEASE.json` 记录代码版本和兼容叠加摘要；不包含客户数据库。回滚时先停止客户 Agent，按清单移除新增文件并恢复备份，然后只启动客户 Agent，不能回滚客户数据。

后续应先把线上 PostgreSQL 改造纳入对应代码分支，再做完整后端发布。当前前端更新仍可独立原子切换，技能更新需保留线上存储兼容层。

验收结果：客户/员工 HTML 与 JS/CSS、深链接、未知资源 404、HTTPS 和受保护接口 401、既有 Flutter 下载均通过。线上银行保持 `BANK_INTEGRATION_MODE=live`，短信服务未接入，`POST /api/auth/sms-code` 返回 `503 INTEGRATION_NOT_CONFIGURED`，因此尚未完成公网客户登录及实际聊天验收；不能为通过测试而把现有银行改为 sandbox。本次客户 Agent 已启动、技能目录校验通过，持久化仍为 PostgreSQL。
