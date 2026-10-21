# 存钱计划

对应 `app/src/api/contract.ts` 的 `savings*` 接口，页面 `app/src/pages/SavingsPage.tsx`，嵌入 `/wealth/plans` 的存钱目标页；旧 `/dashboard/savings` 兼容跳转。目标和凑整均保存计划数据，不新建资金账户，不将目标金额当作投资资产；自动归集尚未开放。

## 总览

`GET /api/savings/overview` → `SavingsOverview`

| 字段 | 说明 |
| --- | --- |
| `totalSaved` | 累计存下（分） |
| `goals` | 目标列表 `SavingsGoal[]` |
| `roundup` | 消费凑整规则 `SavingsRoundupRule` |
| `streak` | 打卡与徽章 `SavingsStreak` |
| `rewards` | 奖励 / 利息加成 `SavingsReward[]` |

`SavingsGoal`：

| 字段 | 说明 |
| --- | --- |
| `id` / `name` / `icon` | 目标标识、名称、图标标识（前端映射本地图标） |
| `targetAmount` / `savedAmount` | 目标金额 / 已存（分） |
| `deadline` | 目标日期 `YYYY-MM-DD`，无期限为 `null` |
| `createdAt` | 创建时间 |
| `sweep` | 定期自动归集 `SavingsSweep`，未开启为 `null` |

`SavingsSweep`：`{ amount, cycle, accountId }`（每 `cycle` 从 `accountId` 归集 `amount`）。

`SavingsRoundupRule`：`{ enabled, roundupTo, dailyCap, accountId, goalId }`
（消费凑整到 `roundupTo` 分，单日上限 `dailyCap`，转入目标 `goalId`，`null` = 不指定目标）。

`SavingsStreak`：`{ days, longestDays, lastSavedAt, badges[] }`；`badges[]` 项为 `{ id, label, earned, hint }`。

`SavingsReward`：`{ id, title, description, status: 'qualified'|'credited', amount, creditedAt }`
（`qualified` = 已达标待入账，`credited` = 已入账）。

## 目标管理

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| POST | `/api/savings/goals` | `SavingsGoalRequest` `{ name, targetAmount, icon?, deadline? }` | `SavingsGoal` |
| PATCH | `/api/savings/goals/:id` | `SavingsGoalUpdate`（同上的字段，全部可选） | `SavingsGoal` |
| DELETE | `/api/savings/goals/:id` | — | `{ ok: true }` |

## 凑整规则

`PATCH /api/savings/roundup` ← `SavingsRuleUpdate`（字段全可选）

```json
{ "enabled": true, "roundupTo": 1000, "dailyCap": 5000, "accountId": "acc_cny", "goalId": "goal_1" }
```

→ `SavingsRoundupRule`。

错误：`INVALID_AMOUNT`（金额 ≤ 0）、`NOT_FOUND`（目标不存在）。
