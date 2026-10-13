# 我的域 · 邀请与奖励 / 会员与订阅 / 身份认证

对应 `app/src/api/contract.ts` 的 `invitations` / `membership*` / `identity*` 接口。

## 当前能力

邀请与奖励返回演示样例，没有邀请关系归因或奖励发放。会员接口只修改档案状态与记录，未扣费、未执行续费和权益。身份核验为占位：OCR 不接收图片，除姓名外返回固定资料；活体无采集直接返回通过，不可作为开户或权限提升依据。

## 邀请与奖励（演示数据）

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
| `records` | `{ id, label, amount, createdAt }[]` 模拟订阅操作记录，不证明已扣款或已执行权益 |

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
| POST | `/api/identity/ocr` | 无参数 | 固定 `IdentityOcrResult` 样例 |
| POST | `/api/identity/liveness` | 无参数 | 固定通过：`{ verified: true, verifiedAt: string }` |

> 当前 OCR 结果除姓名外是固定样例，页面直接显示 `ocr.idNumber`，mock 模式会随档案保存明文；“界面一律脱敏、明文不落前端存储”不符合现有代码。实际证件脱敏、存储控制和第三方核身接入均待实现。
