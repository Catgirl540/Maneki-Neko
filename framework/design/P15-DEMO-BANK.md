# P15 · 占位银行后端（`/api/*`）

> 状态：**已实现并上线**（2026-09-21）。
> 相关：`P6-WEB-BRIDGE.md`（同一个演示服务上的 `/agent-api/*`）、
> `P14-DEPLOY.md`（部署方式）、`P13-ANDROID.md`（安卓端就是靠它拿业务数据）、
> `../../design/backend-handoff/API-CONTRACT.md`（真后端要实现的那批接口）。

## 是什么

服务器上多了一组 `/api/*`，把**仓库里那份前端 mock 挂到了 HTTP 上**：

```
安卓 App / 浏览器
      │  https://bank.waveflow.cn/api/…
      ▼
   nginx ──► luckycat-bridge (127.0.0.1:8898) ──► bridge/demo-bank.mjs
                                                      │
                                                      └─ import app/src/api/mock/index.ts
                                                         （现场转译，一份数据一处逻辑）
```

路径用的就是 `API-CONTRACT.md` 里已经定好的那批（`/api/accounts`、
`/api/accounts/{id}/transactions`、`/api/transfers`…），所以**真后端上线时
客户端只要换 baseUrl**，业务代码零改动。

## 为什么是"复用"而不是"再写一份"

银行数据原来只活在前端 `app/src/api/mock/`（65K 逻辑 + 63K 数据）。
安卓端要显示账户、流水、理财、卡片这些页面，就得有数据。

给安卓再抄一份 Kotlin 版**必然与网页版漂开**——同一笔流水两边余额不一样，
是这类项目最典型的烂尾方式。所以这里直接 import 前端那份 TS：
一份数据、一处逻辑，改 mock 两边同时变。

## 怎么在 Node 里跑起前端 TS

- `tools/ts-resolve-hook.mjs` 用 Node 的 `registerHooks` + 应用自带的 typescript
  现场转译，并解析 `@/` 别名。它是**运行时注册**的（不是 `--import`），
  所以桥接的启动命令不用改，systemd 单元也不用改。
- `window.localStorage` 垫成"内存 + 落文件"（`app/src/lib/storage.ts` 里的调用
  本来就包在 try/catch 里，不垫也不会崩，但那样状态活不过重启）。
- 状态文件：`$DSH_HOME/demo-bank-state.json`。

## 路由表不是手抄的

`demo-bank.mjs` 里的 `ROUTES` 只写 `[动词, routes 的键, BankApi 方法, 造参数]`，
**路径从 `contract.ts` 的 `routes` 推导**（用一个哨兵值调一次路径构造器，
把参数位切出来）。所以路径不可能抄错。

启动时有三条断言，都是 fail-fast：

1. **双向完整性**：`BankApi` 上的每个方法都要在表里，表里也不能有 `BankApi` 上没有的方法。
   漏一条的后果是"某个页面到了真后端才 404"。
2. **路由键存在**：表里引用的 `routes` 键必须真的在 `contract.ts` 里。
3. **路由冲突自检**：每条路由用自己的样例路径必须**匹配回自己**。

## 踩到的两个坑（都写成了断言）

### 1. 参数路由之间必须按具体度排序

第一版只做了"静态优先于参数"，结果：

```
GET /api/accounts/acc_0001/transactions  →  {"message":"账户不存在"}
```

因为 `/api/accounts/{id}` 与 `/api/accounts/{id}/transactions` 的 prefix 相同，
前者先匹配就把 `acc_0001/transactions` 整段当成了 id。
`routes` 的书写顺序里 `account` 正好排在 `transactions` 前面，所以是稳定复现。

修法：参数路由**按字面量长度从长到短**排。配的路由冲突自检就是为了以后
`contract.ts` 加新路径时能当场发现，而不是等某个页面莫名 404。

### 2. 不能写死"往上几跳是仓库根"

开发仓库是 `<repo>/framework/bridge/`，服务器上是把 `framework/*` **平铺**到
`~/luckycat/`（`~/luckycat/bridge`、`~/luckycat/app`、`~/luckycat/tools`）。
按固定深度写 `ROOT/..`，在服务器上算出来是 `/home/ubuntu`，于是报
"找不到转译钩子"。

改成**向上搜索**：找同时有 `tools/ts-resolve-hook.mjs` 与
`app/src/api/mock/index.ts` 的那一层，往上最多找 5 层。两种布局都对。

## 与前端 mock 的一处**有意偏离**

前端 mock 的 `logout()` 会 `resetDb()`（本地数据，退出即重置，合理）。
放到服务端就成了"任何人退出登录 = 所有人的演示数据被清空"，
所以这里把 `logout` 做成空操作，重置改走显式的
`POST /api/__demo/reset`（刻意放在 `__demo` 命名空间下，一眼能看出它不属于交接契约）。

## 验证：拿**现有那批浏览器门禁**去打它

最强的验证不是新写一个检查脚本，而是把网页版指向占位后端，让它那 100+ 条
真实业务断言去过一遍：

```bash
# 桥接先起着，然后：
cd app && VITE_USE_MOCK=false VITE_PROXY_TARGET=http://127.0.0.1:8788 npm run dev
# 另开一个终端跑各条门禁
```

结果（9 条数据相关门禁）：

| 门禁 | 结果 |
| --- | --- |
| check-login / check-amounts / check-routes / check-receiving | 通过 |
| check-card-bin-ui / check-tx-detail / check-fx-export / check-scroll-top | 通过（修掉路由冲突后） |
| check-stale-data | **不适用**——它测的是"浏览器里存着过期/损坏的本地 mock 库"，那是 mock 模式特有的前提，真后端下不存在 |

**门禁之间会互相污染**：演示库现在是**共享的一份**，某条门禁做了转账，
后一条看到的余额就变了。跑之前先 `POST /api/__demo/reset` 重置。

## 网页版**暂时仍然走自己的前端 mock**

网页版是纯静态、可离线用的；切到后端之后，桥接一挂整个站点就用不了。
所以这次只让**安卓端**用占位后端，网页版维持原样。

将来想统一切过去，只要两步（都验证过可行）：
`app/.env.production` 里 `VITE_USE_MOCK=false`，并把 `VITE_API_BASE_URL` 留空
（走同源 `/api/`）。注意 `check-stale-data.mjs` 在那种模式下不适用，要单独说明。

## 已知边界

- 这是**演示数据**，工具与接口返回的都是占位内容，不接任何真实银行系统。
- 共享一份状态：多个人同时用会互相看到对方的改动（含 `__demo/reset`）。
- 状态落在服务器的 `$DSH_HOME/demo-bank-state.json`，**没有清理策略**。
- 端点公开，靠 nginx 的 `limit_req` 按 IP 限流（与 `/agent-api/` 同一个限流区）。
