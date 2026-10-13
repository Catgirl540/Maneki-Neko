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
| POST | `/api/cards/:id/secrets` | `{ paymentPassword }` | `CardSecrets`（卡号/CVV/有效期，单独验密后取） |

`BankCard` 扩展字段（本页新增，均为可选）：`paymentEnabled?`、`channelLimits?`、`merchantLimits?`。

## 消费开关与限额

`PATCH /api/cards/:id/settings` ← `CardLimitPatch`（扩展字段，配合原有设置项）

```json
{
  "paymentEnabled": true,
  "channelLimits": { "online": 500000, "offline": 200000, "overseas": 100000 },
  "merchantLimits": { "dining": 300000, "shopping": 300000, "other": 100000 }
}
```

→ `BankCard`。`paymentEnabled` 与「锁卡」是两件事：锁卡为全局冻结，`paymentEnabled=false` 仅关闭该卡消费。

错误：`BAD_PAY_PASSWORD`、`CARD_NOT_FOUND`（卡不存在）。

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
