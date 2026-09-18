# DSH 侧安全缺口对照（对照 codex fork 已修的那批）

> 2026-09-17。动机：判断「零内核改动」是否真成立——即 codex 侧那些需要**深改内核**
> 才能收住的安全缺口，在 DSH 上是「不存在」「可配置」还是「同样要改代码」。
> 方法：在 `reference/deepseek-harness`（`dsh-v0.1.6-alpha.2`）里逐条找对应物，
> 只读；每条给 `文件:行号`。

## 结论

**「零内核改动」成立。** 8 条对照里：3 条在 DSH **不存在**，3 条**靠配置/不挂行就能收住**，
2 条**确实存在但属于部署层**（脱敏规则、日志追加权限），P3 用插件 + umask 处理，
不需要动内核。

而且**我们目前的 luckycat 树因为一开始就不挂那些行，已经天然避开 5 条**。
这本身就是"组合优于删减"的实证。

## 逐条对照

| # | codex 侧缺口 | DSH 侧对应物 | 判定 |
|---|---|---|---|
| 1 | MCP 注解可放宽审批（`requires_mcp_tool_approval` 被改成恒 `true`） | **不存在**：`packages/mcp/mcp-client/src/*` **完全不读** `readOnlyHint`/`destructiveHint`/`annotations`，也不与审批/沙箱联动 | ✅ 不存在 |
| 2 | skills 项目根无信任门控（我们加了 `has_trusted_project_layer`） | **有信任机制**：`trustedHost` 仅 bundled 根为 `true`（`skill-filesystem/src/index.ts:262`），非可信根**走 `ctx.fs`**（`:755,:849`） | ✅ 有机制 |
| 3 | 同上（默认根是否含项目） | `includeDefaultRoots` **默认 `true`**（`:78,:166`）→ 默认扫 `<项目根>/.dsh/skills`、`<项目根>/.agents/skills`（`:247-252`） | ⚠️ 默认读工作区 |
| 4 | AGENTS.md 在 trust=None 时加载（F-7） | **存在且上游自己列为限制**：见下方 §2 | ⚠️ 存在，可配置规避 |
| 5 | 项目本地配置注入（F-8，我们加了 4 键 denylist） | **不存在**：未发现任何从 cwd/项目加载配置的路径；配置只有 profile 目录 + `$DSH_HOME/cordis.patch.yml` + `--patch` | ✅ 不存在 |
| 6 | `redact_secrets` 未接入工具输出（R1/R3） | **存在且默认更松**：`session-telemetry/src/index.ts:27` 原文 *"It ships **NO rules** of its own"*，且脱敏**只作用于导出副本**、规范化日志永不重写 | ❌ 需自己挂（P3） |
| 7 | rollout 日志权限（R2，我们已修 0600） | **上游已显式收紧**：实测会话日志文件 `0600`、目录 `0700`，而当时 `umask` 是 `0002` → 不是靠 umask | ✅ 上游已处理；我们加了回归断言（V6） |
| 8 | `additionalContext.kind=application` 自报可进 developer 角色（F-6） | **更好**：DSH 的 `additionalContexts` 类型是 `UserMessage[]`（`core/tools/src/index.ts:562,574,600-602`）→ **user 角色**，客户端无法自封 developer 权威 | ✅ 更好 |

## 1. 我们当前树天然避开了什么

luckycat 以 `@deepseek-ai/dsh-sdk-minimal` 为底，而 `dsh-base` 挂的这些行
（`packages/bundle/base/cordis.patch.yml:267-291`）**我们一个都没挂**：

- `agent-instructions`（工作区 AGENTS.md/CLAUDE.md 自动进提示词）
- `skill` / `skill-filesystem` / `skill-badge` / `tool-skill`（项目技能发现）
- `tool-fs` / `tool-fs-search`（文件系统工具）
- `tool-web`（联网搜索/抓取）
- `mcp-resources`（已显式 disabled）、`mcp-client`（未挂）
- `hooks-*`（Claude Code / Codex 钩子桥）

已实测验证（对**组合后的 dump**，而非模板）：上列名字中除 `mcp-resources` 只以
`disabled: true` 的形式出现外，其余**全部零命中**。

**代价要说清**：这些都是"业务方按需自己加"的插件。加进来的时候必须同时决定
对应策略（例如加 `skill-filesystem` 就要设 `includeDefaultRoots: false`，
否则会从 cwd 读技能）。

## 2. 唯一"上游自己承认为限制"的一条：AGENTS.md 与符号链接

`packages/context/agent-instructions/README.md:218` 原文：

> **Symlinked instruction files are followed across the trust boundary** — a candidate
> whose final component is a symlink is resolved and its target loaded, so a cloned
> repository can surface off-tree file content as lower-authority workspace guidance
> (it never overrides system, developer, or direct user instructions).
> **Confine `ctx.fs` with the filesystem policy gate or an OS sandbox when loading
> untrusted repositories.**

比 codex 强的地方：**上游把这个缺口的缓解手段写在文档里**，而且**权威边界是明确的**
（永不覆盖 system / developer / 直接用户指令）。比 codex 弱的地方：它默认开启
（base 挂载 `agent-instructions`，`maxBytes` 65536）。

对我们的含义：

- luckycat 不挂这一行 → 默认零风险；
- 若业务方要挂，**必须**同时用 `ctx.fs` 策略门（对应我们的 read-only 沙箱）+
  `maxBytes`，并知道符号链接会跨信任边界；
- 这条**不需要改内核**，是配置 + 沙箱姿态问题。

## 3. P3 的处理结果（详见 [P3-HARDENING.md](P3-HARDENING.md)）

1. **脱敏**：没有挂在"遥测导出"上（那只是导出副本），而是挂在 `tools/post-execute`——
   在结果**成为 durable 事件之前**替换投影。理由：规范化日志永不重写，
   事后清洗根本不可能；只有在做出决定的那一步拦，密钥才既不进日志也不进模型。**已端到端验证**。
2. **日志权限**：复查后**上游已显式收紧**（实测 600/700，`umask` 0002 时亦然），
   这条不需要我们修，只留一条回归断言（验收门 V6）。

## 4. 不能因此放松的新风险（我判断需要记账）

- **MCP 工具的沙箱边界**：MCP 工具在**外部 server 进程**里执行，我们的
  `sandbox-policy: read-only` 约束不了它的行为。目前 luckycat 不挂 MCP，所以风险为零；
  但若将来要挂 `mcp-client`，**必须**给 MCP 工具挂 `ask` 审批，否则等于绕开沙箱。
  这一条 codex 已经有对应机制（annotations 恒不放宽 + `ask`），DSH 需要我们自己配。
- **`!!js` 表达式**：配置文件里可以执行 JS（`mode: !!js process.env.…`）。
  这是**配置文件即代码**，但配置只来自 `$DSH_HOME` 内的 profile/home 层与 `--patch`，
  **不是**从工作区自动发现 → 属于"用户自己写的配置"，风险等级可接受。
- **插件安装是代码执行闸门**：`dsh plugin --profile X add <包>` 会跑 pnpm 安装并加载插件，
  且参数路径按**调用时的 cwd** 解析（`apps/cli/src/plugin.ts:13` 传 `cwd: process.cwd()`）。
  即：在不可信仓库里敲这条命令 = 执行该仓库的代码。这是**显式用户动作**，不是自动加载，
  但要在文档里写明。

## 5. 我没有验证的（不要当成已解决）

- 是否存在自动注入提示词的**技能目录**（技能正文进入上下文的时机我只确认了
  "`skill` 工具结果"与"用户显式调用"两条路径，未确认有无常驻 catalog 注入）。
- 若挂 `mcp-client`，MCP 工具默认拿到什么审批决策（未实测）。
- `hooks-*` 的 `configPath` 是**必填配置**（`hooks-claude-code/src/index.ts:72` 为
  `z.string().required()`）且用裸 `readFileSync` 读（绕过 `ctx.fs`）——
  我没找到从工作区自动发现它的路径，但也没穷尽所有调用方。
- 恶意语料下的端到端表现（P2 再验）。