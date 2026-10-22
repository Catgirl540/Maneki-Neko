# 工作人员 Agent

复用客户端的 Harness、消息流、会话持久化、补充问题、停止和确认通道。员工使用独立 `staff` profile、提示词和会话目录；客户端仍使用 `luckycat` profile。工作人员页面 `/assistant` 直接使用客户端 `ChatWorkspace`，包含图片压缩上传、按住录音、回复朗读、Markdown、历史管理和消息操作。

## 运行

先启动 `server/index.mjs`（默认 8080）。在 `framework` 目录运行：

```powershell
$env:OPENROUTER_API_KEY = '<在本机设置，勿提交到仓库>'
$env:LUCKYCAT_MODEL = 'z-ai/glm-5.3-flash'
npm run start:staff
```

首次运行会构建复用插件并准备仓库内 `.dsh-home/profiles/staff`；Windows 和 Linux 均可使用。运行时默认监听回环地址 8789，默认模型与客户端相同。模型密钥缺失时页面显示助手不可用。员工端不降级调用客户端客服接口。

`staff` 目录运行前设置 `VITE_USE_MOCK=false`，然后 `npm run dev`，访问 `http://127.0.0.1:5181/assistant`。员工登录账号仍为王小明 / 李主管 / 运维人员，演示密码 123456。

可选配置：

| 变量 | 用途 |
| --- | --- |
| `LUCKYCAT_DEMO_PORT` | 员工桥接端口，默认 8789 |
| `LUCKYCAT_BANK_URL` | 员工业务后端，默认 http://127.0.0.1:8080 |
| `LUCKYCAT_MODEL` | 模型编号，staff profile 按该值登记 |
| `LUCKYCAT_PROVIDER=local` | 使用已有本地 OpenAI 兼容模型 |
| `LUCKYCAT_LOCAL_LLM_URL` | 本地模型地址，默认 http://127.0.0.1:8081/v1；配合 `LOCAL_API_KEY` |
| `LUCKYCAT_SESSION_DIR` | 员工持久化目录，默认 `.dsh-home/staff-context`，须与客户目录分开 |
| `VITE_STAFF_AGENT_TARGET` | 开发代理目标，默认 http://127.0.0.1:8789 |

生产反向代理把 `/staff-agent-api/*` 转发为员工桥接服务 `/agent-api/*`，保留 `Authorization`。密钥只配置到服务进程，不放到任何 `VITE_*` 变量。

## 图片与语音

图片沿用客户端压缩、缩略图及内联视觉输入链路，附件按已认证员工归档。`staff` 和 `staff-ops` profile 均具备附件存储；增加附件不会给客服开放文件或系统工具。

语音通过所选员工通道的 `/asr`、`/tts/stream` 请求，携带员工 Bearer。服务端读取与客户端相同的 OpenRouter 和火山语音环境凭据。`LUCKYCAT_DISABLE_VOICE=1` 可显式关闭；未配置能力或浏览器连接不支持录音时，页面显示原因。语音只能发起请求，敏感操作仍须手动确认，代客办理仍须完成客户核验。

本机历史按员工账号和角色隔离。前端结构及本地验证见 [工作人员端维护说明](../../staff/README.md)。

## 角色、工具与确认

21 项员工工具定义于 `framework/packages/staff-tools/src/definitions.mjs`；其中 20 项是客服/主管业务工具，1 项仅用于独立运维运行时。客服可用 17 项，新增真实工作台、合法接收人、工单转派、创建审批、本人通知及接收设置查询；主管另外可处置记录、调整阈值及查询审计。运维保持独立运行时，不能办理客户或主管业务。工作人员微信入口和查询授权见 [工作人员 IM](staff-im.md)。

工具调用和每轮对话均重新核对员工 `/staff-api/me`。桥接层和业务后端都校验角色；任何工具只能请求 `/staff-api/`，不使用客户令牌或共享 `X-Agent-Token`。员工 Bearer 不进入模型或持久化记录。

普通网页工具沿用确认卡机制；员工 IM 的白名单 GET 查询在有效绑定中可获得本轮一次查询授权，写操作仍需确认。确认信息由桥接层根据真实员工身份、客户、工单、处置及设置生成，不信任模型提供的展示字段。授权绑定员工、角色及权限版本、会话、运行轮次、工具、参数和有效期，只能消费一次。涉及工单状态、卡片、签约、处置和阈值的写入在提交前再次读取状态；变化后要求重新确认。

代客办理必须关联同一客户正在受理的工单，员工在卡片中选择实际核验方式并勾选核验通过。模型参数不得包含核验结果、密码、验证码或令牌。当前不支持模拟核验、开启代扣、代客转账、卡片安全信息或自动批量操作。

转账处置使用既有审批对应的冻结交易，直接由银行后端立即到账或拦截，绝不重新转账。拦截理由使用后端枚举。其他审批的 `status=approved` 可能仍有 `executionStatus=pending`；必须按实际执行状态报告，不能宣称资金已完成。

客户资料和业务文本输出脱敏；客户历史会话原文不会进入模型。工单最近消息仍会用于业务处理，提示词明确把它们作为不可信资料。查询列表截断到 30 条，并声明不是完整业务历史。

## 验证

在 `framework` 目录运行：

```powershell
npm run test:staff
npm run test:staff:e2e
```

前者使用独立临时 SQLite 检查真实接口的权限、所有权、核验、取消、重复执行、状态变化、审计和登出；后者使用本地模型协议 fixture 驱动真实 Harness 与浏览器，不调用外部模型，不改现有联调数据。浏览器检查登录、菜单、实时确认卡、核验勾选、锁卡和补充问题。首次测试前运行 `node scripts/bootstrap-staff.mjs`；浏览器测试需要 `tools` 中已有 `playwright-core` 和 Chrome，可用 `CHROME_BIN` 指定路径。

真实模型验收：设置进程 `OPENROUTER_API_KEY` 后运行 `npm run test:staff:live`。默认使用 `z-ai/glm-5.3-flash`，向 OpenRouter 官方接口发送隔离测试库中的虚拟数据；不修改现有联调数据库。测试报告写到忽略的 `server/data/staff-agent-live-report.json`，密钥不写文件。

2026-10-13 验证结果：14 项后端测试、完整浏览器流程、8 项 GLM 5.3 Flash 真实模型验收均通过。真实模型覆盖查询阈值、按手机号查询客户、取消工单回复、确认回复、独立核验后锁卡、客服越权拒绝、主管调整阈值、缺少信息时发起问题卡。每项约 4～24 秒，不含人工等待时间。

## 运维原生 DSH 与 Clef Flash

运维运行时单独监听 8790，使用 `staff-ops` profile 和 `.dsh-home/ops-context`。浏览器根据已登录员工角色选择 `/staff-ops-agent-api`；客服和主管令牌不能进入此服务。复用已安装的 DSH 0.1.6-alpha.2 原生插件，挂载 `read`、`read_image`、`write`、`edit`、`glob`、`grep`、PowerShell/bash、`job_list`、`job_output`、`job_kill`、`web_fetch`。没有配置搜索供应商的 `web_search` 不放行。

在另一终端的 `framework` 目录启动：

```powershell
$env:OPENROUTER_API_KEY = '<进程密钥，勿提交>'
$env:LUCKYCAT_MODEL = 'z-ai/glm-5.3-flash'
$env:LUCKYCAT_OPS_WORKSPACE = 'C:\AI banking\Maneki-Neko'
npm run start:ops
```

`CLEF_FLASH_API_KEY` 可单独设置，未设置则复用 `OPENROUTER_API_KEY`。`VITE_OPS_AGENT_TARGET` 可修改前端开发代理目标。生产代理将 `/staff-ops-agent-api/*` 转发为 8790 的 `/agent-api/*`，保留员工 Authorization。

Clef 按 [OpenRouter Decisions 文档](https://openrouter.ai/docs/guides/community/multimodal-decisions) 接入：固定 `cloudflare/clef-flash`，POST `https://openrouter.ai/api/alpha/decisions`，请求含 `state` 与 `questions`，不发送聊天 `messages`。使用 `choice` 的四类完整概率：只读、普通变更、高危、禁止。只有禁止概率 <1%、高危概率 <3% 且只读或普通变更概率 ≥95% 时才自动通过；禁止概率 ≥50% 时拒绝，其他结果需要人工确认。这是保守产品规则，不能把概率当作经过校准的安全保证。

风险输入包含本轮员工任务与工具完整参数。官方提示托管 Clef 会静默丢弃超过约 2000 token 的文本，因此超过 2400 UTF-8 字节的状态不截断送审，直接要求核对完整操作。超时、未配置、API 错误、模型不匹配、降级或概率无效同样要求人工确认，不自动放行或改用普通聊天模型判断。

执行链是 DSH `tools/pre-execute` → 独立桥接评估 → 原生 approval → 员工确认卡 → `tools/execute` 一次授权消费 → 原生工具。确认卡展示真实员工、工作区、完整操作参数、Clef 类别与概率；授权绑定员工、会话、调用编号、运行轮次、参数指纹及 180 秒有效期。取消、停止、重复消费、参数替换与确认后目录链接变化会阻断执行。凭据、模型控制通道、保存会话、Git 控制目录与银行 SQLite 文件受附加规则保护，不能通过确认扩大沙箱权限。

使用原生 `workspace-write` 沙箱。Windows 原生 ACL 执行器限制写入范围，读取隔离能力受该执行器实现约束；不能将它描述为容器级隔离。原生子进程会移除 KEY/PASSWORD/SECRET/TOKEN 和 DSH 控制环境变量，加固插件在工具结果进入持久化与模型前脱敏。没有挂载进程内 `run_code`。审计位于运维会话目录 `native-audit.jsonl`，包含员工、风险结果、参数指纹、审批及执行状态，不保存原始命令或文件内容。

验证命令：

```powershell
npm run test:ops-agent
npm run test:ops-agent:e2e
npm run test:ops-agent:live
```

前两项检查权限、类型化协议、沙箱执行、密钥环境剥离、一次授权、取消与浏览器确认卡，使用本机模型 fixture 和临时工作区。最后一项使用真实 GLM 与 Clef，只读取或删除隔离工作区的虚拟验收文件；结果保存到忽略的 `server/data/ops-agent-live-report.json`。真实测试结果以报告的 `passed` 字段为准。

2026-10-13：运维单元测试 11 项、员工后端回归 14 项、两套完整浏览器流程和工作人员前端构建通过。真实 Clef 读取/删除/重启/创建笔记分类通过；GLM + Clef + 原生 DSH 的读取、取消删除、确认删除通过。当前读取样本也因概率未达保守阈值而要求人工确认，这符合规则，不代表所有读取都会自动执行。

### 多模态验收

`node tools/check-staff-agent.mjs --browser` 使用本地协议与语音夹具，验证图片进入真实 Harness、录音转写接线、PCM 朗读、员工确认、历史隔离及 320/390/1440px 布局，不调用外部模型。

显式需要真实服务抽查时，可用已配置环境运行 `node tools/check-staff-media-live.mjs`（浏览器路径用 `CHROME_BIN`）。该命令会调用计费的视觉、TTS 与 ASR 服务，只使用生成的虚拟工单图片、合成音频和临时数据库；不会修改公网客户数据。
