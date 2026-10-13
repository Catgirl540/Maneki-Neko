# 我的域 · 邀请与奖励 / 会员与订阅 / 身份认证

对应 `app/src/api/contract.ts` 的 `invitations` / `membership*` / `identity*` 接口。

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

## 会员与订阅

`GET /api/membership` → `MembershipOverview`

| 字段 | 说明 |
| --- | --- |
| `current` | `MembershipSubscription` 当前订阅 |
| `plans` | `MembershipPlan[]` 可选套餐 |
| `records` | `{ id, label, amount, createdAt }[]` 扣款 / 权益记录 |

`MembershipSubscription`：`{ planId, planName, status: 'active'|'canceled'|'none', price, period, startedAt, renewAt }`
（`renewAt` 已取消时为 `null`）。

`MembershipPlan`：`{ id, name, price, period, perks[], highlight? }`。

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| POST | `/api/membership/subscribe` | `{ planId }` | `MembershipOverview`（`current.status='active'`） |
| POST | `/api/membership/cancel` | `{}` | `MembershipOverview`（`current.status='canceled'`，`renewAt=null`） |

演示套餐 `planId`：`gold`、`platinum`。错误：`PLAN_NOT_FOUND`（套餐不存在）。

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
