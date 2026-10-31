# 单机 VPS 部署

当前发布（2026-10-29，已上线）：官网、工作人员、运维和三类 Agent 共用现有 `8081 / maneki_bank_demo`。工作人员统一从 `/staff/login` 登录，不再选择办理环境；标准 `/staff-api/` 与旧 `/staff-demo-api/` 兼容入口均连接同一银行后端，客服、主管与运维权限仍由后端校验。已验证同库 7 位客户、三位原员工密码 hash 保留且 `auth_version=3`、原库全部表保全、双库对账及标准/兼容 API 角色权限一致。原 live writer 已停止、禁用并加启动防护，四项现行服务 active。详见 [统一银行环境说明](../../docs/unified-bank-environment.md) 和 [部署验收](../../docs/deployments/bank-unified-environment-deployment-20261029.json)。

当前源码为 `/srv/maneki-bank/releases/20261029-unified-environment`，网页为 `/var/www/bank.waveflow.men/releases/20261029-unified-environment`，两处 `current` 已切换；切换前备份为 `/var/backups/maneki-unify-20261029T025532Z`。2026-10-29 12:19（北京时间）增量修复员工 IM：适配器与通知 Worker 已启用，客服/主管绑定列表 200、真实二维码生成和取消、通知签名及主管网页均验收通过；修复前备份为 `/var/backups/maneki-staff-im-20261029T041917360705Z`。员工本人尚需扫码绑定和私聊激活，真实投递未验收。运维终端继续关闭。详见[员工微信 IM 开通手册](../../docs/staff-im-enablement.md)和[本次验收](../../docs/deployments/bank-staff-im-fix-deployment-20261029.json)。

历史发布记录（2026-10-28）：源码与网页切换到 `releases/20261028-account-security`，登录密码强度、连续五次支付错误冻结和工作人员核验解冻上线。当时官网客户使用演示库，工作人员在登录页选择“演示银行（官网客户）”或进入 `/staff/login?bank=demo`，通过独立 `/staff-demo-api/` 办理；原 `/staff-api/` 合作银行及运维入口保留。两库无结构迁移、对账通过，五项服务正常。详见 [安全模块部署验收](../../docs/deployments/bank-security-deployment-20261028.json)。

历史发布记录（2026-10-27）：源码与网页均指向 `releases/20261027-function-fixes`，五项现行服务已验证，原 `luckycat-bridge` 仍停用。两库核心结构为 `2026102701`，当时两库均由 `maneki_owner` 持有，运行角色为 `maneki_app`；以实际运行配置为准，不套用下文历史角色名。详见 [本次部署验收](../../docs/deployments/bank-function-fixes-deployment-20261027.json)。

2026-10-19 起，`https://bank.waveflow.men/` 的网页、银行 API、客户/员工/运维 Agent 与 PostgreSQL 16 位于新 VPS `15.235.241.158`。原 guga 静态托管及 `120.48.123.112` 银行部署退出该域名的运行链路。旧机数据保留，但银行六项服务已停止并禁用自启动，禁止直接启动形成双写。

## 历史版本与路径（2026-10-20）

- 当前代码：`main` 的 `df39575d4ffe64296a1a59557ec3da7bf0763036`，2026-10-20 北京时间 09:28 发布；DSH `0.2.1-rc.2`，Node `24.21.0`，IM `5.1.0`。验收见 [部署记录](../../docs/deployments/bank-deployment-20261020.json)。
- 包含已提交的 Agent/银行、统计、定投计划及网页更新；客户与员工网页统一生产构建，未使用 mock。
- 服务源码：`/srv/maneki-bank/current` → `/srv/maneki-bank/releases/20261020-df39575`；六项服务通过 `90-release-df39575.conf` drop-in 指向新目录。
- 网页：`/var/www/bank.waveflow.men/current` → `releases/20261020-df39575`，员工入口 `/staff/`。保留旧指纹资源和原下载包。
- `/srv/maneki-neko`、`/srv/maneki-bank/demo-20261017` 兼容链接仍指向旧发布目录，客户原生日志、附件及 IM 状态保留原路径；额外环境文件显式指定状态目录。**不能删除旧 release**，也不要把兼容链接随意切到空的新状态目录。
- 当前站点实际 include 为 `/etc/nginx/maneki-locations.conf`；部署时按它承载 `maneki-single-host.conf` 的路由及 `staff-demo.conf` 的兼容路由，不假设历史 snippets 路径仍生效。修改后先 `nginx -t`，再 reload。
- Flutter 下载清单及 APK 在网页发布目录的 `downloads/`，本机直接提供。沿用既有 `android-v1.0.2` 发布包，SHA256 为 `b8b8c2be47c81cdca3ea8daecff7cb38681728becca5bbe17e335405edf7d6d6`；本次不重新构建安卓客户端。

客户端构建沿用根路径：

```sh
VITE_USE_MOCK=false VITE_BASE_PATH=/ VITE_API_BASE_URL='' VITE_AGENT_URL=/agent-api npm --prefix app run build
```

## 当前统一通道与权限

- 客户 `/api/` → `luckycat-bank-demo`，8081，数据库 `maneki_bank_demo`，沿用 sandbox 演示规则和现有客户数据。
- 员工 `/staff-api/`、运维终端 `/staff-api/ops/terminal/` → 同一 8081 后端。`staff-demo.conf` 为旧 `/staff-demo-api/`（含终端）提供同源兼容映射；需与主站模板一起 include。
- 客户 `/agent-api/` → `luckycat-agent-demo`，8891，银行地址为 8081，AI 会话为同一库的 `customer` namespace。
- `/staff-agent-api/` → `luckycat-staff-agent`，8789，银行地址为 8081，AI 会话为同一库的 `staff` namespace。
- `/staff-ops-agent-api/` → `luckycat-ops-agent`，8790，银行地址为 8081，AI 会话为同一库的 `ops` namespace。
- 原 `luckycat-bank`（8080）在 2026-10-29 12:51（北京时间）完成移除：旧 unit 与 drop-in 已移至受保护备份，服务名已 mask，8080 无监听；员工与运维 Agent 的基础 unit 依赖已改为 `luckycat-bank-demo.service`（不能仅依赖 drop-in 中的空 `Requires=` 清除原依赖）。四项现用服务 PID 保持不变，Nginx 与公网入口检查通过。`luckycat-bridge`（8898）继续停用，`maneki_bank` 不承接统一入口的新业务写入；原库、密钥配置与历史备份保留。详见[移除验收](../../docs/deployments/bank-retire-8080-deployment-20261029.json)。

银行、Agent、PostgreSQL 都只监听环回地址。统一数据源不合并客户、客服、主管与运维权限，终端继续遵守独立启用、运维鉴权及凭据校验。保留匹配的银行字段密钥、各 namespace 的 AI 密钥及 IM 状态；不得用原 live 环境文件整份覆盖 demo 配置。统一仍为演示业务，`commercialReady=false`，不启用真实银行通道。

2026-10-29 切换前只读核对：原 live 的两个种子客户都已在 demo 中存在，ID 与手机号匹配，没有仅在 live 的客户；live 的工单、审批、AI 会话及 IM 绑定均为空。原 live 的资金快照与 84 条审计和 demo 不同，两库字段密钥也不同，须保留在原库及切换前备份，不与 demo 相加或覆盖。三位同 ID、同角色工作人员的 live 密码 hash 已升级为 scrypt、`auth_version=2`，但验证结果表明现有密码仍为原演示密码，不匹配环境文件中的初始化密码；hash 升级不代表密码已修改或强度提高。目标是核验身份后保留 live 数据库现有 hash，并将 demo 的 `auth_version` 提升到大于两边原最大值；不使用 env 初始化值覆盖现有密码，demo 额外的已撤销测试员工保留。staff/ops 两边会话空间均为空，无需历史迁移；客户 namespace 不动。两边终端原本关闭，统一后保持关闭。当前未发现维护 timer，不能把下文旧迁移记录中的定时任务当作已启用。

## 数据和凭据

### 客户 IM（2026-10-19 增量启用）

已在 `luckycat-agent-demo` 启用微信/企微 IM 适配，公网入口为 `https://bank.waveflow.men/agent-api/im`。该入口沿用演示银行、现有 OpenRouter 模型及客户 AI 会话库。管理机器人需要演示银行的运维账号；客户须在银行页面独立绑定本人账户，才能查询或办理业务。服务器机器人仍需扫码配置，本机连接测试的机器人和绑定不会自动迁入。

本次仅重启演示客户 Agent，其他银行及 Agent 服务的进程未变。新增 drop-in `/etc/systemd/system/luckycat-agent-demo.service.d/50-im.conf` 设置 `LUCKYCAT_IM_ENABLED=1` 和 HTTPS `LUCKYCAT_IM_PUBLIC_URL`；无需修改 Nginx。上游 `@xmanrui/dsh-im@5.1.0` 独立安装于 `/home/ubuntu/im-rollout-20261019/vendor`，通过当前 framework 的 `node_modules/@xmanrui/dsh-im` 链接加载。后续完整发布使用仓库已锁定的 npm 依赖，并保留匹配 IM 密钥和状态目录。

当前 release 包含 IM 增量覆盖文件；原 bridge 备份、包清单与接口检查位于服务器 `/home/ubuntu/im-rollout-20261019/`。部署记录见 [IM 启用记录](../../docs/deployments/bank-im-deployment-20261019.json)。管理页及脚本返回 200，未认证管理/客户接口返回 401，服务无自动重启。模型合成请求验证成功；服务器微信扫码、客户绑定及真实银行查询尚待用户验收，不把部署检查当作端到端验收。

若回退，先停演示客户 Agent，恢复备份的 `demo-server.mjs`，撤除本次新增 drop-in，`daemon-reload` 后启动原服务。保留 IM 状态、依赖和备份；不回退数据库，不删除会话或资金数据。

后续 IM 查询修复：已绑定且登录有效的当前私聊请求，对普通只读工具白名单复核归属后直接执行，不再逐次跳转网页确认。写操作和敏感卡信息保持原确认。新增 `bank-agent.approveRoutineQuery` 与 `im-bank.authorizeQuery` 在 Bridge 的内部确认通道串联，仍沿用参数绑定、一次性授权、持久化审计与提交前校验。普通网页及员工 Agent 不使用此授权入口。源码、生成语料、技能与原文件备份位于服务器 `query-reuse-backup` 子目录，检查记录为 `query-checks.json`。此次只重启演示客户 Agent，用户需重新绑定一次。回退这次修复应恢复 `query-reuse-backup` 中的文件并重启演示客户 Agent，保留原 IM 启用 drop-in，不删除用户数据。

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
