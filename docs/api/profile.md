# 我的域 · 邀请与奖励 / 会员等级 / 身份认证

对应 `app/src/api/contract.ts` 的 `invitations` / `membership` / `identity*` 接口。

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

## 会员等级

统一客户级等级（Visa / 银联卡共用），按**上月日均储蓄资产**评定本月等级。四档：白银（开户即享）→ 黄金（日均 ≥ ¥10,000）→ 铂金（≥ ¥100,000）→ 钻石（≥ ¥500,000）。评级资产仅含资金账户折人民币余额，不含理财持仓与借款额度；日终快照按北京时间落档，上月缺快照的日子按 0 计入日均——只可能低估，不会虚高升级。

`GET /api/membership` → `MembershipOverview`

| 字段 | 说明 |
| --- | --- |
| `tier` / `tierName` | 当前等级 `'silver'\|'gold'\|'platinum'\|'diamond'` 及中文名 |
| `since` | 当前等级生效起点；尚无等级变化时为 `null` |
| `evaluation` | 最近一次月度评定 `{ for, avgAssets, coveredDays, daysInMonth, evaluatedAt }`，未评定为 `null` |
| `nextEvaluationAt` | 下次评定日（次月 1 日） |
| `upgradeGap` / `nextTierName` | 距下一档的日均资产差额与名称；最高档为 `null` |
| `benefits` | `{ cardFeeWaiversPerYear, cardFeeWaiversUsed, includeShipping, fxFeeRate, plannedPerks[] }` 年度权益额度与用量 |
| `records` | `{ id, label, amount, createdAt }[]` 评级与权益使用记录 |
| `legacy` | 旧月费套餐只读历史 `{ current, plans }`；已停止办理，可能缺省 |

已接通结算的权益：制卡/换卡费年度减免（黄金半价 1 次、铂金全免 1 次、钻石全免 2 次且含寄送费）与换汇点差折扣（黄金 9 折 / 铂金 8 折 / 钻石 7 折）；`plannedPerks` 为规划中项目，不计入已享权益。评定惰性触发：读会员页、申卡、换汇等入口都会在跨月时自动完成本月评定并写回档案，`user.memberLevel` 与等级同源展示。旧订阅套餐已不提供订阅/取消接口。

## 身份认证

`GET /api/identity/status` → `IdentityStatus`

| 字段 | 说明 |
| --- | --- |
| `level` | `'none'\|'basic'\|'verified'` |
| `idType` / `maskedIdNumber` | 证件类型 / 脱敏证件号 |
| `verifiedAt` | 认证时间 |
| `livenessVerified` | 是否已完成人脸活体 |
| `steps` | 开户验证进度 `IdentityStep[]`（资料 → 核验 → 审核 → 发卡） |
| `ocr` | 已识别的证件信息 `IdentityOcrResult`，未识别为 `null` |

`IdentityStep`：`{ id, label, status: 'done'|'active'|'pending', note, completedAt }`。

`IdentityOcrResult`：`{ holderName, idNumber, birthDate, expiryDate, address, confidence }`。

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| POST | `/api/identity/ocr` | `{ imageBase64?, documentType }` | `IdentityOcrResult` |
| POST | `/api/identity/liveness` | `{ imageBase64? }` | `{ verified: boolean, verifiedAt: string }` |

> 演示环境：OCR 按登记资料回填，活体必定通过；真机需接入第三方核身服务。
> 敏感：证件号一律脱敏展示，明文只用于核验，不落前端存储。
