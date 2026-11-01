# 开通员工微信 IM（故障修复手册）

2026-10-29：工作人员「IM 机器人」页面显示 `未知路径：GET /agent-api/im/bindings`，右侧提示「暂未取得连接信息」。这不是路由拼错，也不是微信掉线，而是**员工 Bridge 没有启用员工 IM**：`/staff-agent-api/` 正常转发到 8789 的 `/agent-api/`，但该进程没有挂载 IM 路由。

本手册说明现象、根因、代码侧修正和服务器开通步骤。开通涉及银行与员工 Bridge 两个进程、数据库和通知密钥，**只改前端或只重启一个服务都不会成功**。

2026-10-29 12:19（北京时间）已完成线上修复：员工 IM 与通知 Worker 已启用，客服和主管绑定列表均返回 200，真实微信二维码生成、归属隔离和取消验证通过，主管页面已无未知路径提示。本人微信扫码、确认绑定和真实消息投递仍需员工完成。数据库结构和原会话密钥保留，备份位于 `/var/backups/maneki-staff-im-20261029T041917360705Z`。详见[部署验收](deployments/bank-staff-im-fix-deployment-20261029.json)。

## 现象与判定

| 观察 | 含义 |
| --- | --- |
| 页面横幅 `未知路径：GET /agent-api/im/bindings` | 旧 Bridge：IM 路由未挂载，落到通用 404 |
| 页面横幅「员工微信 IM 尚未启用」 | 新 Bridge：明确回 `503 IM_DISABLED` |
| `curl 127.0.0.1:8789/agent-api/im/bindings` 返回 404 | 员工 IM 开关没开，或跑的是旧代码 |
| 未带令牌时同一地址返回 401 | 只能说明员工鉴权有效；旧 Bridge 也会先鉴权，不能据此证明 IM 已开通 |
| 带有效客服/主管令牌时返回 200 JSON 数组 | 绑定路由已挂载；仍需验证扫码与通知服务 |
| 同一地址返回 503 `IM_DISABLED` | 新代码已部署，但仍未开开关 |

客户 IM（8891）与员工 IM（8789）是两套独立开关、独立状态目录（`im/` 与 `staff-im/`）和独立加密域。客户侧正常不代表员工侧已启用。

## 根因

`framework/bridge/demo-server.mjs` 只在同时满足下列条件时创建 `imHttp`：

```js
STAFF_MODE && !OPS_MODE && process.env.LUCKYCAT_STAFF_IM_ENABLED === '1'
```

未满足时 `imHttp` 为 `null`，`/agent-api/im/*` 不再匹配任何路由。2026-10-29 统一环境部署保留了服务器原配置（`preservedConfigurationLimits.staffImAdapter`），所以该开关一直是关闭的，部署验收把 `/staff-agent-api/im/bindings` 的 404 记为已知配置限制。

只打开开关还不够：员工 Bridge 会用 `LUCKYCAT_STAFF_IM_SERVICE_KEY` 调银行的 `/internal/staff-im-notifications/*`（绑定、校验、解绑、测试、领取、完成），银行侧用同一密钥验签；银行还要求 `staff_im_*` 表和触发器存在。

## 代码侧修正（本次已改）

- Bridge 在 IM 未启用时对 `/agent-api/im/*` 返回 `503 {"error":"员工微信 IM 尚未启用","code":"IM_DISABLED"}`，不再落到通用 404；实现见 `framework/bridge/im-availability.mjs`。
- 工作人员页面把 `IM_DISABLED`、「尚未启用」类 503 和初始化 `/bindings` 探测的旧版 404 显示为开通指引；未开通时禁用「生成微信连接二维码」，并隐藏业务确认页入口。扫码任务或绑定不存在等操作 404 保留具体错误，避免误判整项服务未开通。
- 浏览器夹具新增未启用场景：`tools/check-staff-im-ui.mjs`（截图 `.generated/staff-im-checks/staff-im-disabled.png`）。

代码修正让页面说人话，但**不会自动打开服务器上的开关**；要让员工真正连上微信，继续做下面的开通步骤。

本次固定发布的受限脚本为 [`deploy/single-host/enable-staff-im.py`](../deploy/single-host/enable-staff-im.py)，先用 `--check-only --package-dir <已校验的包目录>` 预检，再以 `--apply` 应用。它仅适用于当前固定发布与空员工绑定状态，已应用后不能直接重复执行；后续发布应使用新的版本基线。脚本只同步三个 IM 源文件和员工构建产物、配置两个服务的通知密钥与开关，备份后原子替换，失败恢复原配置与文件；不恢复数据库或覆盖 IM 状态。

## 开通前确认

```bash
# 1. 确认 unit 实际读取哪些环境文件，别改错文件
systemctl show luckycat-staff-agent -p EnvironmentFiles -p ExecStart -p WorkingDirectory
systemctl show luckycat-bank-demo  -p EnvironmentFiles -p ExecStart -p WorkingDirectory

# 2. 确认员工 Bridge 连接的银行地址（统一环境是 8081）
grep -E 'LUCKYCAT_BANK_URL|LUCKYCAT_DEMO_PORT|LUCKYCAT_AUDIENCE' <员工 Bridge 的 EnvironmentFile>

# 3. 确认服务源码包含本修正
ls <release>/framework/bridge/im-availability.mjs
```

生产 `BANK_AUTO_MIGRATE=false`，数据库结构不会随启动自动升级，必须由数据库拥有者手工执行。

## 开通步骤

以下命令在服务器执行。`/etc/luckycat/...` 是参考路径，以第 1 步实际输出为准；若生产使用 `/etc/maneki-vps2/agent-staff.env`，就改那一个。密钥只写进 root `0600` 的环境文件，**不要**放进 `VITE_*`、网页或仓库。

1. 生成一次服务密钥（32 字节以上，银行与员工 Bridge 必须完全相同）：

```bash
openssl rand -base64 48
```

2. 银行进程环境（`luckycat-bank-demo` 读取的文件）：

```ini
LUCKYCAT_STAFF_IM_SERVICE_KEY=<上一步的密钥>
LUCKYCAT_STAFF_IM_PUBLIC_URL=https://bank.waveflow.men
```

3. 员工 Bridge 环境（`luckycat-staff-agent` 读取的文件）：

```ini
LUCKYCAT_STAFF_IM_ENABLED=1
LUCKYCAT_STAFF_IM_NOTIFICATIONS_ENABLED=1
LUCKYCAT_STAFF_IM_SERVICE_KEY=<与银行相同>
LUCKYCAT_STAFF_IM_PUBLIC_URL=https://bank.waveflow.men
```

`LUCKYCAT_STAFF_IM_NOTIFICATIONS_ENABLED` 控制提醒 Worker；「发送连接测试提醒」也只会先向银行排队，必须启用 Worker 才会实际投递。员工 IM 只在客服、主管进程启用，运维进程（8790）不加载。

4. 先只读检查 `maneki_bank_demo` 是否已有员工 IM 结构、实际银行运行角色是否具有所需权限。2026-10-29 本次服务器核对：七张 `staff_im_*` 表已经存在，实际银行运行角色为 `maneki_app`，无需重复迁移。只有缺少结构时，才在备份后以数据库拥有者身份应用：

```bash
psql "$OWNER_URL" -d maneki_bank_demo -v ON_ERROR_STOP=1 -f server/staff-im-schema.sql
```

迁移后只向已核对的实际运行角色授予新表所需权限。`deploy/postgres/grants.sql` 内含历史数据库 `maneki_bank` 和角色名称，不能直接套用到统一环境。结构只新增 `staff_im_bindings/preferences/rules/outbox/cycles/notifications/attempts` 及触发器；执行前照常做一次数据库备份。

5. 依次重启银行与员工 Bridge（先银行，后 Bridge；运维 8790 不动）：

```bash
sudo systemctl restart luckycat-bank-demo
sudo systemctl restart luckycat-staff-agent
sudo systemctl is-active luckycat-bank-demo luckycat-staff-agent
```

6. 在服务器上验证路由和鉴权，而不是只看网页：

```bash
curl -s -H "Authorization: Bearer $STAFF_TOKEN" http://127.0.0.1:8789/agent-api/im/bindings  # 期望 200 JSON 数组
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8789/agent-api/im              # 期望 200
sudo journalctl -u luckycat-staff-agent -n 30 --no-pager | grep -E 'IM|staff-im'
```

未认证 `bindings` 的 401 不能证明修复成功：旧代码也会在通用 404 前鉴权。应同时验证客服和主管的绑定列表返回 200、员工 portal 返回 200 且带 `data-audience="staff"`，再生成并取消一次真实二维码，验证通知服务签名。启动日志出现 `[demo-server] IM 管理与银行确认入口` 说明 `imHttp` 已创建；若进程反复重启，先看是否报 `Staff IM requires the same LUCKYCAT_STAFF_IM_SERVICE_KEY`（密钥缺失或不足 32 字节）。

7. 浏览器验收：客服登录「IM 机器人」→「生成微信连接二维码」→ 本人微信扫码 → 确认绑定 → **用绑定的微信给机器人发一条私聊**（建立投递上下文）→ 刷新状态应显示「私聊上下文已建立」。主管再配置值班客服、备用主管和值班时段。

## 回滚

1. 员工 Bridge 环境去掉 `LUCKYCAT_STAFF_IM_ENABLED` / `LUCKYCAT_STAFF_IM_NOTIFICATIONS_ENABLED`，重启 `luckycat-staff-agent`；页面回到「尚未启用」提示，不再 404。
2. 需要彻底撤销时再撤银行密钥并重启 `luckycat-bank-demo`。
3. 不要删除 `staff-im/` 状态目录和 `staff_im_*` 表：绑定、偏好与投递记录要保留；重新开通时旧绑定继续有效，但换微信后必须重新扫码。
4. 回滚不重发历史 `sending/unknown` 通知，也不改动客户资金数据。

## 已知限制

- 员工微信与客户微信是不同机器人实例，需要员工本人扫码；不存在“从客户绑定迁移过来”的路径。
- 提醒只说明任务编号、类型、优先级和银行受保护链接，不含客户姓名、电话、余额、卡号或聊天原文；真实送达仍以微信回执为准。
- `/staff-agent-api/im/admin/*` 对员工角色关闭；机器人全局管理仍在客户 Bridge 的 `/agent-api/im`，需要运维账号。
