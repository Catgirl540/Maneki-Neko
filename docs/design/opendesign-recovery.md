# OpenDesign 设计任务恢复清单

## 当前目标与授权

用户已确认并行制作 Revolut、Wise、Stripe 三套网页银行原型，用于比较视觉方案。配色、Logo、字体、布局与组件均可重新设计，不提供旧版视觉参考。保留主要功能直接放在首页、传统 / 智能双模式、按钮中心向全屏圆形扩散的切换动画，以及现有业务与接口边界。本轮先做交互原型，不发布公网。

已确认规格：网页应用、完整产品框架、精致产品界面。执行模式为 OpenDesign Cloud。用户已授权追加 Wise、Stripe 两套方案，并在电脑重启后要求继续。无需重复询问这些选择，也不要重新创建已有项目。

## 三个已有项目

### Revolut

- 项目：`project-6953`
- 会话：`b15873ed-4e2b-4e6c-84bb-acb9823d6ac6`
- 生成任务：`d12dc9d5-2ecc-43e5-beb1-20d411c980a5`
- 工作流：`8152bad5-ab4d-4ec8-a72a-df90000849a4`
- 原请求：`1b2c291d-4bed-41fc-8766-3499ba5e598c`
- 文件：`index.html`、`app.js`、`styles.css`
- 持久化任务状态：`succeeded`，无错误。
- 已检查双模式切换和演示转账核对页。1280×800 下全部功能区较长，部分主要入口需滚动，仍应检查首页的功能前置效果。

### Wise

- 项目：`wise-7fd9`
- 会话：`2835f279-b2bc-4100-8b28-88f9adfc2214`
- 生成任务：`cd27806b-a7bb-4692-8c38-6888c9b16dc5`
- 工作流：`a392b698-5b43-44af-aae5-c2bd34e44d4c`
- 原请求：`1e6e4531-9746-46ed-a390-24f350baac74`
- 文件：`index.html`、`app.js`、`app.css` 均已保存。
- 持久化任务状态：`canceled`，`cancelOrigin=user_stop`，`endedWithUnfinishedWork=true`。
- 不要宣称已完成。先查看已保存页面，再按用户的继续请求补完必要工作。

### Stripe

- 项目：`stripe-2dda`
- 会话：`e9ed80de-3fa6-4677-a16a-5ec2c6161c21`
- 生成任务：`3ab3f628-d9c4-4e95-b353-8461c23f0337`
- 工作流：`43f088f3-1d37-4da9-a616-ee204bafdc74`
- 原请求：`587f7182-2d8c-4441-9795-6e36dee399ed`
- 文件：`fortune-cat-bank.html`
- 持久化任务状态：`succeeded`，无错误。
- 上轮智能首页截图出现图标异常放大，需复查并修正后再交付。

## 文件保存位置

项目根目录：`/home/bigguga/.config/Open Design/namespaces/default/data/projects/`

任务记录根目录：`/home/bigguga/.config/Open Design/namespaces/default/data/runs/`，每个任务目录含 `state.json`、`events.jsonl`。

上述文件在重启后仍存在。之前放在 `/tmp` 的任务索引、临时 QA 文件与截图已丢失，因此将恢复信息保存到本文件。

## 重启后的连接情况（2026-10-15 已修复）

故障原因：AppImage 启动器使用临时解压目录，MCP 将该目录中的 Node、CLI 和启动程序写入注册。电脑重启清除 `/tmp` 后，MCP 无法找到可执行文件。设计项目和任务数据没有丢失。

修复：

- 将已安装的官方 0.23.1 程序完整复制到 `/home/bigguga/.local/share/open-design/runtime/0.23.1/`，关键可执行文件和 CLI 与原安装一致。
- 用户启动器 `/home/bigguga/.local/bin/open-design` 现使用该持久目录的 `AppRun`；桌面快捷方式原本就指向此启动器，无需更改。
- 原启动器备份为 `/home/bigguga/.local/bin/open-design.before-persistent-runtime-20261015`。
- 使用官方停止接口平稳退出旧服务，再通过官方 `--headless --mcp-install codex` 刷新注册。未修改账号凭据、其他 MCP 配置或设计项目。
- `codex mcp get open-design --json` 已确认：运行时、CLI 和 bootstrap 程序均在持久目录。侧车 IPC socket 仍在 `/tmp`，它属于运行时通信文件，启动时会重建。

验证：

- 完全停止 OpenDesign 主服务后，创建新的 MCP stdio 会话，完成初始化并成功查询既有 Stripe 任务；服务自动拉起，冷启动通过。
- 当前会话的 OpenDesign MCP 工具已恢复；三个既有任务均可读取。Revolut、Stripe 为成功生成；Wise 保持先前的取消状态，不能宣称补完。
- 未重启整台电脑；已验证服务完全停止后的自动启动。
- 旧预览链接的端口已过期。后续始终使用各任务 `get_run` 返回的 Studio / Preview 链接，不猜端口，不拼凑交付链接。
- 浏览器上轮访问曾被安全策略拒绝，不使用原始 CDP、其他浏览器或终端浏览器绕过拒绝。当前修复验证通过官方 MCP 完成。

维护：当前启动器固定为 0.23.1。今后升级官方 AppImage 时，应更新持久程序目录、启动器并重新运行官方 MCP 安装，再验证冷启动；不要重新注册临时解压路径。程序备份与原 `/opt/open-design/Open-Design.AppImage` 均保留。

## 下一步

### Stripe 侧边栏与动效（用户指定由 OpenDesign 实现）

- 项目仍为 `stripe-9a78`，会话 `0e79bae3-f100-4483-a967-a10d74996a21`。
- 生成任务 `53ba0bea-2a11-408e-9346-65128721e126`，工作流 `1379d238-e969-45c9-919c-5b2b8cebf816`。
- 请求 `b03e96ad-8ed1-4bc3-ad3c-e8cf03d01906`；原始参数保存于 `stripe-sidebar-motion-request.json`。
- 调整顶部导航为侧栏，添加 UI 动画，区分传统/智能背景，圆形扩散揭示目标背景与界面。用户打断前仅阅读文件，未手工修改本轮 UI；本轮交给 OpenDesign Cloud 生成。
- 此轮已生成成功。浏览器1280×800实测侧栏与智能淡紫背景已生效，但圆形克隆 main 与真实 main 的 rect 不一致（克隆256,95.5,992；真实224,0,1056），原因是克隆移除ID而样式依赖ID。未手工改页面，继续交给 OpenDesign 修正。
- 对齐修复任务 `904c1d0f-52b1-4e0a-bf67-09e0e77aa856`，工作流 `2ec7ebc6-c3a9-4c22-8a78-78d7df0449cf`，请求 `c0157c79-7ea5-43bc-a03c-3ec74d7a0118`，原始参数保存于 `stripe-circle-alignment-request.json`。

### Stripe 重做（2026-10-15 用户要求新对话）

- 独立项目：`stripe-9a78`，保留旧 Stripe 项目。
- 新会话：`0e79bae3-f100-4483-a967-a10d74996a21`。
- 生成任务：`012088c0-cd1e-4d78-ae4f-bd1909e2e14e`。
- 工作流：`917ae37c-2575-4ed9-8018-7c0dbff6e26a`。
- 请求：`628ca328-1997-481e-97b4-070e1bda7563`。
- 原始参数保存在 `stripe-redo-request.json`，重试必须保持同一请求和相同参数；轮询只用 get_run。
- 使用 Stripe 母版、OpenDesign Cloud，空白项目重做，未输入旧设计。
- 生成已成功结束，入口 `zhaocai-cat-bank.html`。浏览器实测后通过 OpenDesign 文件版本修复了转账表单 `extra` 未传入导致的空白页，以及返回修改错误地继续显示核对页的问题；原生成版本仍在历史版本中。
- 实测 1280×800 首页主要入口全部在首屏；检查了 1440×900 布局、传统/智能往返、转账填写与核对及返回修改保留信息、银行卡页面和理财比较面板。此处为交互原型，不连接真实 AI 或银行服务。

1. OpenDesign MCP 已恢复，继续复用本清单中的项目与工作流，不重新创建项目或重复收集需求。
2. 检查三套现有文件，补完 Wise，复查 Stripe 的图标尺寸和 Revolut 的首屏入口。
3. 验证双模式往返、圆形切换、关键业务核对步骤和返回路径。
4. 交付三套可访问的原型链接供用户选风格；不自动实施到业务仓库或部署公网。
