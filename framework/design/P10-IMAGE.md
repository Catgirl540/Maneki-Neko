# P10 · 发图：从「用户选一张截图」到「助手真的看见」

这一篇记录**发图**这条链的完整实现，以及实现过程中走错的两步。
走错的部分留着，因为这两步都会"看起来能用"。

---

## 0. 结论先行

| | |
| --- | --- |
| 用户能做什么 | 在客服页选一张图 → 看到预览和敏感信息提示 → 和文字一起（或只发图）发出去 → 自己的气泡里显示这张图 |
| 图片怎么到助手 | **内联内容块**，图片真的进模型上下文。不是"给个路径让模型自己去读" |
| 图片存哪 | `<DSH_HOME>/uploads/<accountId>/<sha256 前 16 位>.<ext>`，目录 `0700`、文件 `0600`，已 gitignore |
| 账户隔离 | `accountId` 走白名单（`^[A-Za-z0-9_-]{1,64}$`），不合法直接 400；每个账户一个目录 |
| 本地存档 | 只存**缩略图**（最长边 160px、JPEG，实测 ~1KB），原图不落 localStorage |
| 门禁 | `tools/check-image.mjs`（13 项，服务端 + 界面），核心那条是"发一张上红下蓝的图，问助手颜色" |

---

## 1. 走错的第一步：让模型去 `read` 这张图

第一版把图片落盘，然后在提示词里写：

> 用户上传了一张图片，已保存到 `/…/uploads/u_0001/xxxx.png`。请先用 `read` 工具读取它。

**这是错的**：DSH 的 `read` 是读**文本**的；读图是**另一个工具** `read_image`。
两者在同一个包里（`@deepseek-ai/dsh-tool-fs`），但名字不同、走的路不同。
模型照办之后拿到的是二进制乱码，于是回答"我无法看清这张图"。

`check-image.mjs` 的 A5b 就是钉死这个回归的：**放一张上红下蓝的图，问助手什么颜色**。
这条断言不可能靠巧合通过——只有像素真的在上下文里才答得出来。
变异测试验证过：把内联块那一行删掉，**只有 A5b 失败**，其余全过。

---

## 2. 走错的第二步：`tool-fs` 到底怎么挂

DSH 官方的 `sdk-minimal` 底座**完全没有文件系统那一层**——`read` 工具根本不存在。
官方 `base` 底座是这么给的（`packages/bundle/base/cordis.patch.yml`）：

```
- id: fs-sandbox             name: '@deepseek-ai/dsh-fs-sandbox'          # base:479
- id: fs-observation-policy  name: '@deepseek-ai/dsh-fs-observation-policy' # base:257
- id: tool-fs                name: '@deepseek-ai/dsh-tool-fs'              # base:260
- id: attachment-local       name: '@deepseek-ai/dsh-attachment-local'     # base:118
```

我一开始自己配了两处，各崩一次：

| 我的写法 | 结果 | 为什么错 |
| --- | --- | --- |
| 挂 `@deepseek-ai/dsh-fs` | 运行时启动即崩：`dsh profile "luckycat": JSON-RPC input closed` | `dsh-fs` 是**抽象 seam**（`FileSystem` 基类），官方从不把它当插件挂 |
| 挂 `@deepseek-ai/dsh-fs-local` 当后端 | `read` 报 `ctx.fs.resolve is not a function` | 官方用的是 `fs-sandbox`——它 `extends LocalFileSystem`，自带本地实现**再加**一层沙箱围栏 |

**教训**：这不是"难"，是我在盲试。正确做法是**先把官方底座里对应的那几行抄下来**，
而不是按包名猜哪个是后端。同样的形状之前在 `attachments` / `attachment-local` 上踩过一次。

另外两个包的真实身份（也曾经搞反）：

- `@deepseek-ai/dsh-attachment` = 服务定义（`AttachmentStore` 基类），**不挂**。
- `@deepseek-ai/dsh-attachment-local` = **`ctx.attachments` 的提供者**，要挂。
  两件事都靠它：① 桥接层发内联图片块需要它，否则抛
  `SDK image prompt requires an attachment store`；② `tool-fs` 的 `read_image`
  是**按组合条件注册**的（`ctx.inject(['attachments'])` 拿不到就不注册）。

---

## 3. 副作用：`tool-fs` 是整套注册的，没有"只挂 read"

`@deepseek-ai/dsh-tool-fs` 的 `apply` 一次性注册 **`read` / `read_image` / `write` / `edit`**，
config 里只有 `readLimit` 之类的读数上限，**没有按工具的开关**。

而 DSH 的工具面遮罩 `ctx.tools.restrict({ allow })` 只在 **agent 作用域**可用，
官方源码的说法是"a context-global restriction would mask every agent"——
profile 层拿不到这个口子（只有 subagent 那条路在用它）。

所以这 4 个**会出现在工具面上**，处理方式是两道锁：

1. `luckycat-hardening.allowedTools` 里**只放行 `read`**，另外三个一调就被拒；
2. `sandbox-policy` 钉的是 `read-only`，`write`/`edit` 即便绕过硬化的守卫，
   也会被 `fs-sandbox` 以 `FS_SANDBOX_DENIED` 挡住。

`framework/scripts/verify.sh` 里因此有两条新断言：工具面**集合同等**
（生产 14 个 + 探针 1 个，多一个少一个都失败），以及白名单**没有**放行
`read_image`/`write`/`edit`。

> **这一条是妥协，得说清楚**：模型看得见 `write`，只是调不动。
> 想要"看不见"，得在 agent 创建时用 `agent.ctx.tools.restrict()` ——
> 那需要调用方（SDK 的 `setup` 回调）配合，不在 profile 的能力范围内。

---

## 4. 前端：两个上限不是一回事

`app/src/lib/image.ts` 的 `prepareImage(file)` 一次返回两份数据：

| 字段 | 用途 | 参数 |
| --- | --- | --- |
| `data` + `mimeType` | **发给 agent**，要看清内容（可能是账单、卡号、二维码） | 最长边 1600px、JPEG q0.82 |
| `thumb` | **存进本地会话存档**，只是"当时配了张图"的证据 | 最长边 160px、JPEG q0.6 |

存档总盘 `MAX_STORE_BYTES` 只有 2MB，原图 base64 一张就能吃掉一大半，
所以**存档里永远不会有原图**。这一点由返回值结构保证——调用方手上没有把
`data` 写进存档的机会。`check-image.mjs` 的 B6 断言存档里最大的缩略图
**小于 20KB**（实测约 1KB）。

动图（GIF）是例外：走 canvas 会把动图压成静帧，所以**原样发**，只压缩略图。

---

## 5. 顺带修掉的一个真 bug：策略上限形同虚设

写门禁 A4（超限 → 413）时打出来的：请求体上限是 `MAX_BODY_BYTES = 256KB`，
而图片上限是 6MB。**图还没走到校验那一步，连接就被掐了**，客户端看到的是
`ECONNRESET` 而不是 413。

更糟的是 `MAX_IMAGE_BYTES` 这个常量当时**只剩注释、声明被删掉了**，
于是 `data.length > undefined` 恒为 `false` —— **超大的图会被照单全收**。

修法是分清两个上限：

| 上限 | 值 | 超了会怎样 |
| --- | --- | --- |
| `MAX_IMAGE_BYTES`（策略） | 6MB | 回一条清楚的 **413** |
| `MAX_IMAGE_BODY_BYTES`（防洪闸） | 12MB | `req.destroy()`，连状态码都不给 |

**防洪闸必须明显高于策略上限**。第一版把它设成 `MAX_IMAGE_BYTES + 1MB`，
结果测试发的 7MB 先撞上防洪闸被掐断，那条 413 永远走不到。
两个上限贴在一起的时候，"策略上限"就只是注释。

---

## 6. 门禁：`tools/check-image.mjs`

| 编号 | 断言 | 怎么验的 |
| --- | --- | --- |
| A1 | 缺 `accountId` → 400 | 直接打接口 |
| A2 | `accountId = '../../etc'` → 400 | 路径穿越必须被拒 |
| A3 | 不认识的 MIME → 415 且回报 `accepted` | 用 `image/tiff` 试 |
| A4 | 超过 6MB → 413 | 7MB base64，**直连服务端**（走 vite 代理会先被代理挡成 502，测不到服务端自己的上限） |
| A5a | 带图消息 → 202 | |
| **A5b** | **助手答出图里的红与蓝** | 现造一张上红下蓝的 PNG。核心断言 |
| A6 | 按内容哈希归档在本账户目录、权限 0600 | 自己算 sha256 前 16 位去对文件名 |
| A7 | 两个账户各发**不同**的图，互不出现 | 见下面的"假失败" |
| B1–B4 | 有「发送图片」按钮、预览、敏感信息提示、能移除 | Playwright |
| B5 | 发送后用户气泡里出现图片 | `[data-sent-image]` |
| B6 | 存档里是缩略图（< 20KB）不是原图 | 读 localStorage |

### 两次被自己的门禁咬到

**① A7 第一版是假失败。** 它拿**同一个文件**去比两个目录，断言"同名不算串号"。
但归档是**内容寻址**的——同一张图在两个目录里**本来就**同名。
那不是在测隔离，是在测哈希函数。改成两个账户各发**内容不同**的图，
断言"自己的在、对方的不在"。

**② 门禁不清场 → 变异测试抓不住。** 把服务端的账户隔离整个删掉之后，
A6/A7 **照样通过**：因为上一次跑对的那一轮把文件留在了目录里，
断言读到的是**历史残留**。现在门禁开跑前先
`rm -rf uploads/<两个专用账户>`，变异才被抓住（A6+A7 同时失败）。

**这两次都是变异测试发现的**——不注入错误，不会知道断言是不是空的。

### 变异测试记录

| 注入的变异 | 预期失败 | 实测 |
| --- | --- | --- |
| 桥接层不再 push 内联图片块 | A5b | ✅ 只有 A5b 失败 |
| `accountUploadDir` 忽略 `accountId`（都写 `shared/`） | A6 + A7 | ✅ 两项失败（清场修好之后） |

---

## 7. 还没做 / 没验的

- **生产级的图片治理**：保留期、访问控制、用户要求删除。演示实现只是放本地目录。
- **`read_image`**：挂在工具面上但白名单没放行，**没有被任何用例调用过**。
- **前端压缩的边界**：超大图、超大分辨率、CMYK JPEG、HEIC 都**没测**。
  `ACCEPTED_MIME_TYPES` 里没有 HEIC，iPhone 直传可能被 415 拒——这需要真机验证。
- **多图**：一次只支持一张。服务端协议能扩展，前端没做。
- **图片进 TTS**：语音模式念的是文字，图片内容不会被念出来（也没意义）。
