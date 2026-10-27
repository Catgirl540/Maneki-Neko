# 银行卡

对应 `app/src/api/contract.ts` 的 `cards*` 接口，页面 `app/src/pages/CardsPage.tsx` 等。

## 查询与申请

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/cards` | — | `BankCard[]` |
| GET | `/api/cards/products` | — | `CardProduct[]`（费用与权益由后端给） |
| POST | `/api/cards/open` | `CardApplication` | `BankCard` |
| POST | `/api/cards/:id/replace` | `CardReplaceRequest` | `BankCard` |
| POST | `/api/cards/:id/lock` | `{ locked: boolean }` | `BankCard` |
| POST | `/api/cards/:id/activate` | `{ paymentPassword }` | `BankCard` |
| POST | `/api/cards/:id/lost` | `{ paymentPassword }` | 正式挂失后的 `BankCard` |
| POST | `/api/cards/:id/recover` | `{ paymentPassword }` | 解挂后的 `BankCard` |
| POST | `/api/cards/:id/secrets` | `{ paymentPassword }` | `CardSecrets`（卡号/CVV/有效期，单独验密后取） |

`BankCard` 扩展字段（本页新增，均为可选）：`paymentEnabled?`、`channelLimits?`、`merchantLimits?`、`replacedFromId?`（换发来源卡 id，新开卡为 `null`）。

## 卡组织名额（每位客户各至多一张）

- 每位客户至多持有一张 Visa 卡和一张银联卡。`active`、`locked`、`pending`（寄送中）、`lost`（正式挂失）状态的卡都占名额；`replaced` 为历史卡不占名额；锁卡、挂失不释放名额。
- `GET /api/cards/products` 返回的 `CardProduct` 带两个前端提示字段：`held`（同组织已有占用中卡）与 `feeQuote`（按当前会员等级折算的实付报价 `{ listFee, payable, waived }`）。前端据此置灰并标注，但**名额由后端强制**：`POST /api/cards/open` 对名额已满的卡组织直接返回 `409 CARD_NETWORK_LIMIT`，不验支付密码、不收费、不造卡。
- 换卡 `POST /api/cards/:id/replace` 不受名额限制：旧卡 `replaced` 与新卡 `pending` 在同一笔操作里完成，新卡 `replacedFromId` 指回旧卡并继续占用该组织名额；失败不扣费、不作废旧卡。
- 制卡/换卡费按会员等级减免并核销年度次数（见 [profile.md](./profile.md) 会员等级）。
- 历史档案中超过一张的同组织卡不会被删除或作废：全部保留为 `replaced`/历史记录，仅阻止继续增发。

## 消费开关与限额

卡片状态转换由服务端与浏览器 mock 同样强制：只有 `active`、`locked` 可以锁定/解锁；`locked` 参数必须为布尔值。`pending` 卡不能通过锁卡后解锁、直接解锁、修改设置或解挂变成 active，唯一激活入口是验支付密码的 `/activate`。普通锁卡关闭线上与境外支付；解锁后开关保持关闭。

正式挂失 `/lost` 验支付密码，保存 `lostFromStatus` 与 `reportedLostAt`，关闭支付开关。`lost` 卡不能普通解锁、激活、修改设置、查询卡安全信息或消费。找回后 `/recover` 验支付密码，只恢复挂失前的 active/locked/pending，支付保持关闭；待激活卡解挂后仍须独立激活。挂失前记录缺失时不猜测为 active，引导补卡。挂失卡也可用原换卡接口补卡；旧卡 replaced，新卡 pending，并清除新卡的挂失标记。挂失/解挂不创建资金账户、不改变账户余额或转账能力。

`PATCH /settings` 允许 active 卡更新明列字段；locked 卡可调整限额及关闭支付开关，但不能将 onlinePayment、overseasPayment 或 paymentEnabled 开为 true，也不会因此解锁。不能提交 status、accountId 等字段，pending/lost/replaced 或未知状态拒绝修改设置。非 active 卡一律不能消费；未知状态也拒绝。回归：`node --import ./tools/ts-resolve-hook.mjs tools/check-card-state.mjs`；`server/card-state.test.mjs` 使用专用可丢弃 HTTP PostgreSQL 测试库。

> 演示用的「模拟消费」（`POST /api/cards/:id/spend`，含自定义商家与 Stripe 收单）见 [spend.md](./spend.md)。

`PATCH /api/cards/:id/settings` ← `CardLimitPatch`（扩展字段，配合原有设置项）

```json
{
  "paymentEnabled": true,
  "channelLimits": { "online": 500000, "offline": 200000, "overseas": 100000 },
  "merchantLimits": { "dining": 300000, "shopping": 300000, "other": 100000 }
}
```

→ `BankCard`。`paymentEnabled` 与「锁卡」是两件事：锁卡为全局冻结，`paymentEnabled=false` 仅关闭该卡消费。

错误：`BAD_PAY_PASSWORD`、`CARD_NOT_FOUND`、`CARD_NOT_DELIVERED`、`CARD_REPLACED`、`CARD_LOST`、`CARD_NOT_LOST`、`INVALID_CARD_LOCK`、`INVALID_CARD_STATE`、`INVALID_CARD_SETTINGS`。

## 动态一次性卡号

`POST /api/cards/:id/virtual` ← `VirtualCardRequest` → `VirtualCard`

```json
{ "amountLimit": 100000, "merchantNote": "订票网站", "validHours": 24 }
```

| 响应字段 | 说明 |
| --- | --- |
| `id` | 一次性卡标识 |
| `pan` / `cvv` / `expiry` | 一次性卡号 / 安全码 / 有效期 |
| `amountLimit` | 单笔限额（分） |
| `merchantNote` | 可用商户备注（空 = 不限） |
| `createdAt` / `expiresAt` | 生成 / 失效时间 |

> 安全：一次性卡号仅在创建响应中返回一次，不进入卡列表接口。
> 名额口径：一次性虚拟卡号派生自一张已占用名额的实体卡，是该卡的临时凭证而不是独立的卡产品，不额外占卡组织名额。
