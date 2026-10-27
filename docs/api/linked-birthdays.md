# 生日资金预留与订购待办

入口：`/wealth/plans?tab=birthday`（理财与储蓄 → 储蓄与计划 → 生日联动），代扣页也提供入口。当前联系人与生日由客户明确填写，不读取外部通讯录、不推测关系、不复用会员生日礼遇字段。每次只授权一个具体年份的生日，不建立无限重复扣款。

## 接口与授权

| 接口 | 行为 |
| --- | --- |
| `GET /api/linked/birthdays` | 本人计划及原预留、订购待办状态，只读 |
| `POST /api/linked/birthdays/preview` | 核对联系人、日期、币种、整数分金额、预留和订购待办时间，不写入 |
| `POST /api/linked/birthdays` | 核对后 `confirmed:true`、6 位 `paymentPassword` 和 `requestId` 创建 |
| `POST /api/linked/birthdays/:id/cancel` | 本人 `confirmed:true` 取消并幂等释放本计划预留 |
| `POST /api/linked/birthdays/:id/order` | 本人 `confirmed:true` 确认到期订购待办，当前只转等待商户接入 |

创建字段：`contactName`、`relationship`、`eventDate`（YYYY-MM-DD）、`amountCents`、可选 `currency`（默认 CNY）与 `accountId`。姓名 1–40 字、关系 1–20 字单行，生日为今天到未来 365 天内的真实日期，金额为 1–100,000,000 的安全整数分。客户身份和账户归属取服务端认证档案，不接受指定他人身份。相同请求与内容返回原记录，不同内容拒绝；生日过后重试也返回原终态，不重新预留。

## 资金和生命周期

计划保存在当前客户加密的 `customer_extension_state` 中，与账户可用余额处于同一个 PostgreSQL 业务事务；不在微信任务库记资金。每位客户仍只有一个储蓄资金账户，按计划币种选择已有余额分区。预留仅减少 `available`，账面 `balance`、账户号、流水与其他币种不变；金额不足保持 `needs_funds`，不得透支或伪称已预留。预留、到期和重试由银行后台事务扫描执行，GET 列表不推进状态。

默认在生日月份月初 00:00（北京时间）预留，在生日前两天 09:00 形成鲜花和蛋糕待确认订购事项。生日为月初一、二日时，预留提前到订购待办时间，核对页明确列出该时间；当天建立或错过提前时间的计划立即显示实际可执行状态，不补造历史订单。

预留记录独立保存 `amountCents`，取消或生日次日过期只释放本计划仍持有的金额，幂等重复不会解冻其他在途转账或计划。服务重启按原记录恢复，不重复预留。余额与预留不一致时拒绝解冻并保留记录待核查。

`order.status=awaiting_confirmation` 表示已到订购待办时间；只有客户点击确认后变为 `awaiting_merchant_connection`。当前 `merchantConnected=false`、`merchantOrderId=null`，未接入鲜花、蛋糕商户、配送或真实清算，确认不会扣款、创建订单、代填地址或声称已购买。请在商户应用另行办理。生日次日释放未消费的预留并将计划过期；不能将待办确认当成实际购买成功。

实现：`shared/linked-plans.mjs`、双端 BankApi 与 `app/src/components/linked/BirthdayPlans.tsx`。`server/linked-plans.test.mjs` 验证月初/日期边界、幂等、隔离、重启后不重复预留、保持其他冻结、损坏金额拒绝和未生成商户订单；`node --import ./tools/ts-resolve-hook.mjs tools/check-linked-plans.mjs` 直接验证真实服务端与浏览器业务层的预览、明确确认、错误/正确支付密码、单次冻结、重新加载、订购意愿和幂等取消。`tools/check-linked-plans-ui.mjs` 浏览器回归用本机 Vite 与隔离响应，不连接客户库、微信或商户。
