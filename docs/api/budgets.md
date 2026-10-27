# 支出预算接口

「支出预算」把某几个消费平台的钱装进一个每日限额的罐子里：今天在这个罐子里的额度花完了，再刷这些平台就会被整笔拒绝。它只是一条业务规则，不冻结资金、不新建子账户，也不影响其他币种分区；能拦的只有「模拟消费」（`POST /api/cards/:id/spend`），转账、换汇、理财申赎照旧。

- 页面：`app/src/pages/BudgetsPage.tsx`（路由 `/analysis/budgets`，入口「全部服务 → 账单与资金 → 支出预算」）
- 口径：`shared/budgets.mjs`（服务端与前端 mock 共用）
- 业务：`server/domain/index.mjs` 的 `listBudgets` / `createBudget` / `updateBudget` / `deleteBudget` / `redeemBudgetPass`
- 回归：`tools/check-budgets.mjs`（18 项）、`server/banking-http.test.mjs` 里的 `spending budgets cap matched card spend before the debit happens`

## 数据模型

```ts
interface BudgetRecord {
  id: string
  name: string            // 1–20 字单行
  platforms: string[]     // 预设平台 id，见 shared/spend-platforms.mjs
  dailyLimit: Cents       // 100 – 5,000,000 分
  pointThreshold: Cents   // 0 – 5,000,000 分，默认 1,000
  enabled: boolean
  createdAt: string
  updatedAt: string
}
```

接口返回的 `Budget` 在原始记录上再加派生字段：`merchantNames`（平台展示名）、`today`（`{day, used, limit, remaining}`）、`points`（`{awarded, used, available}`）、`passes`（该预算的额度券）。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/budgets` | 预算列表 + 今日用量 + 积分；会先补算历史积分并落盘 |
| POST | `/api/budgets` | 新建预算，返回带派生字段的单项 |
| PATCH | `/api/budgets/:id` | 局部更新（name / platforms / dailyLimit / pointThreshold / enabled） |
| DELETE | `/api/budgets/:id` | 删除预算，同时删掉它的积分与额度券 |
| POST | `/api/budgets/:id/passes` | 用 30 分换一张「某天 +¥20」额度券，body `{ day?: 'YYYY-MM-DD' }` |

`GET /api/budgets` 的响应：

```json
{
  "budgets": [
    {
      "id": "budget_0001",
      "name": "奶茶预算",
      "platforms": ["luckin", "starbucks"],
      "merchantNames": ["瑞幸咖啡", "星巴克"],
      "dailyLimit": 2000,
      "pointThreshold": 1000,
      "enabled": true,
      "today": { "day": "2026-10-27", "used": 1500, "limit": 2000, "remaining": 500 },
      "points": { "awarded": 0, "used": 0, "available": 0 },
      "passes": []
    }
  ],
  "today": "2026-10-27",
  "timeZone": "Asia/Shanghai",
  "pointsPerPass": 30,
  "passExtra": 2000,
  "maxFutureDays": 30
}
```

## 拦截口径

`spendOnCard` 在解析出商户、金额与账单详情之后、扣款之前校验：

1. 只考虑 `enabled: true` 且覆盖该商户号的预算。
2. 商户号来自平台目录的 `merchantId`；自由商户（`custom` / `stripe`）的动态商户号不在任何预算里。
3. 累计只算 `direction === 'out'`、`status === 'success'`、上海自然日相同、`detail.merchantId` 命中的流水。
4. 当日额度 = `dailyLimit` + 当天已兑换的额度券合计。
5. 任一预算 `used + amount > limit` 就整笔拒绝，返回 409 `BUDGET_LIMIT_EXCEEDED`，文案带预算名、今日额度、已用金额与本次金额。
6. 预算通过后，卡自身的单笔/单日/渠道/商户类别限额仍照常校验，两者都要满足。

## 校验与错误码

| 场景 | HTTP | code |
| --- | --- | --- |
| 名字为空、超长或含控制字符 | 400 | `INVALID_BUDGET_NAME` |
| 平台为空、未知平台或用了 `custom` / `stripe` | 400 | `INVALID_BUDGET_PLATFORMS` |
| 每日限额不在 1–50,000 元 | 400 | `INVALID_BUDGET_LIMIT` |
| 积分门槛为负或超范围 | 400 | `INVALID_BUDGET_THRESHOLD` |
| `enabled` 不是布尔值 | 400 | `INVALID_BUDGET_ENABLED` |
| 同一客户超过 6 个预算 | 409 | `BUDGET_LIMIT_REACHED` |
| 预算不存在或不属于当前客户 | 404 | `BUDGET_NOT_FOUND` |
| 命中预算但超出当日额度 | 409 | `BUDGET_LIMIT_EXCEEDED` |
| 积分不足 30 分 | 409 | `INSUFFICIENT_BUDGET_POINTS` |
| 额度券日期早于今天或超过 30 天 | 400 | `INVALID_PASS_DAY` |

## 积分与额度券

- 每个预算一个积分池，按上海自然日结算。
- 某天该预算消费 `< pointThreshold`（含 0 元）记 1 分；当天不结算，次日第一次读预算时补算，最多回看 90 天。
- 结算记录以 `budgetId + day` 去重，天然幂等；进程重启不会重复发分。
- 30 分换一张「该预算某天 +¥20」额度券，日期默认今天、最多 30 天内；兑换立即生效，当天额度即时抬高。
- 停用预算不清空积分与额度券；删除预算才会一起删掉。

## 已知边界

- 只拦系统内的模拟消费；真实银行卡消费、转账、换汇、理财不在拦截范围。
- 自定义收单与 Stripe 的自由商户号是动态生成的，无法预先纳入预算。
- 预算的额度不参与账户可用余额计算，也不产生冻结或预授权记录。
- 助手只有只读工具 `bank_list_budgets`：能读今日额度、已用、剩余与积分，不能创建、修改预算，也不能代用户兑换额度券。

## Agent 工具：`bank_list_budgets`

| 工具 | 方法 | 路径 | 参数 | 说明 |
|---|---|---|---|---|
| `bank_list_budgets` | `GET` | `/api/budgets` | 无 | 返回与页面相同的 `BudgetsOverview`：每个预算的今日额度、已用、剩余、积分与额度券 |

- 属于常规只读查询，走 `approveRoutineQuery` 直接放行，不弹确认卡、不需要支付密码。
- 只读：没有创建、修改、删除或兑换的助手工具；这些操作要在网页 `/analysis/budgets` 完成。
- 回答时必须使用返回的 `today.used`、`today.remaining` 与 `points.available`，不能自行推算或编造预算。

## 测试

```bash
node tools/check-budgets.mjs
BANK_HTTP_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/maneki_http_test \
  node --test server/banking-http.test.mjs
```

`check-budgets.mjs` 覆盖上海日边界、累计口径、拦截与额度券、积分补算与幂等、全部校验分支；HTTP 用例覆盖真实的建预算、命中拦截、未命中放行、余额只被成功消费扣减、停用后放行、积分不足拒绝兑换、删除与越权隔离。
