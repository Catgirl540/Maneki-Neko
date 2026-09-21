# P1：第三方模型接入（已验证）

> 2026-09-17。目标：让框架能连我们自己选的模型，**换模型只改配置**，一行业务代码不写。
> 结论：**已完成并端到端验证**，包括工具调用。

## 1. 做了什么

sdk-minimal 出厂只装了 `llm-deepseek`（官方 DeepSeek 适配器）。DSH 的多供应商能力在
`@deepseek-ai/dsh-llm-pi-ai`（基于 pi-ai），**配置路由即可**：

```yaml
# 关掉官方适配器（同时也断掉了官方 API 的数据回传链路）
- id: llm-deepseek
  disabled: true

- insert:
    - id: llm-pi-ai
      name: '@deepseek-ai/dsh-llm-pi-ai'
      config:
        providers:
          openrouter:                     # 云端
            apiKeyEnv: OPENROUTER_API_KEY # 只引用环境变量名，不落密钥
            api: openai-completions
            baseURL: https://openrouter.ai/api/v1
            retryPolicy: { mode: normal } # 必须显式写：always 会无限重试且每次都计费
            models: [...]
          local:                          # 本机 llama.cpp（OpenAI 兼容），备用
            apiKeyEnv: LOCAL_API_KEY
            api: openai-completions
            baseURL: http://127.0.0.1:8080
            retryPolicy: { mode: normal }
            models: [...]
```

同时把出厂人设从 `"You are a helpful software engineer assistant."` 换成业务口径
（整行覆盖 `system-prompt`，可用 `LUCKYCAT_SYSTEM_PROMPT` 环境变量替换）。

## 2. 验证证据（都是真跑的，不是推断）

跑法：`node bridge/run.mjs "<问题>"`，桥以子进程 + stdio JSON-RPC 驱动 luckycat profile。

| 用例 | 结果 |
|---|---|
| `nvidia/nemotron-3-ultra-550b-a55b:free` | ❌ **上游过载**：`Upstream error from Nvidia: Service temporarily overloaded` (`PI_AI_ERROR`) |
| `nvidia/nemotron-3.5-lightning:free` | ✅ 15.1s，中文回答「我是Nemotron，由NVIDIA的研究人员训练的语言模型。」 |
| `inclusionai/ling-3.0-flash-vl:free` | ✅ **3.2s**，中文回答「我是百灵大模型（Ling）…」 |
| **工具调用**（ling） | ✅ 7.9s，模型自己调用 `luckycat_ping`，并一字不差引用返回原文「喵呜——luckycat framework plugin is loaded.」，事件数 12 → 20 |

**失败用例同样有价值**：会话日志里能读到完整因果链——

- `request/header` 记录 `provider: openrouter` / `model: …`，并且**工具 schema 已组装进请求**
  （`tools: [{ name: luckycat_ping, … }]`）；
- 失败被记成 `assistant/attempt`（不是 `assistant/message`），内含
  `finish.reason.kind = "error"` 与上游原文。

对比 codex 侧那次「坏 base_url → 无限 `ERROR: Reconnecting...` 刷屏、无错误信息，
最后只能靠 `timeout` 发现问题」：DSH 在这里**失败即记录、原因可读**。

## 3. 怎么换模型

```sh
# 换云端模型
LUCKYCAT_MODEL=nvidia/nemotron-3.5-lightning:free node bridge/run.mjs "问题"

# 换到本机 CUDA 模型（需先启动 127.0.0.1:8080 的 llama.cpp）
LUCKYCAT_PROVIDER=local LUCKYCAT_MODEL=qwen3.8-9b-q4 node bridge/run.mjs "问题"
```

模型由调用方在 SDK 握手里指定（`InitializeParams.provider/model`），
所以"每个业务方用哪个模型"是**部署配置**，不是代码分支。

## 4. 代码零改动

本次唯一的"新代码"是 `bridge/run.mjs`——它**不是框架代码**，而是 P5 后端桥的种子
（浏览器接进来的路径本来就需要它）。模型接入本身**没有写任何适配器代码**。

## 5. 已知与未做

- `nemotron-3-ultra` 免费档会过载，默认模型已改为 `ling-3.0-flash-vl`（**2026-09-20 起再改为 `ling-3.0-flash-fin`**，原因见本节末尾的补充）。
  **2026-09-20 补充（两步，第二步推翻了第一步的结论）**：

  第一步：`ling-3.0-flash-vl` 的 `:free` 档是共享池（上游 Novita），并发几个请求就 429 ——
  实测同时跑三个会用模型的自动化检查（`check-agent`、`check-voice`、`verify.sh` 的 e2e）
  必然中，报 `429 ... upstream_provider_shared_pool`。表现很容易被误读成「代码坏了」：
  助手不回话、确认卡片不出现、e2e 用例 2 报「没收到待确认事项」。**那些检查要串行跑。**

  第二步（**纠正**）：当时的判断是「换成付费档就好了」，**这是错的**。换成付费的
  `ling-3.0-flash-vl`（DeepInfra，$0.06/M）之后**照样 429**：
  `provider_error_code: engine_overloaded`、`limit_source: upstream_provider_shared_pool`、
  **`is_byok: false`**。`is_byok: false` 是关键——OpenRouter 用的是**它自己的**上游账号，
  付费并没有换到「我们自己的额度」。连续 7 次尝试全部 429。
  要真正脱离共享池只有两条路：**BYOK**（配自己的 provider key）或**换一个有容量的模型**。
  每个 ling 模型都只有 DeepInfra 一家 provider（`/endpoints` 查过），
  所以「换一家 provider」在当前配置下走不通。

  第三步（**再纠正**）：上面那个结论也错了。`ling-3.0-flash-fin` 单发很快，
  裸测（两三个工具的极简 prompt）**也会调工具**，但放进真实应用
  （10 个工具 + 完整人设）就露馅：它把整段思维链写进**给用户看的正文**，
  然后 `finish: stop`，**一次工具都不调** → `e2e-consent.sh` 用例 1 直接失败。
  同族的 `ling-3.0-flash` 也有一样的毛病（反问「请确认以上信息是否正确」）。
  教训：**换个模型只打一发 chat 接口是测不出来的，必须跑 e2e-consent.sh。**

  最终结论：默认模型是 **`qwen/qwen3.8-flash`**（付费档，$0.15/$0.47 每 M，
  100 万上下文）。它 **`e2e-consent.sh` 全过 23 项、0 失败**，工具调用与参数
  都正确，唯一 provider 是 Alibaba，与 DeepInfra 那摊过载无关。

  另外一条实测得来的硬约束：**模型必须先登记进 profile 的 `models:` 目录**，
  否则运行时直接拒绝（`pi-ai provider "openrouter" has no configured model "…"`）。
  想临时试一个新模型，也得先加进去。
- `local` 路由当前不可用（本机 llama.cpp 未启动），配置已备好。
- **向量/embedding 尚未做**：DSH 没有任何 embedding 通道，要自己写
  `ctx.embedding` 服务（P1 后半 + P2）。chat 侧的"换模型只改配置"已成立，
  embedding 侧要做到同样的可配置性。
- 重试策略只验了 `normal`；未验证 `normal` 在 5 次退避内是否真能救回上游过载。
- 工具调用只验了"模型主动调用"这一条路径，未验并行工具调用与调用失败分支。