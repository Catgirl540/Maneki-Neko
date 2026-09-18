# P4：打包与增删门——已验证

> 2026-09-17。目标：把框架做成能装能卸的标准包，并真的演示一次
> "**摘掉一个插件，系统照样跑**"。结论：**用 DSH 官方机制直接做到**，门全过。

## 1. 交付物

每个插件包现在都是 DSH 意义上的 **bundle**（在自己的 `package.json` 里声明
`dsh.bundle.patch`，并随包发一个只负责"把自己的行插进树"的补丁）：

```
packages/hello/cordis.patch.yml       → insert { id: luckycat-hello, name: '@luckycat/dsh-hello' }
packages/embedding/cordis.patch.yml   → insert { id: luckycat-embedding, … }
packages/rag/cordis.patch.yml         → insert { id: luckycat-rag, … }
packages/hardening/cordis.patch.yml   → insert { id: luckycat-hardening, … }
```

于是职责彻底分开：

| 关心的事 | 落在哪 |
|---|---|
| **装哪些插件** | profile 的 `dsh.profile.bundles`（由 `dsh plugin add/remove` 维护） |
| **怎么配置这些插件** | `profiles/luckycat/cordis.patch.yml`（部署方模板，按 id 覆盖 config） |

`scripts/plugin.sh` 只是把 `dsh plugin --profile luckycat …` 包一层。

## 2. 官方机制（实测确认）

- `dsh plugin add <包路径>`：pnpm 装成 `link:` 依赖，**成功后自动把包名追加进
  `dsh.profile.bundles`**（我们实测：清单从 `[dsh-sdk-minimal]` 变成
  `[dsh-sdk-minimal, @luckycat/dsh-hello]`）。
- `dsh plugin remove <包名>`：**先取消选中再卸载**（实测清单回到只有 `dsh-sdk-minimal`、
  依赖清空）。
- 跨层配置有效：bundle 的补丁先把行插进树，**profile 的补丁随后按同一个 id 覆盖 config**
  ——实测 `corpusPath`、`allowedTools` 都正确落到了 bundle 插入的行上。

## 3. 增删门证据（`scripts/plugin-gate.sh`）

| 步骤 | 断言 | 结果 |
|---|---|---|
| 1 卸载前 | 工具面里有 `luckycat_ping` | ✅ |
| 1 卸载前 | 组合树里有 `luckycat-hello` 行 | ✅ |
| 2 卸载 | profile 清单已摘掉该包 | ✅ |
| 2 卸载 | 组合树里那行**已消失** | ✅ |
| 2 卸载 | **系统仍能启动**并完成自检 | ✅ |
| 2 卸载 | 工具面少一个（剩 `knowledge_lookup` + 探针） | ✅ |
| 3 重装 | 工具面恢复 | ✅ |

第 5 条是这一阶段的全部意义：**卸载一个插件之后，剩下的树照常工作**，
不是"删了就跑不起来"。

## 4. 一个必须写清楚的安全事实

`dsh-plugin-manager` 的 README 原话：*"installed Host code **executes in-process
outside the workspace sandbox**"*。也就是说：

- **装插件 = 执行代码**，而且**不受我们的工作区沙箱约束**；
- 所以"增删插件"这个能力本身是**特权操作**，必须由部署方在受控环境里做
  （`dsh plugin` 需要 pnpm 在 PATH 上，并且会写 profile 目录）；
- 我们的加固包只能在**运行期**收紧工具（白名单守卫），管不了"谁被允许装插件"。

这条不做技术兜底，只做文档与流程约束（谁有权在哪个环境敲这条命令）。

## 5. 未做 / 已知限制

- 本地安装是 `link:`（开发便利）。生产应发布到 registry 或走 tarball，
  以得到可复现的版本锁定。
- 装插件依赖 `pnpm` 在 PATH 上；pnpm 的"检查自身更新"会打一条
  `ERR_PNPM_META_FETCH_FAIL`（本机取 npmjs 失败），**不影响安装**（exit 0），
  但日志里看着吓人，已在 bootstrap 里把它写进日志文件而不是刷屏。
- `bootstrap.sh` 会**重建** `cordis.patch.yml`（模板是唯一事实来源），
  所以 `dsh plugin` 文档里"把 disabled 覆盖追加进 profile patch"的行为
  会被下次 bootstrap 覆盖掉。我们不用那个开关（我们用 `bundles` 增删），
  这一点要记住。
- 增删门是**可选门**（`LUCKYCAT_PLUGIN_GATE=1`）：它会临时改动已装 bundle，
  不适合放进默认的只读验收路径。