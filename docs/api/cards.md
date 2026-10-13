# 银行卡

对应 `app/src/api/contract.ts` 的 `cards*` 接口，页面 `app/src/pages/CardsPage.tsx` 等。

## 当前能力

原有申请、锁卡、换卡及验密查看安全信息接口与本轮扩展应分开验收。新增一次性卡号仅生成并保存模拟凭据，尚无网页入口、支付授权、一次消费失效或商户/期限/限额执行；新增消费开关及渠道/商户限额字段未被 SQLite 卡表保存与恢复，不能视为已生效的控制规则。

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

→ `BankCard`。这些扩展字段当前仅被模拟对象赋值；服务端后续读取卡表会丢失，且没有消费授权执行逻辑。`paymentEnabled=false` 尚不能保证该卡消费被拒。原有 `onlinePayment`、`overseasPayment`、`dailyLimit` 另按已有实现处理。

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

> 创建响应含完整卡号/CVV，不进入普通卡列表；但当前也被保存到档案 `virtualCards`，没有验密与到期清除机制。不能宣称凭据只返回一次或已经具备一次性支付安全保证。
