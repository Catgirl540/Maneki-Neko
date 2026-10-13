# 规划中接口（尚未实现）

2026-10-13：#7/#9 的本地修复、新增登记/审计契约与验证说明见 [本地 issue 修改说明](./local-issue-fixes.md)。周期任务与真实第三方业务仍需按下述流程验收。

路径树中标注「后续规划」的域，当前**未**在 `contract.ts` / 后端落地。
实现时按 `types.ts → contract.ts → http.ts → mock → demo-bank.mjs` 顺序新增，并同步本目录。

已落地的域见：[cashflow.md](./cashflow.md)、[credit.md](./credit.md)、[wealth-ext.md](./wealth-ext.md)。

## 远期（暂不接入）

| 域 | 建议端点 | 说明 |
| --- | --- | --- |
| 线上按揭 | `GET /api/mortgage/products`、`POST /api/mortgage/apply`、`GET /api/mortgage/applications` | 按揭申请、材料上传与进度查询 |
| 加密资产 | `GET /api/crypto/accounts`、`POST /api/crypto/exchange`、`GET /api/crypto/staking` | 兑换 / 托管 / Staking（合规与风控未就绪） |

## 纳入实现时的检查清单

1. 在 `app/src/api/types.ts` 定义请求 / 响应类型。
2. 在 `app/src/api/contract.ts` 的 `routes` 与 `BankApi` 新增条目。
3. 在 `app/src/api/http.ts` 与 `app/src/api/mock/{index,db}.ts` 实现。
4. 在 `framework/bridge/demo-bank.mjs` 增加 `ROUTES` 映射。
5. 更新本目录与根 `README.md` 的接口清单。
6. 运行 `node tools/check-contract.mjs` 与 `node tools/check-routes.mjs` 校验。
