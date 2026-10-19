# 单机 VPS 部署

2026-10-19 起，`https://bank.waveflow.men/` 的网页、银行 API、客户/员工/运维 Agent 与 PostgreSQL 16 位于新 VPS `15.235.241.158`。原 guga 静态托管及 `120.48.123.112` 银行部署退出该域名的运行链路。旧机数据保留，但银行六项服务已停止并禁用自启动，禁止直接启动形成双写。

## 版本与路径

- 代码：`main` 的 `b006b6da3777856943d076c377c1383496020da5`；DSH `0.2.1-rc.2`，Node `24.21.0`。
- 另包含原公网已经使用的两项 Agent 健康检查修复：`app/src/api/agent.ts`、`app/src/lib/useAgentChat.ts`。不包含随后源码提交中的客服视频、头像和导航去重调整；这些界面改动尚待公网发布。
- 服务源码：`/srv/maneki-bank/current` → `/srv/maneki-bank/releases/20261019-b006b6d`。
- 网页：`/var/www/bank.waveflow.men/current` → `releases/20261019-b006b6d`，员工入口 `/staff/`。
- `/srv/maneki-neko`、`/srv/maneki-bank/demo-20261017` 和原发布路径为兼容链接，保留已有模型日志及附件中的绝对路径。
- 本目录两个 Nginx 模板分别安装为 `/etc/nginx/sites-available/bank.waveflow.men` 与 `/etc/nginx/snippets/maneki-single-host.conf`。修改后先 `nginx -t`，再 reload。
- Flutter 下载清单及 APK 在网页发布目录的 `downloads/`，本机直接提供。沿用既有 `android-v1.0.2` 发布包，SHA256 为 `b8b8c2be47c81cdca3ea8daecff7cb38681728becca5bbe17e335405edf7d6d6`；本次不重新构建安卓客户端。

客户端构建沿用根路径：

```sh
VITE_USE_MOCK=false VITE_BASE_PATH=/ VITE_API_BASE_URL='' VITE_AGENT_URL=/agent-api npm --prefix app run build
```

## 通道与隔离

- 客户 `/api/` → `luckycat-bank-demo`，8081，数据库 `maneki_bank_demo`，独立 sandbox 演示环境，页面显示验证码。
- 客户 `/agent-api/` → `luckycat-agent-demo`，8891，使用同一演示库中 `customer` namespace。
- 员工 `/staff-api/` → `luckycat-bank`，8080，数据库 `maneki_bank`；保留原员工及后台记录。
- `/staff-agent-api/` → `luckycat-staff-agent`，8789，`staff` namespace。
- `/staff-ops-agent-api/` → `luckycat-ops-agent`，8790，`ops` namespace。
- 原客户 `luckycat-bridge` 保留为本机 8898 的 live 通道，不作为公开演示客户上游。

银行、Agent、PostgreSQL 都只监听环回地址。六项业务服务由 systemd 启用。员工及运维权限、银行确认与商用闸门保持原行为；迁移不会启用真实银行接入或公网 Shell。

## 数据和凭据

本次停止旧写入后分别导出两库，再恢复到新机空库。两库各 73 张表，146 张表逐表记录数在启动前全部匹配，126 个原生日志和附件文件同步恢复。没有重置客户、余额、冻结、流水、员工或 AI 会话数据；账户模型继续遵守 `docs/product/account-model.md`。

配置目录 `/etc/maneki-vps2` 为 root `0700`，其中 `bank-{live,demo}.env`、`agent-{live,demo,staff,ops}.env`、`models.env` 和备份连接文件均为 root `0600`。systemd 注入配置，服务账号不能直接读取秘密文件。数据库角色密码在新机重新生成；银行字段与 AI 会话密钥沿用迁移数据匹配的原值。不要打印配置、提交凭据或重新生成数据密钥。

运维探活配置 `BANK_AGENT_HEALTH_URL` 分别指向 live `127.0.0.1:8898`、demo `127.0.0.1:8891` 的 `/agent-api/health`，不能沿用默认开发端口 8788。`BANK_RELEASE` 记录实际发布提交。`BANK_PG_STATUS_FILE` 分别读取 `/var/lib/luckycat-bank/backup-status.json` 与同目录 `demo-backup-status.json`，由备份服务写入 root:bank `0640` 文件，运行账号只能读取状态。

迁移快照及清点记录在新旧两机 `/var/backups/maneki-vps2-20261019/`。其中 `manifest.json` 是停机时逐表记录数，`restored.json` 是启动前校验结果。旧机 `source-unit-state.json` 保存原自启动状态。它们均按秘密备份保管。

## 备份、对账与验收

`activate-maintenance.py` 只在已部署的新机由 root 执行，读取新机已生成的数据库密码，安装两库的备份和对账 unit；不从源码生成或替换数据密钥。先手动运行四项 service 并确认成功，再启用对应 timer。

```sh
sudo systemctl start maneki-live-backup maneki-demo-backup maneki-live-reconcile maneki-demo-reconcile
sudo systemctl show maneki-live-backup maneki-demo-backup maneki-live-reconcile maneki-demo-reconcile -p Id -p Result -p ExecMainStatus
sudo systemctl enable --now maneki-live-backup.timer maneki-demo-backup.timer maneki-live-reconcile.timer maneki-demo-reconcile.timer
```

备份每小时执行，位于 `/var/backups/luckycat-bank/postgresql/{live,demo}/`，含自定义格式 dump、摘要及同一快照清单；对账每日 `03:15 UTC` 执行。备份角色仅有读取权限。首次备份和两库对账已通过。定时备份不包含系统配置、外部原生日志及密钥；迁移备份保留这些恢复材料。后续发布应同时备份原生日志和上传目录，数据库 dump 不能代替完整会话备份。

已验证 HTTPS、页面登录、演示验证码、单一资金账户返回、认证 SSE 事件流、真实模型可见回复，以及未登录员工/运维 Agent 的 401 隔离。浏览器中原历史对话仍可见，服务重启后仍能回忆上一条回复；未办理资金交易。证书由新机 Certbot webroot 签发及自动续期，挑战目录 `/var/www/letsencrypt`。本目录 `certbot-nginx-reload.sh` 安装为 root `0755` 的 `/etc/letsencrypt/renewal-hooks/deploy/maneki-nginx-reload`，确保续期后 Nginx 加载新证书。

## 回滚

静态页面与代码可通过保留发布目录和兼容链接回滚；服务配置先备份，校验 Nginx 后 reload。DSH 插件、生成语料和 profile 必须同版本切换，保留原生日志、上传目录和匹配密钥。

新机已开始接受请求，不能将 DNS 指回旧库或直接重启旧服务作为数据回滚。跨主机回退必须先停止新写入、导出新机最新两库及会话状态、验证目标恢复，再切换流量；禁止覆盖或丢弃迁移后的客户操作。数据库恢复遵守 PostgreSQL 运维手册，不能把首次空库恢复脚本重新执行到在线库。
