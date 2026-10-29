# 模拟消费（演示刷卡）

演示「在外部商户刷卡」：客户在网页选平台、选卡、填金额，由服务端从卡绑定的**资金账户**扣款并落一笔卡类流水。**不接真实收单、不产生真实扣款**，扣的是演示账户余额；分类与真实刷卡走同一条「先记账后分类」链路。

- 页面：`app/src/pages/SpendPage.tsx`（路由 `/spend`，导航「模拟消费」）
- 平台目录：`shared/spend-platforms.mjs`（前端与后端共用）
- 业务实现：`server/domain/index.mjs` 的 `spendOnCard`；浏览器模拟：`app/src/api/mock/index.ts`
- 回归：`tools/check-spend.mjs`、`tools/check-categorize.mjs`

资金账户口径不变：多张卡共享同一个资金账户，模拟消费不新建账户、不按卡建户（见 [账户模型约束](../product/account-model.md)）。

## 平台目录与自由商家

### 预设平台（12 家）

`SPEND_PLATFORMS` 只描述**商户身份**，分类不写死：

| id | 商户名 | 商户编号 | 收单机构（回单对方机构） | 城市 |
| --- | --- | --- | --- | --- |
| `meituan` | 美团外卖 | M3101150001 | 美团支付（北京三快在线科技有限公司） | 北京市 |
| `taobao` | 淘宝 | M3301060002 | 支付宝（中国）网络技术有限公司 | 杭州市 |
| `jd` | 京东 | M1101080003 | 网银在线（北京）科技有限公司 | 北京市 |
| `pinduoduo` | 拼多多 | M3101040004 | 上海寻梦信息技术有限公司 | 上海市 |
| `didi` | 滴滴出行 | M1101050005 | 滴滴支付（北京小桔科技有限公司） | 北京市 |
| `luckin` | 瑞幸咖啡 | M1101010006 | 瑞幸咖啡（中国）有限公司 | 北京市 |
| `starbucks` | 星巴克 | M3101010007 | 星巴克咖啡（中国）有限公司 | 上海市 |
| `hema` | 盒马鲜生 | M3101150008 | 盒马（中国）有限公司 | 上海市 |
| `iqiyi` | 爱奇艺会员 | M1101080009 | 北京爱奇艺科技有限公司 | 北京市 |
| `china-mobile` | 中国移动话费 | M1101010010 | 中国移动通信集团有限公司 | 北京市 |
| `ziroom` | 自如房租 | M1101050011 | 自如（北京）资产管理有限公司 | 北京市 |
| `maoyan` | 猫眼电影 | M1101010012 | 猫眼娱乐（天津）有限公司 | 北京市 |

展示用元数据：`glyph`（字形）、`tone`（品牌底色）、`ink?`（字形颜色）、`noteHint`（账单详情示例）。网页真实图标由 `app/src/assets/spend/` 提供，映射在 `SpendPage.tsx` 的 `PLATFORM_ICON`：应用图标满铺圆角块，品牌标白底留白。

### 自由商家（2 种）

`FREE_SPEND_MERCHANTS`，商户名由请求的 `merchant` 传入：

| id | 选项名 | 回单对方机构 | 商户编号前缀 | 说明 |
| --- | --- | --- | --- | --- |
| `custom` | 自定义商家 | 自定义收单 | `MC` | 商户名任意，地点「线上商户」 |
| `stripe` | Stripe | Stripe Payments | `MS` | 境外收单，美国 · 旧金山，地点「线上商户 · 境外收单」 |

商户名要求：2–40 字、单行（拒绝换行与控制字符），前后空白自动去除。商户编号按「前缀 + 当前时间戳后 9 位」生成。

## 接口

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| POST | `/api/cards/:id/spend` | `SpendRequest` | `SpendReceipt` |

`SpendRequest`：

```json
{
  "platform": "meituan",
  "amount": 1150,
  "note": "嗉泰面（大朗店）· 猪扒包",
  "merchant": "OpenAI"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `platform` | string | 是 | 预设平台 id 或自由商家 id（`custom` / `stripe`） |
| `amount` | `Cents` | 是 | 正整数，单笔上限 ¥50,000.00（5000000 分） |
| `note` | string | 否 | 账单详情：店铺/商品说明，≤80 字单行；写进流水摘要与 `detail.merchantNote` |
| `merchant` | string | 自由商家必填 | 商户名称，2–40 字单行 |

`SpendReceipt`：

| 字段 | 说明 |
| --- | --- |
| `transaction` | 生成的流水（`Transaction`），`counterparty` 为商户名 |
| `category` | 记账时的分类：未配置分类器时按本地商户规则即时归类（预设平台固定口径，自由商家按关键词兜底），配置了分类器时先为 `other` 再由后台任务回写 |
| `classificationState` | `pending`（分类器启用）或 `done`（未启用分类器） |
| `available` | 扣款后该卡绑定账户的可用余额快照 |
| `currency` | 扣款币种 |

摘要规则：有 `note` 时 `memo = 商户名 · note`，否则 `memo = 商户名 消费`；`detail.remark = 模拟消费 · 商户名( · note)`。

## Agent 工具：`bank_spend`

助手侧入口，工具定义在 `framework/packages/bank-demo/src/http-tools.ts`，确认与转发在 `framework/bridge/bank-agent.mjs`。只在沙箱演示环境可用：非 live 模式由本机演示银行（`server/domain/index.mjs` 的 `spendOnCard`）处理；`BANK_MODE=live` 时被 `server/bank-api.mjs` 的 live 白名单挡成 `503 BANK_NOT_CONNECTED`。

| 工具参数 | 对应接口字段 | 说明 |
| --- | --- | --- |
| `cardId` | 路径 `:id` | 必须先 `bank_list_cards`，只接受本人卡片 |
| `platform` | `platform` | 12 个预设 id，或 `custom` / `stripe` |
| `amountCents` | `amount` | 正整数分，上限 5000000 |
| `merchant` | `merchant` | 仅自由商家必填，2–40 字单行 |
| `note` | `note` | 可选，≤80 字单行，必须由客户给出 |

- **确认**：属于写操作，走桥接的一次性确认卡（`prepare` → `approve` → `execute`），展示卡、商户、金额、账单详情；执行前按 `preview.cardState` 复核卡片状态与设置，变化则要求重新确认。
- **不需要支付密码**：卡消费本身不验证支付密码；模型参数里也不接受任何密码字段。
- **预检**：`prepare` 阶段先拒绝寄送中、锁定、关闭消费或关闭线上支付的卡，并复用 `shared/spend-platforms.mjs` 校验平台与商户名，避免用户确认后才被后端拒绝。
- **结果口径**：返回银行回执 `{ transaction, category, classificationState, available, currency }`；分类可能已经是本地商户规则给出的结果，也可能是后台任务稍后回写，助手不得把它描述成最终分类、真实商户收款或退款依据。

## 校验链（按执行顺序）

| 顺序 | 校验 | 错误码 |
| --- | --- | --- |
| 1 | 卡存在 | `CARD_NOT_FOUND` |
| 2 | 卡状态：锁定 / 待激活 / 已换发 | `CARD_LOCKED` / `CARD_NOT_DELIVERED` / `CARD_REPLACED` |
| 3 | 消费开关：`paymentEnabled`、`onlinePayment` | `CARD_PAYMENT_DISABLED` / `CARD_ONLINE_PAYMENT_DISABLED` |
| 4 | 平台存在 / 自由商户名合法 | `SPEND_PLATFORM_NOT_FOUND` / `INVALID_MERCHANT` |
| 5 | 金额：正整数、单笔上限 | `INVALID_AMOUNT` / `LIMIT_EXCEEDED` |
| 6 | 账户存在 | `ACCOUNT_NOT_FOUND` |
| 7 | 线上渠道单笔限额 | `CHANNEL_LIMIT_EXCEEDED` |
| 8 | 商户类别限额（按 `other` 桶） | `MERCHANT_LIMIT_EXCEEDED` |
| 9 | 单卡单日限额（累计当日成功消费） | `DAILY_LIMIT_EXCEEDED` |
| 10 | 账户可用余额 | `INSUFFICIENT_FUNDS` |
| 11 | 账单详情格式 | `INVALID_NOTE` |
| 12 | 支出预算当日额度（口径见 [budgets.md](./budgets.md)） | `BUDGET_LIMIT_EXCEEDED` |

注意：分类是**后台任务**，写账时还不知道类别，因此商户类别限额固定按「其他」桶校验，分类完成后不回溯重算。

支出预算这道校验排在扣款之前、账户余额校验附近：命中任一启用预算的平台且「今日已用 + 本次金额」超过当日额度（基础额度 + 当天已兑换的额度券）就整笔拒绝，文案带预算名、今日额度与已用金额；预算放行后卡自身的限额与余额仍然照常校验。

## 记账与后台分类

1. `pushTransaction` 写入流水：`channel=card`、`paymentMethod=<卡产品名> 尾号 <last4>`、`detail.cardId`（单日限额累计依据）、商户编号/国家/城市/地点/收单机构、`merchantNote`。
2. 没有配置分类器（缺 `OPENROUTER_API_KEY`）时，按**本地商户规则**（`shared/spend-rules.mjs`）即时归类并落 `classificationState=done`：12 个预设平台口径固定，自由商家按商户名关键词兜底，认不出来才落 `other`。
3. 配置了分类器时 `classificationState=pending`，随后调度后台任务：分类器按 `counterparty + memo` 判定类别并回写 `category` 与 `classificationState=done`；模型全部失败时回落到本地规则（有规则即 `done`，没有才标 `failed` 并保持 `other`）。
4. 分类器模型链：`BANK_CATEGORIZE_MODEL` 可用逗号给首选模型，后面自动接默认回退模型；每个模型最多重试 3 次。
5. 不会长期停在「正在分类」：后台任务带 70 秒看门狗，任务自身失败（写库被回滚等）也会按本地规则给流水结论；迟到的分类结果不会覆盖已完成的结论。
6. 重启恢复：服务启动时 `resumePendingClassifications()` 把未分完的流水重新排队（未配置分类器时直接按本地规则归类，认不出来才标 `failed`），同时把更早构建遗留的「已完成 + other」卡消费按本地规则就地修正。该恢复写库发生在**单元工作内**（`server/bank-api.mjs`），scoped 投影下缺了事务会启动即抛 `Scoped writes require an active database unit of work`。
7. 客户端轮询：`SpendPage` 在回执为 `pending` 时每 1.5 秒查一次交易详情，最多约 20 秒，完成后回填分类并停止。

## 网页交互

- 平台选择：预设 12 家 + 自由商家 2 张卡；卡片显示图标、名称、副标题（预设为「城市 · 商户编号」，自由商家为收单机构）。
- 选自由商家时出现「商户名称」输入（必填，2–40 字，未填时提交按钮禁用）。
- 「账单详情（可选）」按所选平台给出示例提示（如美团「店铺 · 商品，如：嗉泰面（大朗店）· 猪扒包」）。
- 金额支持 2 位小数与预设档位；超过单笔上限即时提示。
- 回执展示商户、账单详情、金额、分类（未配置分类器时直接显示规则分类；配置了分类器时显示「正在分类…」，超时或失败显示「分类器暂不可用」）、扣款后余额，并链接到交易详情与账单统计。
- 交易详情页「商品」行来自 `detail.merchantNote`。
- 链接直达并预选平台：`/spend?merchant=meituan` 或 `/spend#meituan`。

## 测试

```bash
node --import ./tools/ts-resolve-hook.mjs tools/check-spend.mjs   # 21 项
node tools/check-categorize.mjs                                   # 分类器契约
BANK_HTTP_TEST_DATABASE_URL=postgres://.../maneki_http_test node --test server/banking-http.test.mjs
```

`banking-http.test.mjs` 新增 `/api/cards/:id/spend` 与 `/api/cards/:id/activate` 的真实 HTTP 用例：扣款与余额守恒、卡渠道流水与详情、平台/金额/备注/所有权/锁定/寄送中/已换发拒绝且资金不变、单日限额累计、激活密码校验与重复激活；需要独立 PostgreSQL（库名 `maneki_http_test*`，测试会重建 schema）。

`check-spend` 覆盖：分类器接线（pending → done 回写）、余额守恒、按平台分类差异、账单详情去空白落库与默认摘要、自由商家（自定义/Stripe 收单、缺失/过短/换行拒绝）、锁定卡、未开线上支付、未知平台、零金额、超单笔上限、超单日限额（相对当日已用额构造，不受前序用例影响）、余额不足、卡激活（密码错拒绝、正确密码改为使用中、重复激活拒绝）。

## 部署

- 无独立服务：接口随 `server/` 发布，页面随 `app/dist` 发布；`shared/spend-platforms.mjs` 前后端共用，改动需同时发布两侧。
- 演示数据由 `BANK_ALLOW_DEMO_SEED=true` 允许首次播种；生产环境禁用。
- 运行时角色不得执行 DDL：`BANK_AUTO_MIGRATE=false`，schema 变更走 owner bootstrap。
