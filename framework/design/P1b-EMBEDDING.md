# P1b：向量服务（`ctx.embedding`）——已验证

> 2026-09-17。目标：给检索/RAG 提供"文字 → 向量"，并且**换向量模型只改配置**。
> 结论：**完成并端到端验证**；两条路由实测维度不同，离线单测 11 个，变异测试 2/2 抓获。

## 1. 为什么这部分要自己写

DSH **完全没有** embedding 通道：全仓没有 `ctx.embedding`，`packages/llm/*` 里连
`embed(` 都没有（只有 chat 流式）。所以这是本框架第一个**真正自研的服务**。

形状照抄 DSH 自己的 `ctx.llm`（adapter registry）：路由名 + 后端注册表 + 「注册即 effect」。
包：`packages/embedding`（`@luckycat/dsh-embedding`），三个源文件：

| 文件 | 职责 |
|---|---|
| `src/types.ts` | 只有类型（`EmbeddingRouteConfig` / `EmbeddingProvider` / 错误分类） |
| `src/errors.ts` | `EmbeddingError`，带稳定 `code` |
| `src/openai-embeddings.ts` | OpenAI 兼容后端（`POST {baseURL}/embeddings`） |
| `src/index.ts` | `EmbeddingService`（`static Config` + `ctx.embedding`） |

## 2. 实测验证

| 用例 | 结果 |
|---|---|
| 默认路由 `openrouter`（`baai/bge-m3`，2026-09-20 起） | ✅ **1024 维** |
| 切到 `relayrouter`（`text-embedding-3-small`）**只改一个环境变量** | ✅ **1536 维** |
| 离线单测（本机 stub HTTP，不联网） | ✅ **11/11** |
| 变异测试：破坏"按 index 还原顺序" | ✅ 被对应用例抓住 |
| 变异测试：忽略 batchSize | ✅ 被对应用例抓住 |

两条路由维度不同这件事本身就是证据：**模型真的换了，而不是配置被忽略**。

## 3. 加固决定（都写进代码并测试）

- **凭据只引用环境变量名**（`apiKeyEnv`），调用时才读 → 换 key 不用重启；
  错误信息里**只出现变量名，绝不出现密钥**（有用例断言这一点）。
- **带凭据的请求不跟随重定向**（`redirect: 'error'`）——对齐 DSH 自己的
  "credential-bearing provider requests 必须拒绝重定向"约定。
- **明文 http 只允许回环地址**（本机模型服务器），其余必须 https。
- **重试有上限**（默认 2 次，指数退避），退避只对 429/5xx/网络抖动；
  4xx（除 429）**不重试**。对照：DSH 的 `llm-retry` 有个 `always` 模式会无限重试且每次计费。
- **失败分类**：`MISSING_CREDENTIAL` / `HTTP_STATUS` / `MALFORMED_RESPONSE` /
  `TIMEOUT` / `ENDPOINT_NOT_ALLOWED` / `EMPTY_INPUT` / `UNKNOWN_ROUTE` / `DUPLICATE_ROUTE`。
- **重复注册同名路由直接抛错**，不静默覆盖。

## 4. 踩到的两个真坑（都已修 + 加了回归测试）

1. **裸 `response.json()` 会把错误变成没法诊断的消息。**
   真实场景：某网关对错误路径返回「**200 + HTML 页面**」，于是抛出无分类的
   `SyntaxError`，桥只看到 `code=UNKNOWN message=Unexpected token '<'`。
   修法：统一走 `readJson()`，检查 `content-type` 并转成 `MALFORMED_RESPONSE`，
   **把响应片段带进错误信息**；现在这句话能直接指出"baseURL 少写了 `/v1`"。
2. **复用别人的 baseURL 变量会踩路径假设。**
   本机 `RELAYROUTER_BASE_URL` 是 `https://api.relayrouter.ai`（**不含 `/v1`**），
   直接拿来拼 `/embeddings` 就打到了错误路径上。修法：改用我们自己的
   `LUCKYCAT_RELAYROUTER_BASE_URL`，默认值写全 `…/v1`。

## 5. 怎么换向量模型

```yaml
# config 里改路由（服务端决定用哪个）
defaultRoute: openrouter      # 或 relayrouter
providers:
  <路由名>:
    apiKeyEnv: <环境变量名>
    api: openai-embeddings
    baseURL: <必须含版本段，如 /v1>
    model: <模型 id>
    dimensions: <维度>        # 可选；服务端自己决定时省略
```

调用方也可以在**请求里指定路由**（`embed({ texts, route })`），
所以"哪个业务用哪个向量模型"是部署配置，不是代码分支。

## 6. 未做（归 P2）

- 没有索引、没有缓存、没有落盘——本阶段只做"能稳定取到向量"。
- 没有并行分批（当前串行），也没有维度一致性校验（比如索引维度与查询维度不符）。
- 没有用量/成本统计。
- `local`（本机 llama.cpp）暂未配向量路由：那台服务器现在没启动，
  且它是 chat 模型权重，不确定支持 `/embeddings`，宁可不写进配置。