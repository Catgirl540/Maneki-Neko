# 银行微信日程提醒

使用 `@dely0/dsh-personal-workbench@1.17.0` 的任务、提醒和 SQLite 库，按银行客户分库；沿用已有 `dsh-im@5.1.0` 控制器发送到本人绑定的微信私聊。个人工作台官方 Web 为单用户页面，不作为银行客户入口。企微提醒、重复日程和自动续费排程尚未开放。

## 配置与数据

客户 Agent 同时启用 `LUCKYCAT_IM_ENABLED=1`、`LUCKYCAT_IM_REMINDERS_ENABLED=1`。沿用原 IM 数据密钥与稳定的 `LUCKYCAT_SESSION_DIR`，新任务保存在 `bank-workbench/<sha256(客户ID)>/workbench.db`，主目录权限 0700。这里只存提醒文本、时间、投递状态和绑定指纹，不存余额、支付密码、登录令牌或机器人凭据。文本本身可能敏感，应像 AI 会话一样限制访问和备份。

已加密且已验证归属的旧微信私聊在启用时补充绑定版本；不自动绑定陌生人、不恢复银行登录。新建/换绑产生新版本。解绑、换绑或删除机器人使旧任务停止投递，不把任务转给新归属。

任务不在 PostgreSQL 资金库。数据库备份不包含这些 SQLite 文件。停客户 Agent 后备份整个稳定会话目录，或使用 SQLite 在线备份接口逐库备份；不能只复制活跃的主文件而遗漏 WAL。备份原 IM 密钥，恢复时保持客户任务目录与绑定版本一致；不要盲目恢复旧任务快照重新投递已发消息。当前未新增周期性任务库备份 timer。

## 使用和接口

登录网页端「IM 连接」页（`/reminders`）或原 [银行 IM 页面](https://bank.waveflow.men/agent-api/im)，选择本人私聊，输入文字与北京时间，预览后明确确认。也可由 Agent 调用 `bank_list_im_reminders`、`bank_create_im_reminder`、`bank_cancel_im_reminder`；创建/取消必须经过已有的一次授权确认卡，不需要支付密码。列表在有效 IM 绑定中可走普通只读查询授权。

| 接口 | 行为 |
| --- | --- |
| `GET /agent-api/im/reminders` | 已登录客户自己的连接与最近 100 条提醒 |
| `POST /agent-api/im/reminders` | `title`、`dueAt`、可选 `bindingId`、`requestId`、`confirmed:true` |
| `DELETE /agent-api/im/reminders/:id` | 本人仍等待的任务；`confirmed:true`、`requestId` |

沿用银行认证和来源门禁，未登录 401；归属取服务端身份，不接受请求指定客户。请求编号 8–128 位字母、数字、下划线或连字符。创建相同编号/内容返回原任务，不同内容拒绝。正文为 1–160 字单行文本，时间须带显式时区、合法且在 15 秒后至未来 365 天；UI 明确按北京时间提交。每客户最多 100 个等待任务、1000 条历史。列表最多最近 100 条，返回截断提示。

## 状态与恢复

| 状态 | 含义 |
| --- | --- |
| `scheduled` | 等待时间；机器人未就绪时仍可等待 |
| `sending` | 正在调用渠道；不能撤回 |
| `sent` | 渠道接口已确认发送，不代表已读 |
| `cancelled` | 用户取消，后续不投递 |
| `suppressed` | 绑定变化，停止投递 |
| `expired` | 迟于约定超过 24 小时，停止投递 |
| `failed` | 投递前机器人未就绪达到 20 次检查 |
| `unknown` | 发送或进程中断结果不确定，不自动重发 |

默认 15 秒扫描。机器人在发送前明确未就绪时每 30 秒重查，最多 20 次；进入发送后任何不确定异常都转 `unknown`，不自动重发。进程重启遗留 `sending` 同样转 `unknown`。这减少重复提醒，不能保证第三方渠道端到端恰好一次。已取消和已确认发送状态与上游任务状态在同一 SQLite 事务保存；创建也为原子事务。单客户库损坏隔离处理，不删除原文件或阻塞其他客户。

## 验证

`npm --prefix framework run test:reminders` 覆盖实际上游 SQLite、客户隔离、明确确认、参数绑定、幂等、取消、重启、旧绑定迁移、换绑抑制、离线和不确定投递。`node tools/check-im-reminders-ui.mjs` 配合 `CHROME_PATH` 验证真实浏览器预览/确认/取消、XSS 文字显示、一次夹具投递及退出清理；网页端 `/reminders` 另由 `node tools/check-im-page-ui.mjs` 用夹具接口验证绑定码核对与绑定、提醒创建与取消、解除绑定二次确认和未启用空态。它们使用隔离数据与模拟渠道，不能证明真实微信送达；真实验收只向用户指定的现有私聊发送一条无资金操作的测试提醒，并单独记录渠道确认状态。
