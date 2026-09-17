# 代码审查报告 · 招财猫银行（前端）

- 审查对象：`/home/bigguga/文档/招财猫Bank`（前端 `app/`，74 个 `.ts/.tsx`，15,233 行）
- 审查方式：**只读**。没有修改任何源码/配置，没有启动或重启 dev server，没有装依赖。
  除本文件外没有写任何文件。
- 审查时间：本次会话（仓库内两个文档在我审查期间还在变动，见 §9.4）

> 本报告与 `design/backend-handoff/API-CONTRACT.md` 的关系：那份文档是**面向后端的行为交接**，
> 已经把大量「mock 自身可疑 / README 与 mock 冲突 / 前端对后端的隐含假设」逐条记录了。
> 本报告**不重复它的结论**，只在 §3 里标注「已见该文档 §x，我复核确认」或「该文档漏了/说反了」。
> 这份报告的增量主要在**界面层**：重复代码、前端自己写死的业务知识、UI 侧的确定性 bug，
> 以及「这堆代码到底有没有劣化」的证据化判断。

---

## 0. 总体判断

**局部劣化，但没有烂掉；边界仍然干净，不需要一次大重构。**

- **没有劣化的部分（而且是这个项目最值钱的部分）**：契约层纪律很好 —— 组件层**零** `api/mock` 依赖、
  46 个接口方法在两套实现里一一对应、`Cents` 整数分全程一致、合规文案集中在 `lib/`、
  `tsc -b --noEmit` 与 `oxlint` 全绿、3 个不需要浏览器的检查（`check-bank-data` / `check-assets` /
  `check-card-bin`，共 8+2+17=27 项断言）我实跑**全过**。
  `README.md` 对反直觉写法的解释基本都能在代码里对上（§6 逐条核过）。
- **确实在劣化的部分**：界面层出现了明显的**复制粘贴块**（身份核验流程 3 份、步骤条 2 份、
  理财费用公式 3 份、演示密码 3 处），以及**前端替后端保管知识**（到账时间规则、日限额文案、
  演示验证码字段）。这类重复不会立刻报错，但正是「改一处漏三处」的来源。
- **不需要**推倒重来。需要的是 3 处定点清理 + 1 条防退化的静态检查（§8）。

严重程度定义：

| 级别 | 含义 |
| --- | --- |
| 🔴 P0 | 切 `VITE_USE_MOCK=false` 后**确定会坏**（界面显示错东西 / 后端照现有文档实现会漏接口） |
| 🟠 P1 | 现在就有 bug，或界面在说谎（与实现/契约不一致） |
| 🟡 P2 | 重复的「知识」与复制粘贴，随迭代失真，维护成本 |
| 🔵 P3 | 死代码、可读性、a11y、文档漂移，锦上添花 |

---

## 1. 先回答「有没有真的在劣化」

### 1.1 体量：增长集中在 5 个文件，不是全面膨胀

```
$ find app/src -name '*.ts' -o -name '*.tsx' | xargs wc -l | sort -rn | head
 1728 app/src/api/mock/index.ts
 1504 app/src/api/mock/db.ts
 1202 app/src/pages/TransferPage.tsx
  997 app/src/api/types.ts
  583 app/src/pages/OpenAccountPage.tsx
  504 app/src/pages/SecurityPage.tsx
  499 app/src/pages/CardsPage.tsx
  464 app/src/pages/WealthPage.tsx
  462 app/src/pages/DashboardPage.tsx
  458 app/src/components/wealth/ProductDetailModal.tsx
```

分目录：`api/` 4,990（其中 `api/mock/` 3,621）、`pages/` 4,950、`components/` 4,427、`lib/` 717、`store/` 74。
`lib/` 和 `store/` 非常克制，说明「抽公共逻辑」这件事一直在做（`useAsync`、`useReveal`、`clipboard`、
`csv`、`download`、`wealth`、`account-opening`、`receiving` 都是后来抽出来的，README 里也有记录）。

### 1.2 单函数体积是本次最明显的结构信号

用括号配平做的启发式统计（脚本见 §9.1）：

| 函数 | 位置 | 行数 |
| --- | --- | --- |
| `createMockApi()` | `api/mock/index.ts:499-1729` | **1231** |
| `TransferPage()` | `pages/TransferPage.tsx:67-1137` | **1071** |
| `OpenAccountFlow()` | `pages/OpenAccountPage.tsx:52-549` | 498 |
| `ProductDetailModal()` | `components/wealth/ProductDetailModal.tsx:36-458` | 423 |
| `WealthPage()` | `pages/WealthPage.tsx:48-464` | 417 |
| `WealthAccountOpeningModal()` | `components/wealth/WealthAccountOpeningModal.tsx:38-410` | 373 |
| `CardsPage()` | `pages/CardsPage.tsx:45-373` | 329 |
| `seed()` | `api/mock/db.ts:1206-1477` | 272 |

要公平地说：大的那三个**主要是 JSX 的体量**，不是逻辑密度高。

- `TransferPage` 的 1071 行里，`return (` 出现在 512 行 —— 逻辑约 440 行（含注释），标记约 620 行。
- `createMockApi` 的 1231 行是 46 个方法平铺在一个对象字面量里 —— **这不是复杂度问题，是分组问题**。
  它是「一个文件承载了整个后端」，但它同时被 README §7 和 `tools/check-*.mjs` 当作行为规范来读，
  所以拆成 `mock/transfers.ts` / `mock/cards.ts` / `mock/wealth.ts` 收益有限、风险不小（工具会跟着改）。
  我**不建议**现在拆它。

真正值得动的是 `TransferPage`：它是唯一一个「三种步骤 + 两个通道 × 四种汇款方式 + 卡 BIN 识别 +
换汇锁价倒计时 + 大额二次确认」全塞在一个组件里的地方，下面 §6.1 的重复、§5 的 `?q=` 类问题都出在这种体量上。

### 1.3 结论

**没有「写崩」，但有 4 类明确的复制粘贴块和 4 处前端越界持有后端知识。** 见 §4、§3。

---

## 2. 前后端边界：先给结论

逐条回答你问的四件事。

### 2.1 有没有 UI / 页面代码直接 import `api/mock/`？

**没有。** 全仓库只有一处 import 到 mock：

```
$ grep -rn "api/mock\|from './mock'\|mock/" app/src --include=*.ts --include=*.tsx | grep -v "^app/src/api/mock/"
app/src/api/index.ts:3:import { createMockApi } from './mock'
```

`api/index.ts` 是切换点（第 11-15 行），这是设计本身。页面/组件/stor 全部只 `import { api } from '@/api'`。

**但有 3 处「不 import 也等于依赖 mock」的间接耦合**，真后端一接就会出问题：

| # | 位置 | 依赖了什么 |
| --- | --- | --- |
| 1 | `pages/TransferPage.tsx:81` | 默认选中银行的代码 `CN: 'LCB'` —— 这是 mock 内部虚构机构代码，不是契约概念 |
| 2 | `pages/TransferPage.tsx:243` | `activeBankCode === 'LCB' ? '实时到账' : …` —— 把后端的到账时间规则抄了一份到 UI |
| 3 | `pages/SupportPage.tsx:31,50` | 直接读写 mock 的存储键 `STORAGE_KEYS.supportHistory`（与 `api/mock/index.ts:1712` 是同一个 key） |

详见 §3.2 / §3.3。

### 2.2 `BankApi` 这个接口面够不够支撑真后端？

**形状够，语义上有几个洞。**

- `BankApi` 共 **46** 个方法（`contract.ts:131-215`），`createHttpApi` 实现 46 个、`createMockApi` 实现 46 个，
  一一对应（TS 会强制，实跑 `tsc -b --noEmit` exit 0）。没有「只在一侧实现」的接口方法。
- `routes` 共 **47** 个键，其中 46 个被 `http.ts` 使用；唯一没用的是 `routes.card`（`contract.ts:91`
  → `GET /api/cards/:id`）：没有对应方法、没有任何调用 —— 遗留定义。（API-CONTRACT §6.1 已记录。）
- 缺的是**语义槽位**，不是方法：幂等键、换汇锁价票据、Ⅱ/Ⅲ 类户超限错误码、token 过期语义、
  `deposit` 的 `channel` 还是个裸 `string`（`contract.ts:147`）。这些 API-CONTRACT §8.1 已列全，
  我不重复，只补一条它没写的：

  **`SmsCodeResult.demoCode` 是契约里的必填字段，而它是纯 mock 概念** —— 见 §3.1（🔴）。

### 2.3 `types.ts` 有没有混进 UI 概念？

有，5 处。轻重不同：

| 位置 | 混进来的东西 | 判断 |
| --- | --- | --- |
| `types.ts:466,500,546` | `CardTheme = 'ink' \| 'gold'`（卡面主题） | 🟡 **设计 token 名进了契约**。`CardsPage.tsx:392` 直接 `card.theme === 'ink'` 决定黑底/金底。真后端不可能知道「ink」是什么；新增一种卡面 = 前后端同时改 |
| `types.ts:666` | `SupportMessage.actions[].to` | 🟡 **前端路由字符串**（`'/transfer'`、`'/cards'`…）。后端要记住 SPA 的路由表。建议改成 action 语义 id（`'goto-transfer'`），路由映射留在前端 |
| `types.ts:19`（数据在 `db.ts:1256`） | `User.avatarInitial` | 🔵 纯展示派生值（名字首字），后端得替 UI 算这个字。`Sidebar.tsx:149` 用它，缺省是 `'喵'` |
| `types.ts:245,254` | `Bank.color` / `Bank.logo` | 🔵 有意为之（README §11 明确：行标本地托管、真后端换 URL；color 只用于行标加载失败时的色块兜底，且注明「近似值」）。可接受，但属于「后端提供展示素材」 |
| `types.ts:647` | `SecurityLog.level: 'info' \| 'warn'` | 🔵 语义上算严重级别，前端拿它决定小红点/圆点颜色（`TopBar.tsx:63-65`、`SecurityPage.tsx:219-221`）。可接受 |

反过来（前端独有的东西漏进契约）就是 `demoCode` 与 `CardTheme` 这两条。

### 2.4 `http.ts` 与 mock 的行为一致性

- **没有哪条路由只在一边实现**：`contract.ts` 的 46 个方法两边都在，`http.ts` 只做「路径 + 方法 + JSON」薄映射。
- **路径表两边没有真正共用**：`contract.ts:57` 的注释写着

  > `/** 与后端约定的 REST 路径表，mock 与 http 共用，保证两边不跑偏 */`

  但 `routes` **只被 `http.ts` 引用**，`api/mock/` 里一次都没出现（mock 不走 HTTP，直接返回对象）。
  这条注释与实际不符 → 「两边不跑偏」这句话目前**没有任何机制保障**。🟡（改法见 §8.1）
- **行为差异清单**：API-CONTRACT §6.3 的 24 条我抽查了 6 条，5 条与代码一致（`logout` 重置演示库、
  `login` 手机号正则比 `sendSmsCode` 松、`verifyIdentity` 票据不校验、`quoteTransfer` 静默回退
  `accounts[0]`、`TransferResult.referenceNo` 与台账号不同），**1 条与实测不符** —— 见 §9.4。

---

## 3. 阻断接入真后端 / 会出 bug（P0–P1）

每条格式：现象 → 证据 → 影响 → 建议改法。

### 3.1 🔴 P0 `demoCode` 是必填字段，真后端下界面会出现「演示环境验证码：undefined」

**现象**：契约把「演示环境才有的验证码回传」写成了必填字段，前端三处**无条件**把它拼进文案。

**证据**

```ts
// app/src/api/types.ts:913-921
export interface SmsCodeResult {
  sent: boolean
  expiresAt: string
  /**
   * 仅演示环境返回验证码 —— 真实后端**绝不会**把它下发给前端。
   * 有这个字段才能在纯前端演示里走通流程，所以明确标注出来。
   */
  demoCode: string          // ← 必填，但语义上只属于演示环境
}
```

```ts
// app/src/pages/OpenAccountPage.tsx:96
setSmsHint(`演示环境验证码：${res.demoCode}（5 分钟内有效）`)
// app/src/pages/SecurityPage.tsx:391
setSmsHint(`演示环境验证码：${res.demoCode}`)
// app/src/components/wealth/WealthAccountOpeningModal.tsx:91
setSmsHint(`演示环境验证码：${res.demoCode}`)
```

三处 hint 最终都渲染到界面上（`OpenAccountPage.tsx:366`、`SecurityPage.tsx:477`、
`WealthAccountOpeningModal.tsx:256` 的 `hint={smsHint ?? …}`）。

**影响**：`VITE_USE_MOCK=false` 后，开户 / 开理财户 / 换手机号三条流程的验证码提示会显示成
「演示环境验证码：undefined」。另外「演示环境」这四个字出现在生产界面本身也是错的。

**顺带纠正**：`design/backend-handoff/API-CONTRACT.md`（我审查时的版本，第 205、2709 行）写的是
「字段必须存在（前端只是展示，不做判空）」「缺失不会崩」。不崩是对的，但**会显示 undefined**，
所以结论不能停在「不会崩」。

**建议改法**（契约降级为可选 + 三处判空）

```ts
// types.ts
export interface SmsCodeResult {
  sent: boolean
  expiresAt: string
  /** 仅演示环境返回；真后端不下发此字段 */
  demoCode?: string
}
```

```tsx
// 三处统一改成：没有就不出这一行
const demoHint = res.demoCode ? `演示环境验证码：${res.demoCode}` : null
setSmsHint(demoHint)
```

---

### 3.2 🟠 P1 前端把后端的「到账时间」规则抄了一份，并用 mock 的内部代码判断

**现象**：`TransferPage` 里有一份 `etaText` 的兜底实现，规则与 mock 里那份重复，
且用 `'LCB'` 这个**虚构机构的内部代码**做分支。

**证据**

```ts
// app/src/pages/TransferPage.tsx:237-245
const etaText =
  quote?.etaText ??
  (isFps
    ? '预计 5 秒内到账'
    : scope === 'overseas'
      ? '预计 1 个工作日到账'
      : activeBankCode === 'LCB'      // ← 写死 mock 的内部代码
        ? '实时到账'
        : '预计 2 小时内到账')
```

```ts
// app/src/api/mock/index.ts:774-780  ← 后端那份（同一规则的第二份实现）
const etaText = isFps
  ? '预计 5 秒内到账'
  : req.scope === 'overseas'
    ? '预计 1 个工作日到账'
    : bank?.code === 'LCB'
      ? '实时到账'
      : '预计 2 小时内到账'
```

而 `types.ts:265-271` 自己写着这条规则不该这么写：

```ts
/**
 * 本行（虚构机构，不占用真实行别代码与卡号号段）。
 * …这个标记是给界面判断用的，不写死在代码里比 code === 'LCB' 清楚。
 */
internal?: boolean
```

**影响**：① 真后端的本行清算代码如果不是 `'LCB'`（虚构机构本来就该由后端定代码），
界面在报价还没回来时会显示「预计 2 小时内到账」；② 到账时间规则改一次要改两处；
③ 与 README §11「所有查找走 `findBank(banks, code, region)`，禁止裸 code 比较」相矛盾。
（API-CONTRACT §8 Q54 记了 mock 那一侧的裸比较，**没记 UI 这一侧**。）

**建议改法**：`etaText` 兜底整段删掉，报价没回来时显示占位符，不要自己算规则：

```tsx
const etaText = quote?.etaText ?? '—'
```

若必须保留本地兜底（例如金额为 0 时不询价），就用名录里的标记而不是代码：

```tsx
: selectedBank?.internal
  ? '实时到账'
  : '预计 2 小时内到账'
```

### 3.3 🟠 P1 前端默认选中「本行的内部代码」，并直接读写 mock 的存储键

**(a) 默认选中 `'LCB'`**

```ts
// app/src/pages/TransferPage.tsx:80-83
const [bankSelection, setBankSelection] = useState<Record<BankRegion, string>>({
  CN: 'LCB',   // ← 这是 mock 里的内部代码（api/mock/db.ts:1065）
  HK: '012',
})
```

**影响**：真后端若不返回 code 为 `'LCB'` 的机构，`selectedBank` 为 `null`（`TransferPage.tsx:221-225`
按 `(code, region)` 查），界面表现为「收款银行：请选择」+ 摘要里的收款银行是「—」，
但转账按钮仍可点 —— 属于「静默失效」。

**建议改法**：默认值改为「不预选」，或从名录里取 `internal === true` 的那一条：

```ts
const [bankSelection, setBankSelection] = useState<Record<BankRegion, string>>({ CN: '', HK: '' })
// 或者在 banks 到位后： banks.find(b => b.region === 'CN' && b.internal)
```

**(b) 页面直接读写 mock 的存储键**

```ts
// app/src/pages/SupportPage.tsx:31
const [messages, setMessages] = useState<SupportMessage[]>(() =>
  storage.get<SupportMessage[]>(STORAGE_KEYS.supportHistory, []),
)
// app/src/pages/SupportPage.tsx:46-53
useEffect(() => {
  if (messages.length > 0) return          // ← 本地有缓存就永远不再问后端
  void api.listSupportMessages().then(setMessages)
}, [messages.length])
useEffect(() => {
  if (messages.length) storage.set(STORAGE_KEYS.supportHistory, messages)   // ← 写的是后端的 key
}, [messages])
```

而 mock 那侧读的是同一个 key：

```ts
// app/src/api/mock/index.ts:1712
const history = storage.get<SupportMessage[] | null>(STORAGE_KEYS.supportHistory, null)
```

**影响**：接真后端后，客服历史仍然由**前端本地缓存**决定：只要 localStorage 里有记录，
`GET /api/support/messages` 就不会被调用；服务端的历史永远看不到；换台设备才「恢复」。
这是「UI 帮后端保管状态」，属于边界污染（API-CONTRACT §8 Q26 只提到「mock 存 localStorage、
服务端不落库」，没指出前端这一侧在写同一个 key）。

**建议改法**：页面不再落库，直接以后端为准：

```tsx
const messages = useAsync(() => api.listSupportMessages(), [])   // 用现成的 SWR hook
// 发送成功后 messages.reload()，不在本地做「history.length > 0 就不拉」的判断
```

### 3.4 🟠 P1 理财「绑定的资金账户」被忽略（界面明确让用户选，后端不看）

**现象**：开理财账户时用户**必须选一个资金账户**，界面三处承诺申赎都走它；实现里一律用 `accounts[0]`。

**证据**

写入（`openWealthAccount`，校验并落库）：

```ts
// app/src/api/mock/index.ts:1294-1305
const settlement = db.accounts.find((a) => a.id === req.settlementAccountId)
if (!settlement) throw new ApiError('请选择资金账户', 400, 'SETTLEMENT_REQUIRED')
…
db.wealthAccount = { opened: true, …, settlementAccountId: settlement.id, … }
```

读取：**没有**。全仓库 `settlementAccountId` 只出现在「写入」和「展示选择」两处：

```
$ grep -rn "settlementAccountId\|settlementId" app/src
api/mock/index.ts:1294   ← 校验
api/mock/index.ts:1303   ← 写入
api/mock/db.ts:1364      ← 种子空值
api/types.ts:967,981     ← 类型
components/wealth/WealthAccountOpeningModal.tsx:70,121,134,168,318  ← 让用户选
```

真正扣钱/入账的地方用的是第 0 个账户：

```ts
// app/src/api/mock/index.ts:1348（subscribeWealth 申购扣款）
const account = db.accounts[0]
// app/src/api/mock/index.ts:1479（redeemWealth 赎回到账）
const account = db.accounts[0]
```

而界面对用户的三处承诺是：

```tsx
// app/src/pages/WealthPage.tsx:103-105
银行账户是装钱的地方，理财账户才是买理财的资格。
理财账户不装钱，它把「你」和理财公司之间的委托关系立起来，
申购扣款与赎回到账都走你指定的资金账户。
// app/src/components/wealth/WealthAccountOpeningModal.tsx:313-314
申购扣款、赎回退款都走这个账户。理财账户本身不装钱。
// app/src/components/wealth/RedeemModal.tsx:117
款项将划入你申购时使用的活期账户。
```

**影响**：用户在弹层里选「储蓄账户」或「定期存款」（种子里 `available` 分别是 5,600,000 和 **0**），
点确认后钱从**活期账户**扣。申购还只是「扣错账户」，定期存款那条更糟：
界面暗示会从定期户出钱（余额 0，按理该失败），实际却从活期扣成功。

API-CONTRACT §6.3 #13 / §8 Q15 记的是**赎回**那一侧；**申购那一侧（`index.ts:1348`）也漏了**，
而且「界面让用户选一个后端不用的账户」这件事是这次审查新加的。

**建议改法**（两条路，选一条并让两侧一致）

```ts
// 路线 A（推荐，符合 README §16）：认账本上那个账户
const account = db.accounts.find((a) => a.id === db.wealthAccount.settlementAccountId)
if (!account) throw new ApiError('资金账户不可用，请重新开立理财账户', 409, 'SETTLEMENT_MISSING')
```

```tsx
// 路线 B：UI 不给选，明确写死「从活期账户扣款」
// 但那样 WealthAccountOpeningModal 的「选择资金账户」整块要删掉，types 里的字段也要删
```

选 A 时别忘了 API-CONTRACT §8 Q15 提的另一半：`WealthHolding` 要记申购账户，
否则赎回时不知道退回哪里。

### 3.5 🟠 P1 `/accounts/open` 是一条死链，且 `OpenAccountFlow` 有一整段不可达 UI

**现象**：银行卡页有两处链到 `/accounts/open`，但路由表里**没有**这条路由。

**证据**

```tsx
// app/src/pages/CardsPage.tsx:143
<Link to="/accounts/open" className="mx-0.5 font-medium text-gold-deep hover:text-ink">账户</Link>
// app/src/pages/CardsPage.tsx:172
<Link to="/accounts/open"><Button>去开立账户</Button></Link>
```

```tsx
// app/src/App.tsx:35-56 —— 路由全表（公开 2 条 + 应用内 8 条 + 兜底），没有 /accounts/open
<Route path="/login" element={<LoginRoute />} />
<Route path="/open-account" element={<OpenAccountStandalone />} />
<Route element={<RequireAuth><AppShell /></RequireAuth>}>
  <Route path="/" … />
  <Route path="/transactions/:id" … />
  <Route path="/transfer" … />
  <Route path="/cards" … />
  <Route path="/analysis" … />
  <Route path="/wealth" … />
  <Route path="/security" … />
  <Route path="/support" … />
</Route>
<Route path="*" element={<Navigate to="/" replace />} />
```

**影响**：点「账户」/「去开立账户」→ 命中 `path="*"` → **静默跳回首页**（没有报错、没有 404 提示）。
同时 `OpenAccountFlow` 的 `standalone=false` 分支（`OpenAccountPage.tsx:525-537` 的
「返回总览 / 去申请银行卡 / 去转入资金」）**永远渲染不到**：这个组件没有被 export
（只有 `OpenAccountStandalone` 在第 565 行被 export），也没有任何路由能传 `standalone={false}`。

**两份文档都以为它存在**（这正是它一直没被发现的原因）：

- `README.md:872-877` 的表格：「`/accounts/open`（需登录）｜已有客户：再开一个 Ⅱ / Ⅲ 类户」
- `design/backend-handoff/API-CONTRACT.md:944`：「`/open-account` 公开整页，`/accounts/open` 需登录；
  差别只是手机号能否编辑」

README §16.3 又说「侧栏不再有『开户』项」（与 `Sidebar.tsx:19-27` 的 `NAV` 一致），
所以这条路由是在某次「清理入口混乱」时被摘掉的，但 `CardsPage` 的两个链接留下来了。
`grep -rn "accounts/open" tools/` 为空 —— 没有任何检查覆盖它。

**建议改法**：先决定这个场景还要不要。

```tsx
// 方案 1（推荐，成本最低）：删掉「存量客户加开账户」这个场景
//   · CardsPage 两处 Link 改成 /open-account，或改成一句说明文案
//   · OpenAccountPage 删掉 standalone 开关，只保留 OpenAccountStandalone
//   · README §15.2 的表格与 API-CONTRACT:944 一起改掉

// 方案 2：恢复这条路由（注意 App.tsx 里 /open-account 是公开整页，两者不能共用同一个 element）
<Route path="/accounts/open" element={<OpenAccountStandalone />} />   // ← 但这样又回到整页布局
```

无论选哪个，`OpenAccountFlow` 里那段不可达的 JSX 都该删掉 —— 留着比删掉更贵（下次读代码的人会以为它活着）。

### 3.6 🟠 P1 顶栏全局搜索在「已经停在消费分析页」时失效

**现象**：`AnalysisPage` 只在**挂载**时读一次 `?q=`，之后 URL 再变也不理。

**证据**

```tsx
// app/src/pages/AnalysisPage.tsx:37-39
// 顶栏全局搜索会带上 ?q=，这里直接接管
const [searchParams] = useSearchParams()
const [keyword, setKeyword] = useState(() => searchParams.get('q') ?? '')
```

```tsx
// app/src/components/layout/TopBar.tsx:20-23
onSubmit={(e) => {
  e.preventDefault()
  navigate(keyword.trim() ? `/analysis?q=${encodeURIComponent(keyword.trim())}` : '/analysis')
}}
```

`useState` 的初始化函数只跑一次；从 `/analysis?q=a` 导航到 `/analysis?q=b` 时
React Router **不会重新挂载** `AnalysisPage`（同一个 element），`ScrollToTop`
又只认 `pathname`（`ScrollToTop.tsx:154-159`），所以没有任何东西会同步这个 state。

**影响**：已经在「消费分析」页时用顶栏搜第二遍 —— 地址栏变成 `?q=新词`，
列表却还按**上一个**关键词过滤（或显示全部）。用户看到的是「搜索不生效」。

**建议改法**：把它变成派生值，别用 state 复制 URL：

```tsx
const [searchParams, setSearchParams] = useSearchParams()
const keyword = searchParams.get('q') ?? ''
// 输入框里改词时不要直接 setKeyword，而是改完 URL（保持「URL 是唯一事实来源」）
const setKeyword = (next: string) => {
  setSearchParams((prev) => {
    const params = new URLSearchParams(prev)
    if (next) params.set('q', next)
    else params.delete('q')
    return params
  }, { replace: true })
}
```

### 3.7 🟠 P1 安全中心无条件写「实名身份已核验」

```tsx
// app/src/pages/SecurityPage.tsx:99-103
<ul className="mt-6 flex flex-col gap-3 text-[13px] text-ink-soft">
  <li className="flex items-center gap-2">
    <CheckIcon size={16} className="text-blue" />
    实名身份已核验                                  {/* ← 硬编码，从不看字段 */}
  </li>
```

而接口是给这个字段的，安全评分也在用它：

```ts
// app/src/api/types.ts:654
identityVerified: boolean
// app/src/api/mock/index.ts:197
60 + (db.security.identityVerified ? 12 : 0) + enabledRules * 6
```

**影响**：`identityVerified === false` 时，界面仍显示「已核验」+ 一个勾。
（API-CONTRACT §8 Q29 记了「种子恒为 true」，没记界面这一侧根本不读字段。）

**建议改法**

```tsx
<li className="flex items-center gap-2">
  {overview.data?.identityVerified
    ? <><CheckIcon size={16} className="text-blue" />实名身份已核验</>
    : <><AlertIcon size={16} className="text-coral" />尚未完成实名核验</>}
</li>
```

### 3.8 🟡 P2 客服话术与实现/界面互相矛盾（同一事实三处不一致）

| 事实 | 客服话术（后端） | 实现/界面 | 结论 |
| --- | --- | --- | --- |
| 新卡默认单日限额 | `api/mock/index.ts:361`「借记卡默认单日限额 ¥50,000.00」 | `index.ts:1023` 新卡发 `dailyLimit: 200_000`（¥2,000）；种子卡是 `5_000_000` / `2_000_000`（`db.ts:1391,1406`） | 三处数字，各不相同 |
| 调高限额要不要核身 | `index.ts:361`「调高限额需要身份认证」 | `CardsPage.tsx:311-332` 点一下直接改，无任何核验；`index.ts:1123-1131` 也不校验 | 话术在描述一个不存在的功能 |
| 密码怎么存 | `SecurityPage.tsx:152`「密码使用银行级加密存储」 | `db.ts:1258` `password: '123456'`、`db.ts:662` `payPassword: '888888'`，明文进 localStorage | 与 README §8「支付密码在演示库里是明文」直接冲突 |
| 单笔上限 | `DashboardPage.tsx:392` `hint="单笔上限 ¥50,000.00"` | `index.ts:664` `if (amount > 5_000_000)` | 同一常量写了两份（UI 里那份会漂移） |

**影响**：这四条都属于「界面上写着、实现里没有」。
比赛演示时被问到「调高限额要核身，怎么没核身」会很难答。

**建议改法**：话术里的数字尽量从常量插值；做不到时（话术是后端下发的固定文案），
把「需要身份认证」这句删掉或补上功能。界面里的 `¥50,000.00` 应该来自接口
（`deposit` 侧没有策略接口，最小改法是让 `quote`/常量集中在 `lib/` 一处）。

---

## 4. 重复的「知识」：这是最像「石山」的部分

### 4.1 🟡 P2 身份核验流程被复制了三份（约 500 行）

三处各自实现「姓名 + 身份证 + 短信验证码（60 秒倒计时）+ 人脸核身」：

| 位置 | 用例 |
| --- | --- |
| `pages/OpenAccountPage.tsx:322-404` | 开银行账户 |
| `pages/SecurityPage.tsx:461-489` | 换登录手机号 |
| `components/wealth/WealthAccountOpeningModal.tsx:232-284` | 开理财账户 |

复制的不只是 JSX，是**四份逻辑**：

```ts
// ① 倒计时 effect —— 三份逐字相同
// OpenAccountPage.tsx:84-88 / SecurityPage.tsx:362-366 / WealthAccountOpeningModal.tsx:80-84
const counting = cooldown > 0
useEffect(() => {
  if (!counting) return
  const timer = setInterval(() => setCooldown((v) => (v <= 1 ? 0 : v - 1)), 1000)
  return () => clearInterval(timer)
}, [counting])

// ② sendCode —— 三份只差一个提示文案
// OpenAccountPage.tsx:90-101 / SecurityPage.tsx:385-396 / WealthAccountOpeningModal.tsx:86-96
const res = await api.sendSmsCode(phone)
setCooldown(60)
setSmsHint(`演示环境验证码：${res.demoCode}`)

// ③ scanFace —— 三份逐字相同
// OpenAccountPage.tsx:103-116 / SecurityPage.tsx:371-383 / WealthAccountOpeningModal.tsx:98-110
const { ticket } = await api.verifyIdentity('face')
setFaceTicket(ticket)

// ④ 演示身份证号 —— 两份，常量各写一遍
// OpenAccountPage.tsx:42
const DEMO_ID = '310101199001011234'
// WealthAccountOpeningModal.tsx:23
const DEMO_ID = '310101199001011234'
```

**风险**：这三条流程都有合规含义（README §14、§18.3）。改一处 = 另外两处静默保留旧行为。
比如「验证码一次性 / 5 分钟过期」是服务端的，但「倒计时 60 秒」「验证码发往**新**号」
（`SecurityPage.tsx:389`）这类界面承诺是本地实现的，很容易改漏。

**建议改法**：抽一个 `components/identity/IdentityVerifyFields.tsx`（受控组件）+
`lib/useSmsCooldown.ts` + 把 `DEMO_ID` 放到 `lib/`（它现在和 mock 的身份证正则
`/^\d{17}[\dXx]$/`（`index.ts:1170`）是一对，属于同一份「演示约定」知识）。

```tsx
// 目标形态：三处调用点各自只关心「我拿到 faceTicket 和 smsCode 之后做什么」
<IdentityVerifyFields
  phone={phone}
  phoneEditable={!user}
  value={{ holderName, idNumber, smsCode, faceTicket }}
  onChange={patch}
  onFaceVerified={(ticket) => setFaceTicket(ticket)}
/>
```

### 4.2 🟡 P2 步骤条 JSX 复制了两份（几乎是逐字节相同）

```tsx
// app/src/pages/TransferPage.tsx:542-567  与  app/src/pages/OpenAccountPage.tsx:152-175
<ol className="float-up flex items-center gap-3">
  {STEPS.map((s, index) => {
    const active = step === s.id
    const done = step > s.id
    …
```

```
$ diff <(sed -n '542,567p' app/src/pages/TransferPage.tsx) <(sed -n '152,175p' app/src/pages/OpenAccountPage.tsx)
20,22c20
<               {index < STEPS.length - 1 && (
<                 <span className="h-px flex-1 bg-line" aria-hidden="true" />
<               )}
---
>               {index < STEPS.length - 1 && <span className="h-px flex-1 bg-line" aria-hidden="true" />}
```

差异只有一处**换行**。加上各自的 `type Step` 与 `STEPS` 常量（`TransferPage.tsx:52-58`、
`OpenAccountPage.tsx:27-33`），以及 `WealthAccountOpeningModal.tsx:183-211` 里**第三份**
缩小版步骤条。三处样式已经在漂移（第三份是 `size-6 text-[11px]`，前两份是 `size-9 text-[14px]`）。

**建议**：抽 `components/ui/Stepper.tsx`：

```tsx
<Stepper steps={STEPS} current={step} size="lg" />
```

### 4.3 🟡 P2 理财费用/份额公式存在三份

```ts
// ① 后端（api/mock/index.ts:265-273）
function oneOffFee(product, amount, kind) {
  const item = product.transactionFees.find((f) => f.label.startsWith(kind))
  if (!item || item.rate === 0) return { fee: 0, label: '免费' }
  return { fee: Math.round(amount * item.rate), label: item.label }
}
// ② 申购预览（components/wealth/ProductDetailModal.tsx:65-67）
const feeItem = product.transactionFees.find((f) => f.label.startsWith('申购'))
const fee = feeItem ? Math.round(amount * feeItem.rate) : 0
const estimatedShares = amount > 0 ? (amount - fee) / product.nav : 0
// ③ 赎回预览（components/wealth/RedeemModal.tsx:35-38）
const gross = Math.round((Number.isFinite(shares) ? shares : 0) * product.nav)
const feeItem = product.transactionFees.find((f) => f.label.startsWith('赎回'))
const fee = feeItem ? Math.round(gross * feeItem.rate) : 0
const net = Math.max(0, gross - fee)
```

并且与后端真正算钱的地方也要对上：

```ts
// api/mock/index.ts:1395-1397（申购）
const { fee } = oneOffFee(product, req.amount, '申购')
const netAmount = req.amount - fee
const shares = Number((netAmount / product.nav).toFixed(2))
```

**风险**：份额缩进位数（后端 `toFixed(2)` 后转数字 → 前端 `.toFixed(2)` 展示）与
`Math.max(0, …)` 这类差异，会让「预计确认份额」与确认页的真实份额不一致。
监管文案要求「及时告知确认份额和金额」，两处不一致是要解释的。

**建议**：把费用与份额的**计算**交给后端（预览也走一次接口，或让 `WealthQuote` 成为接口的一部分），
前端只展示。最小改法：把 `oneOffFee`/份额换算放到 `lib/wealth.ts`，两边 import 同一份
（这才是 `lib/` 的既有用法，例如 `validateAddress`、`ACCOUNT_OPENING_PLEDGE` 就是这么做的）。

### 4.4 🟡 P2 演示口令/演示身份写死在多处，唯一来源是 mock

```
$ grep -rn "888888" app/src
app/src/api/mock/db.ts:662:export const DEFAULT_PAY_PASSWORD = '888888'   ← 唯一来源
app/src/components/cards/CardApplicationModal.tsx:304:  演示环境支付密码为 888888。
app/src/components/cards/CardSecretsModal.tsx:85:       演示环境支付密码为 888888。
app/src/components/wealth/ProductDetailModal.tsx:402:   演示环境支付密码为 888888，连续输错 3 次会锁定。
```

`DEFAULT_PAY_PASSWORD` 已经是 export（`db.ts:662`），但三处 UI 没有 import 它，而是又抄了一遍。
同理 `DEMO_ID`（§4.1 ④）与登录页的 `123456`（`LoginPage.tsx:16,110`、`SecurityPage.tsx:290`
vs `db.ts:1258`）。

**风险**：这三个值是**演示的入口条件**，改一个忘一处 = 演示当场失败。

**建议**：UI 一律 import 常量（`import { DEFAULT_PAY_PASSWORD } from '@/api/mock/db'`
会破坏边界 —— 更好的做法是把这三个演示常量上移到 `lib/demo.ts`，mock 从 `lib` 读，
UI 也从 `lib` 读）。这样也顺手修掉了 §2.1 里「UI 不依赖 mock」的唯一缺口。

### 4.5 🟡 P2 其它「同一事实写两份」的清单（每条都可在 5 分钟内清理）

| 事实 | 第一份 | 第二份 |
| --- | --- | --- |
| 银行卡号脱敏 | `lib/account.ts:38-42` `maskBankAccount` | `lib/format.ts:113-117` `maskAccountNo`（实现几乎逐字相同，只差 `digitsOnly` vs `replace(/\s/g,'')`） |
| 汇款方式标签 4 条 | `lib/account.ts:46-51` `FPS_METHOD_LABEL` | `pages/TransferPage.tsx:60-65` `FPS_METHODS`（`收款账户/手机号/电邮/FPS ID` 各写一遍） |
| 交易分类中文标签 | `lib/categories.ts:3-12` `CATEGORY_LABEL` | `api/mock/index.ts:1546` 用同一张表生成 `SpendingCategory.label` 下发给前端 → 同一句话两端各存一份 |
| 凭证/导出字段口径 | `pages/TransactionDetailPage.tsx:289-351` `rowsOf()` 决定显示哪些字段及标签 | `api/mock/index.ts:479-495` `EXPORT_COLUMNS`（15 列，另一套标签与顺序）。README §10.2 说「导出哪些字段是银行的账务口径，不是前端的展示选择」—— 但详情页的展示口径也是前端自己定的 |
| 单笔上限文案 | `api/mock/index.ts:124`（`5_000_000`，权威） | `pages/DashboardPage.tsx:392`「单笔上限 ¥50,000.00」 |
| 存款利率 | `api/mock/db.ts:1220,1232,1244` + `index.ts:1214` 开户时再算一遍 | `api/mock/index.ts:381` 客服话术「0.30% / 1.55% / 2.10%」、`pages/OpenAccountPage.tsx:38`「年化 1.55%」 |
| 「6 题」 | `api/mock/db.ts:961-1022`（`RISK_QUESTIONS` 的长度） | `pages/WealthPage.tsx:234`「开始评估（6 题）」 |
| 「近 30 个交易日」 | `api/mock/db.ts` 的 `navHistory` 实际长度 | `components/wealth/ProductDetailModal.tsx:220` 写死文案 |
| 「内地 19 家银行」 | `api/mock/bin-table.ts` 实际条数 | `pages/TransferPage.tsx:327` 写死文案（API-CONTRACT §8 Q24 已记） |
| 账户类别限额文案 | `api/mock/db.ts:613-655` `ACCOUNT_TIERS` | `pages/OpenAccountPage.tsx:36-40` `CHOICES` 的 blurb 又写了一遍「年化 1.55%」「余额不超 2000 元」 |

### 4.6 加一个新渠道 / 新市场 / 新卡种要改几处？

| 变更 | 需要动的地方 | 结论 |
| --- | --- | --- |
| **新增一种支付渠道**（如 `channel: 'wire'`） | `types.ts:173` 的 union；`TransferPage` 里 25 处 `isFps` 分支（`grep -c isFps` 见 §9.1）；`api/mock/index.ts` 里 12 处 `'fps'` 字面量 + `CHANNEL_NOTE`（`index.ts:137-140`）；`lib/account.ts` 的 FPS 常量；`canBuyRisk` 之类的无关处不用动 | 🟡 **确实是「改一处漏三处」的形状**：渠道不是一个对象/策略，而是一串布尔分支 |
| **新增一个市场**（如 `BankRegion` 加 `'MO'`） | `types.ts:227`；73 处 `'CN'`/`'HK'` 字面量（集中在 `TransferPage.tsx`、`api/mock/index.ts`、`api/mock/db.ts`）；`lib/bank.ts:7-10` 标签；`TransferPage.tsx:80-83` 的选择槽位与 `134` 的方向推导；`BankPicker` 的排序；`tools/check-bank-data.mjs` 的期望值 | 🟠 `TransferPage` 的两处是硬编码的二元结构（`Record<BankRegion,string>` 用了字面量 key，`effectiveScope === 'overseas' ? 'HK' : 'CN'`），加第三个市场必须改代码而不是加数据 |
| **新增一个卡种/卡面** | `types.ts:466` `CardTheme`；`CardsPage.tsx:392` 的 `theme === 'ink'` 二元分支；`components/brand/BrandMark.tsx`；`CARD_PRODUCTS`（数据） | 🟠 卡面主题是**设计 token 名**（§2.3），加一种配色要改前端。可接受，但要知道这是「前端决定」而不是「后端下发」 |

**没有**「新增一个理财产品」的问题 —— 那一条是纯数据（`WEALTH_PRODUCTS`），加一只只改 mock，这做得对。

---

## 5. 状态与副作用：这部分基本健康

我把所有 `useEffect`（22 处）、定时器与监听器都过了一遍，结论是**没有泄漏、没有竞态、
没有「该派生却 setState」**。列出证据，免得作者按「常见问题清单」白改：

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| 监听器/定时器清理 | 全部有 cleanup | `Modal.tsx:22-29`（keydown）、`TransferPage.tsx:178-181,218,299-302`、`CardsPage.tsx:85`、`SupportPage.tsx:42-46`；`Toast.tsx:32` 的 timeout 未清但不持有引用（只按 id 过滤），无需清 |
| effect 里同步 setState | **0 处**（lint 规则 `react(set-state-in-effect)` 也没报） | 唯一形似的是 `useAsync.ts:38-42`，但它在 effect 里是**设置状态机**（`loading/refreshing`），不是用 effect 派生值 —— 这是必需的，且注释解释了为什么（README §6①） |
| 该派生的用了 state | 没有；反过来做得很到位 | `TransferPage.tsx:264-268`（用「结果自带 key」代替 effect 清空）、`196-200`（倒计时在渲染期推导，`setState` 只在 interval 里）、`CardsPage.tsx:89-99`（过期即视为未解锁，读 `nowTick`） |
| 事件处理器里的 setState | 是（正确） | `CardsPage.tsx:93-99` `unlockCard`、`TransferPage.tsx:345-349` `selectBank` |
| 竞态（先发慢响应盖掉后发快响应） | 已处理 | `TransferPage.tsx:276-303`（卡 BIN：`cancelled` + 320ms 防抖 + 用 `key` 让结果自己失效）、`153-191`（询价：`cancelled` + 220ms 防抖）、`bankCodeRef`（`141-144`）避免「识别出银行 → 切银行 → 又查一次」 |
| 乐观更新与回滚 | 三处都正确 | `CardsPage.tsx:108-131`、`SecurityPage.tsx:39-54`、`AnalysisPage.tsx:58-69`；失败回滚到**点击前的快照**且弹提示 |
| 双重提交 | 已防 | `Button.tsx:47` `disabled={disabled \|\| loading}`；转账/申购路径都传 `loading={submitting}` |
| `useAsync` 的 `[...deps, nonce]` + eslint-disable | **不是问题** | `useAsync.ts:33-34` 把 `fn` 存进 ref、deps 由调用方声明；这是刻意的 API 设计，注释在 13-21 行 |

剩下两个小问题（都不算 bug，但值得顺手改）：

1. **关闭的弹层仍会发请求**：`DashboardPage.tsx:277-287` 的 `MoneyInModal` 是**常驻挂载**的
   （`open` 只是传给 `Modal`），而 `MoneyInModal` 内部 `useAsync(() => api.getReceivingInfo(), [])`
   （`DashboardPage.tsx:319`）不看 `open`。加上 `key={depositOpen ? 'money-in-open' : 'money-in-closed'}`
   每次开关都改变 key → **打开和关闭各重挂载一次**，也就是每进一次首页至少 1 次多余请求、
   每次开关弹层再多 1 次。建议给 `useAsync` 加一个 `enabled` 参数（或把 key 去掉、改用
   `if (!open) return null` 的懒挂载）。
2. **图表交互命中计算复制了两份**：`components/charts/CashFlowChart.tsx:101-106` 与
   `components/charts/Sparkline.tsx:45-49` 的 `pick()` 逐字相同（`ChartTooltip` 已经抽出来了，
   这个也可以抽成 `lib/chartHit.ts`）。

a11y / 交互 nit（P3，不影响演示）：`Segmented`（`components/ui/Segmented.tsx:86,93`）用了
`role="tablist"/"tab"` 但没有方向键与 `aria-controls`；`BankPicker`（`BankPicker.tsx:147`）的
列表是 `role="listbox"`，但只能鼠标点、没有方向键与 `aria-activedescendant`。
两者都是「半 ARIA」，要么补齐键盘支持，要么改用普通 `button` 语义。

---

## 6. 这些看起来啰嗦，但是刻意取舍 —— 不要改

按 README 的理由逐条核对过代码，以下都能对上，**不应算作问题**：

| 写法 | 为什么不是问题 |
| --- | --- |
| `withDerived` / `withDerivedHoldings` / `withDerivedRisk` / `withBalances` 全部在**读取时**推导，不落库 | README §7 逐条给了理由（转账后余额立刻准、净值一变持仓跟着变、封闭期由后端判定）。实现与理由一致：`index.ts:164-170,210-224,232-236`、`db.ts:193-203` |
| 写操作后 `reload()` **不回到骨架屏**（SWR） | `useAsync.ts:36-42` 只在 `data === null` 时置 `loading`；`tools/check-toggle.mjs` 就是盯这个的 |
| 锁卡/开关/限额走**乐观更新**，表单提交走「提交态按钮 + SWR」 | README §6 两条硬性约定的分工，代码严格照做（见 §5 表） |
| 倒计时剩余秒数在**渲染期**推导（`TransferPage.tsx:196-200`、`CardsPage.tsx:89-92`），`setState` 只在 interval 里 | README §12.4 末尾就是这个理由（避免「初始值 + 每秒递减」要在 effect 里播种），`react(set-state-in-effect)` 也正因此才干净 |
| 用 `key={open ? …}` 重挂载代替「open 时 setState」 | README §12.5 明确写过；`DashboardPage.tsx:278`、`CardsPage.tsx:342-344`、`SecurityPage.tsx:235-246` 三处一致 |
| 敏感信息「一块一只眼睛」，不做全局开关 | README §12.4 解释了为什么（演示/截图时只想露一块）；`lib/useReveal.ts` 是纯局部状态 |
| 完整卡号与 CVV 单独走 `revealCardSecrets`（带支付密码、60 秒后真清掉） | `types.ts:561-587` + `index.ts:1092-1121` + `CardsPage.tsx:72-99`，安全理由充分 |
| `Bank.internal` 这个标记 + 本行账号前缀 `882000` 不走公开码表 | README §11 解释得很清楚（曾经的真实 bug）；`card-bin.ts:51`、`db.ts:1136` 用法正确 |
| `tools/gen-bin-table.mjs` 里的 `ROSTER` 与 `db.ts` 的 `CN_BANKS` 是两份银行数据 | **有守卫的重复**：`tools/check-card-bin.mjs` 的 ③/④/⑤/⑥ 用行别代码把两边钉死了（我实跑 ①–⑮ 含 ④′/④″ 全过）。所以这不是「随迭代失真」的那类 |
| 卡号用真实感号段（`402688` / `620522`）而非官方测试 BIN | README §12.4 明确写了取舍与回退方式（改 `cardPan()` 两个前缀即可） |
| 卡 BIN 只收 6 位、62 开头的借记卡号段，不做 Luhn 校验 | README §8 的「已知边界」，是有意收窄范围而不是漏做 |
| `LoginPage.tsx:12` 用 `isMockMode` 决定要不要显示演示提示 | 这是唯一一处 UI 分支在 mock 开关上，但语义正确（提示只在演示环境出现），且 `isMockMode` 来自 `api/index.ts` 而不是 mock |
| 页面内的私有子组件（`SummaryRow`/`Row`/`InfoRow`/`BalanceLine`/`ChannelCard`/`BankCardVisual`…） | 都是单文件单用途的展示件，抽到 `components/` 只会增加跳转成本。**但**同一形状出现 3 次以上就该抽（见 §4.1/§4.2） |
| `hooks` 里 `eslint-disable react-hooks/exhaustive-deps`（`useAsync.ts:66`） | deps 由调用方以数组传入是刻意的 API（注释 13-21 行），静态分析无法理解 |
| 组件层只用一个 `#ffffff`（`LoginPage.tsx:155-159` 的装饰 SVG）；`tokens.css` 是唯一换肤入口 | README §4 的承诺基本成立：全仓库组件里没有别的硬编码色值（我 grep 过）。`#ffffff` 在插画里可接受 |

---

## 7. 体检结果与健康度

**我实跑过的（不含需要浏览器的）全部通过：**

```
$ cd app && npx tsc -b --noEmit          → exit 0（无输出）
$ cd app && ./node_modules/.bin/oxlint src
  Found 0 warnings and 0 errors. Finished in 57ms on 74 files with 116 rules using 16 threads.
$ node tools/check-bank-data.mjs          → ①–⑧ 全部 PASS（55 家银行：内地 20 + 香港 35）
$ node tools/check-assets.mjs             → PASS ×2（58 个资源引用全部命中；本行行标与 cat-mark.ts 一致）
$ node --import ./tools/ts-resolve-hook.mjs tools/check-card-bin.mjs
  → ①–⑮ 全部 PASS（含"本行账号不落他行号段"与"主号段真实存在于表中"）
```

这几条能全过，说明「契约层 + 数据层 + 卡 BIN」这三块的结构是稳的 —— 它们是这个项目里
最容易被写坏的地方，反而做得最好。

**健康度评分（我的主观判断，仅供取舍参考）：**

| 层 | 状态 | 说明 |
| --- | --- | --- |
| `api/contract.ts` + `types.ts` | 🟢 好 | 类型精确、注释说明了取舍；只有 §2.3 的 5 处概念渗漏 |
| `api/http.ts` | 🟢 好 | 129 行，薄映射，无业务 |
| `api/mock/` | 🟡 可接受 | 业务规则齐、注释密度高；但 1231 行单函数、且被文档/工具当作行为规范，改动要连带改文档与检查 |
| `lib/` | 🟢 好 | 717 行、单一职责、被两侧共用（这正是最该复制的模式） |
| `store/` | 🟢 好 | 74 行 |
| `components/` | 🟡 局部劣化 | 重复块集中在 `wealth/` 与 `cards/`；UI 控件的 ARIA 半成品 |
| `pages/` | 🟠 需要注意 | 4 个页面 >400 行；3 个真实 bug（§3.5-3.7）都在这一层 |
| `tools/` | 🟢 好 | 17 个脚本（13 个 `check-*` + 2 个生成器 + `shoot` + 1 个 Node 的 TS 解析钩子），断言写的是「渲染结果/真实行为」而不是「源码长什么样」，还做过变异自测 |

**判断：不需要一次重构。** 需要的是定点清理（§8）+ 一条把「契约三方一致」变成机器可查的检查。

---

## 8. 最该先动的三处（按性价比排序）

### 8.1 【第一优先】加一条契约一致性检查，把这一轮发现的漂移变成可自动发现

这一轮里「代码与文档、代码与代码」不一致的地方有 5 类：README 少 6 条路由（API-CONTRACT §6.2）、
`routes.card` 死键、mock 完全不引用 `routes`（`contract.ts:57` 的注释与事实不符）、
`demoCode` 这种 mock-only 字段进了必填契约、`'LCB'` 这类裸 code 比较。
它们**同属一个根因**：契约面没有被机器校验。项目已经有 `tools/check-*.mjs` 的文化，加一个很合身：

```js
// tools/check-contract.mjs（纯静态，不需要浏览器）
// ① routes 的键 ↔ BankApi 的方法：每个方法必须有路由，每条路由必须被某个方法使用
//    （直接排除 routes.card 这种死键 —— 要么补方法，要么删）
// ② http.ts 里用到的 routes.X 必须都定义过（现在是 TS 保证，加断言防手误）
// ③ README §3 的接口清单 ↔ routes：双向 diff，缺一条就 FAIL
//    （这一条能直接抢在「后端照 README 实现完发现少 5 条」之前）
// ④ mock 与 http 的方法名集合必须相同（现在靠 tsc，加断言防「用 as any 绕过」）
// ⑤ 全仓库禁止 /code === 'LCB'/ 这类裸 code 比较（现在 check-bank-data.mjs 的第 ④ 项
//    只扫 banks.find/some/filter，(b) => b.code === … 之外的形式扫不到）
```

成本约 60 行；收益是 §2.2、§3.2、§3.3(a) 这三类问题以后不会再靠人肉发现。

### 8.2 【第二优先】把 `/accounts/open` 这条链路收干净（半小时内可完成）

理由：这是**当前就坏**的用户可见问题（点「去开立账户」静默回首页），而且它的成因
（迭代中删了入口、忘了链接）正是「石山」的典型形态；同时它是唯一一条
**README 与后端交接文档都写错了**的地方 —— 修它顺带修两份文档，能避免后端按文档去实现一个
前端根本没有的页面。改法见 §3.5（≤20 行，含删掉 `OpenAccountFlow` 里那段不可达 JSX）。
顺手把 §4.4 的 `DEMO_ID` 一起收进 `lib/`。

### 8.3 【第三优先】抽掉身份核验那三份复制（约 500 行 → 1 个组件 + 1 个 hook）

理由：它同时是最大的一块重复（§4.1）和未来最容易改漏的地方（合规相关流程）。
抽完之后 `OpenAccountPage` 能瘦 150 行左右，`WealthAccountOpeningModal` 能瘦 80 行左右，
§1.2 里那几个「大函数」的体量也会跟着下来。

> 如果你想要一件「投入产出比最高」的事，就做 8.1；
> 如果想让**演示当天**更稳，就先做 8.2（它的失败是用户直接可感的）。

---

## 9. 审查覆盖说明

### 9.1 我实际做了什么

| 类别 | 具体 |
| --- | --- |
| 全文阅读 | `README.md`（1008 行，两段读完）、`design/backend-handoff/API-CONTRACT.md`（2,575 → 2,773 行，读了第 1、5、6、7、8 节与相关正文） |
| 逐行阅读 | `api/contract.ts`、`api/http.ts`、`api/index.ts`、`api/types.ts`、`api/mock/index.ts`（全部 1,728 行）、`api/mock/db.ts`（约 1,100 行，含种子与常量）、`pages/` 10 个页面文件中**全文读过 8 个**（Transfer / OpenAccount / Security / Cards / Dashboard / Wealth / Analysis / TransactionDetail），`LoginPage` 与 `SupportPage` 读了主要部分、`components/wealth/ProductDetailModal.tsx`、`RedeemModal.tsx`、`RiskAssessmentModal.tsx`、`WealthAccountOpeningModal.tsx`、`cards/CardApplicationModal.tsx`（前 200 行）、`components/ui/` 的 Modal / BankPicker / Toggle / Segmented / Reveal / Button / PinInput / Toast / ErrorBoundary、`components/layout/` 的 AppShell / TopBar / Sidebar / ScrollToTop、`lib/` 全部 17 个文件、`store/` 2 个文件、`App.tsx`、`styles/tokens.css` |
| 取证命令 | `npx tsc -b --noEmit`、`./node_modules/.bin/oxlint src`、`node tools/check-bank-data.mjs`、`node tools/check-assets.mjs`、`node --import ./tools/ts-resolve-hook.mjs tools/check-card-bin.mjs`；大量 `grep -rn` / `wc -l` / `diff` |
| 脚本化分析（未写文件，`node -e` 内联） | ① 每个文件的规模；② 最长函数（括号配平启发式）；③ `routes` 键 ↔ `BankApi` 方法 ↔ `http.ts`/`mock` 实现的三方比对；④ 枚举字面量与裸 code 比较的出现次数 |
| 真实行为实验（Node 里直接跑 mock，只在内存） | 用 `createMockApi()` 连做两次「完全相同的转账」，验证收款人簿判重是否真的失效（结论：**判重有效**，5 → 6 / bank 与 fps-mobile 两次重复仍为 5）。这一步是为了复核 API-CONTRACT §6.3 #15，见 §9.4 |
| 明确遵守的约束 | 没有修改任何源码；没有启动/重启 dev server；没有 `npm install`；没有跑 `npm run build`（会写 `dist/`）；除本文件外没有写文件。唯一创建的目录是本文件所在的 `design/review/` |

### 9.2 我没有覆盖的（结论可信度的边界）

1. **11 个需要 dev server 的浏览器检查一条都没跑**（`check-toggle` / `check-tx-detail` /
   `check-stale-data` / `check-watermark` / `check-bank-logos` / `check-card-bin-ui` /
   `check-card-secrets` / `check-receiving` / `check-scroll-top` / `check-fx-export` / `shoot`）。
   按约束我没有启动服务。**所以「界面在真实浏览器里的行为」我没有直接验证**，
   §3.5/§3.6/§3.7 这三条 UI bug 是**读代码 + 逻辑推导**得出的。
   其中 §3.5（死链）的推导链只有三步（`Link to` → 路由表没有 → `path="*"` 兜底），
   可信度最高；§3.6（`?q=` 失效）依赖「React Router 不会重挂载同一 element」这个前提，
   我建议作者用一次点击确认（在同一页面用顶栏搜两次）。
2. **未做视觉走查**：`design/shots/` 的截图我没有逐张比对，也不评价美术还原度。
3. **未跑到像素级/响应式**：窄屏断点、打印样式（`@media print`）只有读代码，没有实际打印预览。
4. **未评估性能**：包体积、首屏、渲染次数、图表在大数据量下的表现都没测。
5. **未做的安全审计**：只覆盖了「敏感字段是否会进列表 DTO」这类**类型层面**的检查（结论：没问题，
   `CardSecrets` 独立），没有做 XSS / 注入 / 依赖漏洞（没跑 `npm audit`）等。
6. **`tools/` 的 17 个脚本里只读了 5 个**（`check-bank-data` 全文 / `check-assets` 全文 /
   `check-card-bin` 的部分 / `gen-luckycat-logo` 的头部 / `gen-bin-table` 的前 120 行）。其余 12 个脚本的**断言质量**
   我没有逐行评估，只在需要证据时引用了它们的输出。所以「检查工具本身是否有盲区」这件事
   结论有限（我确知的一个盲区：`grep -rn "accounts/open" tools/` 为空，即死链没有检查覆盖）。
7. **未评估 `scripts/*.py`、`design/brand/**` 资产、字体子集**（`public/fonts/`）。
8. **未做 a11y 系统检查**（只提了两个半 ARIA 组件），没有跑 axe 之类的工具。
9. **未核对 `dist/`**（构建产物可能比源码旧，我没有把它当作事实来源）。
10. **未评审 `README.md` 的叙事与事实错误**（除了与本次发现直接相关的那几条，如 §15.2 的
    `/accounts/open`）。README 里那几条「知识重复」的问题（例如 §7 与 §8 之间的连带影响）
    只在 §3.8 提了与代码矛盾的部分。

### 9.3 被我判定为「不是问题」因而**没有**展开的

见 §6 的 14 条。特别提醒：**不要在没读 README 对应章节的情况下去「修」它们** ——
`withDerived*` 不落库、`nowTick` 渲染期推导、`key` 重挂载、`useAsync` 的 deps 数组这四处，
看起来都像典型的 React 反模式，实际每一条都有明确理由，改了会真出问题。

### 9.4 关于 `design/backend-handoff/API-CONTRACT.md`（审查期间仍在增长）

这个文件在我审查期间至少改了 3 次（2,575 → 2,773 → 2,775 行；md5 从 `e1a71a72…` 到
`6a50c41e…` 再到 `5539f15b…`），显然是另一路工作正在写。**结论引用的行号会随它继续变动而漂移**，
我核对时最后一次读到的是 `md5 5539f15b4d6386a44f90728eccb54a2d` / 2,775 行；
下面这条我复核为「不成立」的结论在三个版本里都还在（正文第 205/946/2510/2709 行）。
我抽查了它 6 条结论的可验证性：

| 文档结论 | 我的复核 |
| --- | --- |
| §6.1 `routes.card` 只定义不实现、零引用 | ✅ 正确（`grep` 实测：`routes.*` 只出现在 `http.ts`，46 个键用掉，`card` 是唯一剩的） |
| §6.2 README 接口清单漏 6 条 | ✅ 正确（我独立比对过：`/api/receiving`、`/api/cards/:id/secrets`、`/api/wealth/account/open`、`/api/security/rules/:id`、`/api/auth/phone` 在用但不在 README §3；`/api/cards/:id` 是死键） |
| §6.3 #1/#2/#3/#5（logout 重置库、login 正则更松、票据不校验、quote 静默回退 accounts[0]） | ✅ 与代码一致 |
| §6.3 #15（最新版第 2510 行）「fps `account` 方式下同一收款人每次转账都新建一条」 | ❌ **与实测不符**。我在 Node 里连做两次完全相同 `fps/account` 转账，收款人 5 → 6（判重命中，只新增一条）；`bank` 与 `fps/mobile` 各做两次，数量仍是 5。原因：该方法下 `req.fpsId` 是 `''`，存与查的键都是 `fps:account::<账号>`，能对上。建议作者复核这条（很可能是把「fpsId 键为空」读成了「已带值」） |
| §6.5 的计数（47 键 / 46 方法） | ✅ 与我实测一致（我最初读到的版本写的是 48，最新版已改对） |
| §5.6 #6「`actions[].to` 是前端路由字符串」 | ✅ 正确，且这是一个真实的边界渗漏（本报告 §2.3） |

**另外两处该文档继承了 README 的错误**，我在报告中单独指出了：
`/accounts/open` 被当成存在的路由（第 946 行，本报告 §3.5）、
`demoCode` 缺失「不会崩」但会显示 `undefined`（第 205 行与 Q27/第 2709 行，本报告 §3.1）。

---

## 10. 一页纸清单

| # | 级别 | 问题 | 位置 | 改法 |
| --- | --- | --- | --- | --- |
| 1 | 🔴 P0 | `demoCode` 必填 + 三处无条件渲染 → 真后端下显示「undefined」 | `types.ts:920`；`OpenAccountPage:96`、`SecurityPage:391`、`WealthAccountOpeningModal:91` | 字段改可选 + 三处判空 |
| 2 | 🟠 P1 | UI 抄了一份后端到账时间规则，且裸比较 `'LCB'` | `TransferPage.tsx:237-245` vs `mock/index.ts:774-780` | 兜底删掉，只认 `quote.etaText` |
| 3 | 🟠 P1 | 默认选中 mock 的内部银行代码 | `TransferPage.tsx:81` | 不预选，或按 `bank.internal` 选 |
| 4 | 🟠 P1 | 页面直接读写 mock 的 `supportHistory` | `SupportPage.tsx:31,50` + `mock/index.ts:1712` | 改成只走 `api.listSupportMessages()` |
| 5 | 🟠 P1 | 理财「指定的资金账户」被忽略（申购侧也漏了） | `mock/index.ts:1348,1479` vs `WealthPage:105` 等三处承诺 | 认 `wealthAccount.settlementAccountId` |
| 6 | 🟠 P1 | `/accounts/open` 死链 + 不可达 UI 分支 | `CardsPage:143,172`；`App.tsx:35-56`；`OpenAccountPage:525-537` | 决定场景去留，删死链与死分支 |
| 7 | 🟠 P1 | 顶栏搜索在已停在分析页时失效 | `AnalysisPage:39` + `TopBar:22` | 用 URL 作唯一事实来源 |
| 8 | 🟠 P1 | 无条件显示「实名身份已核验」 | `SecurityPage:99-103` vs `types.ts:654` | 按 `identityVerified` 分支 |
| 9 | 🟡 P2 | 话术/文案与实现矛盾（日限额、调高限额需核身、密码加密存储、单笔上限） | `mock/index.ts:361,1023`；`SecurityPage:152`；`DashboardPage:392` | 常量插值或删掉不存在的承诺 |
| 10 | 🟡 P2 | 身份核验流程 ×3（含 sendCode/scanFace/倒计时/DEMO_ID） | 见 §4.1 | 抽 1 个组件 + 1 个 hook |
| 11 | 🟡 P2 | 步骤条 JSX ×2（+ 缩水版 ×1） | `TransferPage:542-567`、`OpenAccountPage:152-175`、`WealthAccountOpeningModal:183-211` | 抽 `Stepper` |
| 12 | 🟡 P2 | 理财费用/份额公式 ×3 | `mock/index.ts:265-273`；`ProductDetailModal:65-67`；`RedeemModal:35-38` | 计算收到后端或收到 `lib/wealth.ts` |
| 13 | 🟡 P2 | 演示口令/身份 888888 ×3、DEMO_ID ×2、123456 ×3 | 见 §4.4 | 上移到 `lib/demo.ts` |
| 14 | 🟡 P2 | 9 处「同一事实写两份」（见 §4.5） | — | 逐条删掉重复那份 |
| 15 | 🟡 P2 | 渠道/市场/卡面是布尔分支而不是策略 → 加一个要改很多处 | 见 §4.6 | 至少先加一条契约检查；结构性改动可延后 |
| 16 | 🔵 P3 | `routes.card` 死键、未使用的 `profile/getAccount/getWealthProduct`、未使用的 `formatMoney/toYuan/formatMonthDay` | 见 §2.2、§9.1 | 删或补 |
| 17 | 🔵 P3 | 关闭的弹层仍发请求（开关各一次） | `DashboardPage:277-287,319` | `useAsync` 加 `enabled` |
| 18 | 🔵 P3 | 图表 `pick()` ×2、半 ARIA 组件 ×2、`session.user` 字面量键 | 见 §5 | 顺手清理 |
| 19 | 🔵 P3 | README §1 的 `tools/` 树过期（列 7 个，实际 17 个） | `README.md:49-56` | 补全或改成「见 tools/」 |

**最该先动的一处**：**加 `tools/check-contract.mjs`**（§8.1）——
它把这一轮里 5 类「契约漂移」从「靠人肉发现」变成「跑一下就知道」，
是这个项目最该有、却唯一缺的那条检查。
**如果只允许改一行代码**：先修 §3.5 的死链（`CardsPage.tsx:143,172`），它是当前就在坏的。
