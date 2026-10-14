# 裸 IP 公网部署

部署对象为合并后的 `main`：客户网页、同站工作人员端、Flutter 安卓下载，以及银行和三个 Agent 通道。

- 客户网页：`http://120.48.123.112/bank/`
- 工作人员：`/bank/staff/`；旧 `/staff/` 地址重定向到此处。
- 手机下载：`/bank/download`；更新清单 `/bank/downloads/android.json` 始终禁止缓存。
- 客户、员工和运维助手分别代理到 8898、8789、8790，仅监听回环地址。

`maneki-neko-ip.conf`、`staff-console.conf`、`maneki-agent-proxy.conf` 放入 nginx snippets；继续由原 IP server block include。不要覆盖该 server block 的根路径应用或其他站点。

先用 `tools/package-android-download.mjs <Flutter APK>` 准备静态下载，再执行 `npm --prefix app run build:server`。产物同时包含 `staff/` 与 `downloads/`。静态发布到独立 `releases/<版本>/bank/`，检查后原子替换 `current-bank` 链接，保留旧目录。

银行数据库继续使用 `/var/lib/luckycat/bank.sqlite`。发布前使用 SQLite backup API 创建一致性快照；不要覆盖数据库或部署共享演示库。现有服务器源码目录如有未提交改动，应在独立目录准备发布，保留原工作区。

模型和语音凭据继续由 `/etc/luckycat/luckycat.env`、`model-routing.env` 提供，不复制到前端或仓库。两个新增 Agent unit 最后读取角色配置文件（root:root 600），覆盖公共配置中的端口、会话目录和 patch：

```ini
# staff-agent.env
LUCKYCAT_DEMO_PORT=8789
LUCKYCAT_BANK_URL=http://127.0.0.1:8080
LUCKYCAT_SESSION_DIR=/var/lib/luckycat/staff-agent
LUCKYCAT_PATCHES=

# ops-agent.env
LUCKYCAT_DEMO_PORT=8790
LUCKYCAT_BANK_URL=http://127.0.0.1:8080
LUCKYCAT_SESSION_DIR=/var/lib/luckycat/ops-agent
LUCKYCAT_OPS_WORKSPACE=/srv/maneki-neko
LUCKYCAT_PATCHES=
```

保留客户 Agent 的 `.dsh-home`、会话文件和上传目录；更新插件、生成语料与 profile 必须同时进行。工作人员 profile 由 `framework/scripts/bootstrap-staff.mjs` 准备。服务以 ubuntu 运行，数据目录只有服务账号可读写。

启动后检查银行健康、三个受保护的 Agent 入口、网页和员工深链、静态资源类型、安卓元数据与 APK 摘要。先执行 `nginx -t`，通过后 reload；代码或服务检查失败时恢复备份代码和配置、指向旧静态目录，不自动回滚客户数据库。
