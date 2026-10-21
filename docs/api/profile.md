# 我的域 · 邀请与奖励 / 会员中心

对应 `app/src/api/contract.ts` 的 `invitations` / `membership` 接口。

## 邀请与奖励

`GET /api/invitations` → `InvitationsOverview`

| 字段 | 说明 |
| --- | --- |
| `invite` | `InviteCode` `{ code, link, createdAt }` |
| `friends` | `InviteFriend[]` |
| `rewards` | `InviteReward[]` |
| `totalEarned` | 累计奖励（分） |

`InviteFriend`：`{ id, name, maskedPhone, stage: 'registered'|'account_opened'|'reward_earned', joinedAt, reward }`。

`InviteReward`：`{ id, title, description, status: 'credited'|'pending', amount, createdAt }`。

## 会员中心

统一客户级等级（Visa / 银联卡共用），纯资产分层，**无付费订阅**。规则定稿见 [会员制规则设计](../product/membership-rules.md)。

- 四档：`standard` 普通会员（开户即享，¥0）→ `gold` 金卡会员（月均 AUM ≥ ¥10 万）→ `platinum` 白金会员（≥ ¥50 万）→ `diamond` 钻石会员（≥ ¥300 万）。
- AUM 口径：资金账户折人民币余额（含外币按中间价折算）+ 理财持仓市值 + 现金管理余额；不含信用卡 / 授信额度。
- 评定：每月 1 号按上月日均 AUM 重算；**升级即时**（当前实时 AUM 达标当天升级）；**降级需连续 2 个评定周期不达标**。日终快照按北京时间落档，存当日 AUM；上月缺快照的日子按 0 计入日均——只可能低估，不会虚高升级。
- 权益收敛到 `entitlements(tier)`：境外转账费减免（金卡+）、客服 VIP 通道（金卡+）、专属客户经理（白金+）、理财优先购（白金+）、贵宾厅 2/6 次（白金/钻石）、专属理财顾问（钻石）、境外汇款手续费减免（钻石）；生日礼遇暂缓，字段保留但恒为 `false`。旧权益并存：制卡/换卡费年度减免、换汇点差折扣。

`GET /api/membership` → `MembershipOverview`

| 字段 | 说明 |
| --- | --- |
| `tier` / `tierLabel` | 当前等级 `'standard'\|'gold'\|'platinum'\|'diamond'` 及中文名 |
| `aum` | 当前月均 AUM（`evaluation.avgAssets`；尚无评定为 0） |
| `nextTier` / `nextThreshold` | 下一档与门槛；最高档为 `null` |
| `benefits` | 当前档生效权益文案 `string[]`（递进：含低档） |
| `entitlements` | `Entitlements`：各权益布尔值、`loungePassesPerYear`、旧权益字段 |
| `since` | 当前等级生效起点；尚无等级变化时为 `null` |
| `evaluation` | 最近一次月度评定 `{ for, avgAssets, coveredDays, daysInMonth, evaluatedAt }`，未评定为 `null` |
| `downgradeWarning` | 降级缓冲提示；不在缓冲期为 `null` |
| `lounge` | `{ year, perYear, used, remaining }` 贵宾厅年度额度 |
| `records` | `{ id, label, amount, createdAt }[]` 评级与权益使用记录 |

`POST /api/membership/lounge-pass` → `MembershipOverview`

核销一次机场 / 高铁贵宾厅额度，写一条「会员权益：机场/高铁贵宾厅 ×1」记录并返回最新概览。额度不足返回 `409 LOUNGE_QUOTA_EXHAUSTED`。额度与制卡减免次数一起按自然年清零。

其他生效点：转账报价 `POST /api/transfers/quote` 返回 `feeWaived: true` 且 `fee` 为 0（金卡+）；提交转账用同一份 `transferFee` 校验已确认报价；工单 `priority` 为 `vip`（金卡+）或 `normal`；理财产品带 `priorityOpenAt` / `priorityTier`，窗口内仅对应等级可申购（`403 WEALTH_PRIORITY_WINDOW`）。评定惰性触发：会员中心、申卡、换汇等入口跨月时自动完成本月评定并写回档案，`user.memberTier` 与等级同源。


