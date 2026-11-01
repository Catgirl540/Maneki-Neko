# 部署与发布记录

每次上线的验收记录（JSON）。按时间倒序排列，最新在前；每条只记录当次发布的范围、验证结果和限制，不能当作功能现状的依据——功能现状以 [当前部署说明](../../deploy/single-host/README.md) 和各域文档为准。

| 日期 | 记录 | 内容 |
| --- | --- | --- |
| 2026-10-29 | [retire-8080](bank-retire-8080-deployment-20261029.json) | 旧 8080 服务定义移至备份并 mask；员工/运维 Agent 残留依赖改为统一后端；仅 8081 监听，现用服务未重启、数据库未修改 |
| 2026-10-29 | [staff-im-fix](bank-staff-im-fix-deployment-20261029.json) | 员工 IM 适配器与通知 Worker 启用，二维码及签名校验通过 |
| 2026-10-29 | [unified-environment](bank-unified-environment-deployment-20261029.json) | 官网、工作人员与运维统一到现有 demo；7 位客户同库、原员工凭据与旧库表保全、兼容入口权限及双库对账通过 |
| 2026-10-28 | [account-security](bank-security-deployment-20261028.json) | 密码强度、五次错误冻结及工作人员解冻；真实 PostgreSQL 与公网浏览器验收通过 |
| 2026-10-27 | [function-fixes](bank-function-fixes-deployment-20261027.json) | 六类功能修复版上线；两库迁移到 `2026102701`，14 张表内容哈希核对 |
| 2026-10-21 | [deployment](bank-deployment-20261021.json) | 常规发布 |
| 2026-10-21 | [im-entry](bank-im-entry-deployment-20261021.json) | 网页内 IM 入口与服务恢复 |
| 2026-10-21 | [im-ui](bank-im-ui-deployment-20261021.json) | IM 页面改版 |
| 2026-10-21 | [inline-qr](bank-inline-qr-deployment-20261021.json) | 页内微信二维码 |
| 2026-10-20 | [deployment](bank-deployment-20261020.json) | 常规发布 |
| 2026-10-20 | [reminders](bank-reminders-deployment-20261020.json) | 银行提醒适配层 |
| 2026-10-19 | [im](bank-im-deployment-20261019.json) | IM 通道启用 |
| 2026-10-19 | [agent-connectivity](bank-agent-connectivity-20261019.json) | 公网健康检查与会话恢复 |
| 2026-10-19 | [vps2](bank-vps2-deployment-20261019.json) | 迁往新主机 |
| 2026-10-18 | [demo](bank-demo-deployment-20261018.json) | 独立演示客户库 |
| 2026-10-17 | [deployment](bank-deployment-20261017.json) | 单账户模型上线 |
| 2026-10-16 | [deployment](bank-deployment-20261016.json) | 常规发布 |
| 2026-10-15 | [deployment](bank-deployment-20261015.json) | PostgreSQL 后端上线 |

这些 JSON 由发布流程写入，内容只描述当次验证；出现冲突时以源码、测试与当前部署说明为准。
