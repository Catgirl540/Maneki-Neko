# DSH 钉版本与漂移台账

本框架把底座当**依赖**用，不当源码用。上游是 0.1.x alpha、约 182 提交/天，
所以这里记下我们依赖的确切版本、行 id 清单与升级流程。

## 1. 钉死版本

| 组件 | 版本 | 说明 |
|---|---|---|
| `@deepseek-ai/dsh` | **0.1.6-alpha.2** | 底座 CLI + 运行时，`package.json` 里精确钉死不写 `^` |
| `@deepseek-ai/cordis` | 4.0.2 | 插件框架（上游 vendored 并 rescope 的 RC 版） |
| `@deepseek-ai/schemastery` | 3.18.2 | 配置 schema |
| `typescript` | ^6.0.3 | 与上游一致（**上游是 `^6.0.3`**，别装 7.x） |
| `@types/node` | ^22.20.3 | Node 22 |
| 上游源码快照 | `ddefc45fbc` / `dsh-v0.1.6-alpha.2` | `reference/deepseek-harness`，只读 |
| 基础 bundle | `@deepseek-ai/dsh-sdk-minimal` | 唯一不叠 `dsh-base` 的完整显式树（158 行） |

Node 要求 `^22.19.0 || >=24`；本机 v22.22.1。

## 2. 我们依赖的行 id（改名 = 破坏性）

`dsh.profile.bundles` 里的行由 `@deepseek-ai/dsh-sdk-minimal` 提供。
我们按 `id` 覆盖或禁用，**这些 id 就是我们的对外契约**：

| 行 id | 我们的操作 | 用途 |
|---|---|---|
| `sandbox-policy` | 覆盖 `config.mode` → `read-only` | 钉死沙箱（出厂是 `danger-full-access`） |
| `approval` | **insert**（sdk-minimal 原本没有） | `policy: ask`；无 answerer 时 fail-closed → deny |
| `persistent-bash` | `disabled: true` | 框架无 shell |
| `persistent-pwsh` | `disabled: true` | 框架无 shell |
| `terminal-bash` | `disabled: true` | 框架无 shell |
| `terminal-pwsh` | `disabled: true` | 框架无 shell |
| `pty` | `disabled: true` | 框架无 shell |
| `mcp-resources` | `disabled: true` | 不挂 MCP |
| `jobs` | `disabled: true` | 不挂后台任务 |
| `luckycat-hello` | **insert**（我们自己） | 冒烟工具，P1 起替换为真实插件 |

**刻意不挂** `@deepseek-ai/dsh-permission-presets`：

1. 它 `inject: ['shell']`，而本框架删掉了全部 shell 行 → 会永久 pending
   （首次尖刺实测：`permission … pending (waiting for service: shell)`）；
2. 它自带 `danger-full-access` preset（sandbox 全权 + approval `never`），
   等于把一个安全翻转开关留在树里。我们直接钉 `sandbox-policy` + `approval`。

## 3. 升级流程（不允许跳步）

1. 改 `package.json` 里 `@deepseek-ai/dsh` 的精确版本；
2. `npm install` 后跑 `bash scripts/verify.sh`；
3. 若 V2 失败，对照 `--dump-config` diff 找出改名/消失的行 id；
4. 记录版本、日期、行 id 变动与新结论到本文件；
5. 快照 `--dump-config` 输出入库以便下次 diff。

## 4. 已知上游地雷

- `dsh.profile` / `dsh.bundle` 两个扩展清单字段是 **2026-08-06** 才破坏性改名的
  （`62d0f26fd6`）——升级时优先检查这两个字段。
- 90 天内破坏性提交 27 条（refactor/feat 级），行 id 目前稳定但无弃用政策。
- 上游**没有**面向插件作者的 breaking/deprecation 文档。