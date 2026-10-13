# 存钱计划

对应 `app/src/api/contract.ts` 的 `savings*` 接口，页面 `app/src/pages/SavingsPage.tsx`。

## 当前能力

已提供目标增删改查及凑整配置保存。总览中的已有存款、归集计划、打卡、徽章和奖励来自演示档案，不是资金账户计算结果。未实现向目标转入/取出、消费凑整触发、周期归集、打卡统计与奖励入账。

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

`SavingsSweep`：`{ amount, cycle, accountId }`（计划字段；当前没有按 `cycle` 执行归集的任务）。

`SavingsRoundupRule`：`{ enabled, roundupTo, dailyCap, accountId, goalId }`
（保存的配置：凑整值 `roundupTo`、单日上限 `dailyCap`、目标 `goalId`；当前不触发转存，金额及账户/目标归属校验也未完整实现）。

`SavingsStreak`：`{ days, longestDays, lastSavedAt, badges[] }`；`badges[]` 项为 `{ id, label, earned, hint }`。

`SavingsReward`：`{ id, title, description, status: 'qualified'|'credited', amount, creditedAt }`
（`qualified` = 已达标待入账，`credited` = 已入账）。

## 目标管理

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| POST | `/api/savings/goals` | `SavingsGoalRequest` `{ name, targetAmount, icon?, deadline? }` | `SavingsGoal` |
| PATCH | `/api/savings/goals/:id` | `SavingsGoalUpdate`（同上的字段，全部可选） | `SavingsGoal` |
| DELETE | `/api/savings/goals/:id` | — | `BankApi` 为 `void`，HTTP 桥接返回 `{ ok: true }` |

## 凑整规则

`PATCH /api/savings/roundup` ← `SavingsRuleUpdate`（字段全可选）

```json
{ "enabled": true, "roundupTo": 1000, "dailyCap": 5000, "accountId": "acc_cny", "goalId": "goal_1" }
```

→ `SavingsRoundupRule`。

目标管理错误：`INVALID_NAME`、`INVALID_AMOUNT`、`GOAL_NOT_FOUND`。凑整接口当前仅赋值保存，不能宣称已执行上述完整校验。
