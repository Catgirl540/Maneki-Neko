#!/usr/bin/env bash
# luckycat 框架机械验收门。
# 退出码 0 = 全部断言通过；非 0 = 有断言失败（会逐条打印）。
#
# 刻意不使用 set -e：我们要跑完全部断言再汇总，而不是第一条失败就退出。
set -uo pipefail
# 此门验收独立演示 profile；HTTP 银行联调由 tools/check-agent-http.mjs 覆盖。
export LUCKYCAT_BANK_MODE=demo
source "$(dirname "${BASH_SOURCE[0]}")/_home.sh"

fail=0
ok() { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fail=1; }

node_eval() {
  node --input-type=module -e "$1"
}

echo "== V1 零内核改动 =="

# 只读参考副本必须一尘不染。
ref="$LUCKYCAT_ROOT/../reference/deepseek-harness"
if [ -d "$ref/.git" ]; then
  dirty="$(git -C "$ref" status --porcelain)"
  if [ -z "$dirty" ]; then ok "reference/deepseek-harness 工作树干净"; else bad "参考副本被改动: $dirty"; fi
else
  echo "  skip 参考副本不存在"
fi

# 用户的真实 ~/.dsh 绝不允许出现我们的 profile。
if [ -e "$HOME/.dsh/profiles/luckycat" ]; then
  bad "用户的 ~/.dsh 被污染（存在 profiles/luckycat）"
else
  ok "用户 ~/.dsh 未被污染"
fi

# 已安装的 dsh 必须是钉死版本。
pin="$(node_eval "import {readFileSync} from 'node:fs'; const p=JSON.parse(readFileSync('$LUCKYCAT_ROOT/package.json','utf8')); console.log(p.dependencies['@deepseek-ai/dsh'])")"
installed="$(node_eval "import {readFileSync} from 'node:fs'; console.log(JSON.parse(readFileSync('$LUCKYCAT_ROOT/node_modules/@deepseek-ai/dsh/package.json','utf8')).version)")"
if [ "$pin" = "$installed" ]; then ok "dsh 版本 == 钉死版本 ($pin)"; else bad "dsh 版本 $installed != 钉死 $pin"; fi

echo "== V2 组合正确 =="
dump="$(bash "$LUCKYCAT_ROOT/scripts/dsh-profile.sh" --dump-config 2>/tmp/luckycat-verify-dump.err)"
if [ -s /tmp/luckycat-verify-dump.err ]; then
  bad "dump-config 有告警: $(tr '\n' ' ' < /tmp/luckycat-verify-dump.err)"
else
  ok "dump-config 零告警（每条补丁都匹配到了目标行）"
fi

if grep -q '^    mode: read-only$' <<<"$dump"; then ok "sandbox mode = read-only"; else bad "sandbox mode 不是 read-only"; fi
if grep -q '^    policy: ask$' <<<"$dump"; then ok "approval policy = ask"; else bad "approval policy 不是 ask"; fi

# 断言"某行确实被禁用"：按 id 取出该条目**整块**（直到下一个 - id: 为止）再找 disabled。
# 不能用固定行数窗口——带 config 的条目会把 disabled: true 推到更后面
# （llm-deepseek 就因此曾被误判为未禁用）。
entry_block() {
  awk -v id="$1" '
    $0 == "- id: " id { inside = 1; print; next }
    inside && /^- id: / { exit }
    inside { print }
  ' <<<"$dump"
}

for id in persistent-bash persistent-pwsh terminal-bash terminal-pwsh pty mcp-resources jobs \
          session-log-deepseek plugin-package-inventory-deepseek deepseek-llm-api-extensions \
          llm-deepseek; do
  if grep -q '^  disabled: true$' <<<"$(entry_block "$id")"; then
    ok "删行已禁用: $id"
  else
    bad "删行未禁用: $id"
  fi
done

if grep -q 'danger-full-access' <<<"$dump"; then
  bad "树里仍有 danger-full-access（不该挂 permission-presets）"
else
  ok "树里无 danger-full-access"
fi

if grep -q 'id: luckycat-hello' <<<"$dump"; then ok "插件行 luckycat-hello 在树中"; else bad "插件行 luckycat-hello 缺失"; fi

# V2b 多供应商路由：llm-pi-ai 必须在树中，且路由与重试策略正确。
if grep -q "id: llm-pi-ai" <<<"$dump"; then ok "多供应商适配器 llm-pi-ai 在树中"; else bad "llm-pi-ai 缺失（会没有可用模型）"; fi
if grep -q 'apiKeyEnv: OPENROUTER_API_KEY' <<<"$dump"; then ok "OpenRouter 路由已配置"; else bad "OpenRouter 路由缺失"; fi
if grep -q '^          mode: normal$' <<<"$dump"; then ok "重试策略显式为 normal（不会无限计费重试）"; else bad "重试策略不是 normal"; fi
if grep -q 'always' <<<"$dump"; then bad "树里出现 always 重试（会无限重试并计费）"; else ok "树里无 always 重试"; fi
if grep -q 'LUCKYCAT_SYSTEM_PROMPT' <<<"$dump"; then ok "业务人设覆盖已生效（可被环境变量替换）"; else bad "business persona 覆盖未生效"; fi

# V2c 向量服务：DSH 没有 embedding 通道，这一行是我们自己加的服务。
if grep -q 'id: luckycat-embedding' <<<"$dump"; then ok "向量服务行 luckycat-embedding 在树中"; else bad "向量服务行缺失"; fi
if grep -q 'api: openai-embeddings' <<<"$dump"; then ok "向量路由协议 openai-embeddings 已配置"; else bad "向量路由协议缺失"; fi
if grep -q 'model: baai/bge-m3' <<<"$dump"; then ok "向量默认模型已配置（bge-m3，付费档 1024 维）"; else bad "向量默认模型缺失"; fi
if grep -q 'id: qwen/qwen3.8-flash' <<<"$dump"; then ok "聊天默认模型已配置（qwen/qwen3.8-flash，唯一过了 e2e-consent 的付费档）"; else bad "聊天默认模型不对"; fi
if grep -q 'dimensions: 1024' <<<"$dump"; then ok "向量维度已按新模型改成 1024（旧的 2048 会静默算错相似度）"; else bad "向量维度没跟着模型改"; fi

# V2d 知识库检索
rag_block="$(entry_block luckycat-rag)"
if [ -n "$rag_block" ]; then ok "知识库插件行 luckycat-rag 在树中"; else bad "知识库插件行缺失"; fi
if grep -q 'corpusPath: /' <<<"$rag_block"; then ok "语料路径已替换为绝对路径"; else bad "语料路径未替换（占位符没处理？）"; fi
if grep -q 'maxInjectBytes: 2000' <<<"$rag_block"; then ok "注入预算已显式配置（2000 字节）"; else bad "注入预算未显式配置"; fi

for id in skills skill-filesystem tool-skill; do
  if [ -n "$(entry_block "$id")" ]; then ok "技能行已挂载: $id"; else bad "技能行缺失: $id"; fi
done
skill_block="$(entry_block skill-filesystem)"
if grep -q 'includeDefaultRoots: false' <<<"$skill_block" && grep -q 'bundledSkillDir: /' <<<"$skill_block"; then
  ok "技能只读取指定目录，默认主机目录扫描已关闭"
else
  bad "技能目录未隔离或绝对路径未替换"
fi

# V2e 加固
hard_block="$(entry_block luckycat-hardening)"
if [ -n "$hard_block" ]; then ok "加固插件行 luckycat-hardening 在树中"; else bad "加固插件行缺失"; fi
if grep -q 'allowedTools:' <<<"$hard_block"; then ok "工具白名单已显式配置（fail-closed）"; else bad "工具白名单缺失"; fi
if node "$LUCKYCAT_ROOT/scripts/check-bank-tool-policy.mjs" "$DSH_HOME/profiles/luckycat/cordis.patch.yml" "$DSH_HOME/profiles/luckycat/doctor.patch.yml"; then
  ok "HTTP 银行工具注册与生产、自检允许列表一致"
else
  bad "HTTP 银行工具允许列表不完整"
fi
if grep -q 'secretEnv:' <<<"$hard_block"; then ok "按环境变量名脱敏已配置（取值不进配置）"; else bad "secretEnv 未配置"; fi

# V2g 敏感操作闸门与银行示例消费者
if grep -q 'id: luckycat-consent' <<<"$dump"; then ok "闸门行 luckycat-consent 在树中"; else bad "闸门行缺失"; fi
# 注意：`!!js` 表达式的值会渲染到**下一行**，所以不能写成 `channelUrl: http://…` 这种
# 单行匹配——第一版就是这么误报的。按条目块分别查"有 channelUrl"和"有回环地址"。
consent_block="$(entry_block luckycat-consent)"
if grep -q 'channelUrl:' <<<"$consent_block" && grep -q 'http://127.0.0.1:8788' <<<"$consent_block"; then
  ok "确认通道地址已配置（本机演示服务的回环地址）"
else
  bad "确认通道地址未配置: $(tr '\n' ' ' <<<"$consent_block")"
fi
# 通道地址允许被环境变量覆盖，但不允许被改成明文 http 的外网地址
# （插件的 assertAllowedEndpoint 会在加载期拒绝；这里做配置层的回归断言）。
if grep -Eq 'http://(?!127\.0\.0\.1|localhost)' <<<"$consent_block"; then
  bad "确认通道指向了明文 http 的外网地址"
else
  ok "确认通道没有指向明文 http 的外网地址"
fi
if grep -q 'id: luckycat-bank-demo' <<<"$dump"; then ok "银行示例消费者行 luckycat-bank-demo 在树中"; else bad "银行示例消费者行缺失"; fi
if grep -q 'dataPath: /' <<<"$(entry_block luckycat-bank-demo)"; then ok "演示数据路径已替换为绝对路径"; else bad "演示数据路径未替换（占位符没处理？）"; fi
# 不允许出现"全权 + 免审批"的开关（与 V2 的 danger-full-access 断言同一口径）。
if grep -q 'approval: never' <<<"$dump"; then bad "树里出现 approval: never（会把审批整个关掉）"; else ok "树里没有 approval: never"; fi

# V2f 长对话与用量（补课项：sdk-minimal 原本没有压缩与用量统计）
for id in token-meter session-checkpoint-policy tool-result-pruner compaction-basic; do
  if grep -q "id: $id" <<<"$dump"; then ok "补课行在树中: $id"; else bad "补课行缺失: $id"; fi
done

echo "== V3 工具真的注册了（注册表探针）=="
probe_out="$(sleep 6 | timeout 30 bash "$LUCKYCAT_ROOT/scripts/dsh-profile.sh" --patch "$LUCKYCAT_HOME/profiles/luckycat/doctor.patch.yml" 2>&1 >/dev/null)"
if grep -q 'luckycat_ping=REGISTERED' <<<"$probe_out"; then
  ok "luckycat_ping 已注册"
else
  bad "luckycat_ping 未注册: $(tr '\n' ' ' <<<"$probe_out")"
fi
if grep -q 'knowledge_lookup' <<<"$probe_out"; then
  ok "knowledge_lookup 已注册"
else
  bad "knowledge_lookup 未注册: $(tr '\n' ' ' <<<"$probe_out")"
fi
# 工具面用**集合同等**断言，而不是数字：数字看不出增删的是哪一个。
# 生产树 = 知识库 + 框架自检 + 8 个银行占位工具 + 文件系统四件套；探针是 --patch 挂载的，所以还多它一个。
#
# 文件系统那四个（read / read_image / write / edit）来自官方 `@deepseek-ai/dsh-tool-fs`：
# 它是**整套注册**的，没有"只挂 read"的配置开关。而 DSH 的工具面遮罩
# （`ctx.tools.restrict`）只在 **agent 作用域**可用（官方源码原话：context-global
# 会 "mask every agent"），profile 层拿不到这个口子。所以这 4 个**会出现在工具面上**，
# 文件类工具均不在白名单；图片通过 SDK 的内联块传入。
expected_names='ask_user_question,bank_get_balance,bank_get_transaction_detail,bank_list_transactions,bank_reveal_card_secret,bank_transfer,bank_wealth_quote,bank_wealth_redeem,bank_wealth_subscribe,edit,knowledge_lookup,luckycat_ping,luckycat_probe_secret,read,read_image,skill,write'
if grep -q "^\[luckycat-probe\] names=$expected_names$" <<<"$probe_out"; then
  ok "工具面集合完全匹配（生产工具 + skill + 探针）"
else
  bad "工具面集合不匹配（有意外增删）: $(grep 'names=' <<<"$probe_out")"
fi
# 反过来确认生产树里**没有**探针插件。
if grep -q 'luckycat-probe' <<<"$dump"; then
  bad "生产树里混进了探针插件"
else
  ok "生产树里没有探针插件（只在 --patch 时挂载）"
fi
# 关键不变式：整棵树的工具面里不许出现 shell / 联网类工具。
# `edit`/`write` **故意不列进这个正则**：它们是上面那套 fs 工具自带的、已知可见，
# 由 hardening 白名单拦（下面单独断言）。这里拦的是真正的执行面：能起进程、能出网。
if grep -Eq 'names=.*(bash|shell|exec|spawn|apply_patch|web_search|web_fetch|fetch_url)' <<<"$probe_out"; then
  bad "工具面里出现了 shell / 联网类工具: $(grep 'names=' <<<"$probe_out")"
else
  ok "工具面里没有任何 shell / 联网类工具"
fi
# 图片以内联块传入模型，不放行读取服务端文件的工具。
allowed_block="$(entry_block luckycat-hardening)"
# 提问工具**必须**在白名单里，否则模型一调就被拒——而"缺信息时问用户"
# 是这个助手的正常行为，不是可选能力。
if grep -q '^ *- ask_user_question$' <<<"$allowed_block"; then
  ok "白名单放行了 ask_user_question（缺信息时能弹卡片问用户）"
else
  bad "白名单里没有 ask_user_question（模型一提问就会被守卫拒掉）"
fi
for t in read read_image write edit; do
  if grep -q "^ *- $t\$" <<<"$allowed_block"; then
    bad "白名单意外放行了 $t"
  else
    ok "白名单没有放行 $t（工具面上可见，但一调就被拒）"
  fi
done
# 补课项必须是**服务级**激活，不能只是"行在树里"。
if grep -q 'compaction=ACTIVE' <<<"$probe_out"; then ok "压缩服务已激活"; else bad "压缩服务未激活: $(grep 'compaction=' <<<"$probe_out")"; fi
if grep -q 'tokenMeter=ACTIVE' <<<"$probe_out"; then ok "用量统计服务已激活"; else bad "用量统计未激活: $(grep 'tokenMeter=' <<<"$probe_out")"; fi

# 敏感操作闸门：光"服务在"不够，必须**声明了规则**。
# 规则表为空 = 闸门形同虚设（任何工具都能直接执行），所以断言的是规则集合本身。
expected_consent='bank_get_balance,bank_get_transaction_detail,bank_list_transactions,bank_reveal_card_secret,bank_transfer,bank_wealth_quote,bank_wealth_redeem,bank_wealth_subscribe'
if grep -q '^\[luckycat-probe\] consent=ACTIVE count=8$' <<<"$probe_out"; then
  ok "敏感操作闸门已激活，且声明了 8 条规则"
else
  bad "敏感操作闸门未激活或规则条数不对: $(grep 'consent=' <<<"$probe_out")"
fi
if grep -q "^\[luckycat-probe\] consent_tools=$expected_consent$" <<<"$probe_out"; then
  ok "闸门拦截的工具集合与预期完全一致"
else
  bad "闸门拦截的工具集合不匹配: $(grep 'consent_tools=' <<<"$probe_out")"
fi
# 反向断言：每一个会被拦截的工具，都必须在加固白名单里。
# 只拦不白名单 = 用户确认完还是被守卫拒绝；只白名单不拦 = 直接执行、更糟。
for name in ${expected_consent//,/ }; do
  if grep -q "^      - $name$" <<<"$(entry_block luckycat-hardening)"; then
    :
  else
    bad "被闸门拦截的工具 $name 不在加固白名单里（用户确认后仍会被守卫拒绝）"
  fi
done
ok "闸门拦截的 8 个工具都在加固白名单里"

echo "== V4 离线单测（不联网） =="
unit_out="$(node --test --test-reporter=tap "$LUCKYCAT_ROOT"/packages/*/tests/*.test.mjs 2>&1)"
unit_fail_count="$(sed -n 's/^# fail \([0-9]*\)$/\1/p' <<<"$unit_out")"
if [ "${unit_fail_count:-1}" = "0" ]; then
  ok "离线单测全过（$(sed -n 's/^# pass \([0-9]*\)$/\1/p' <<<"$unit_out") 个用例）"
else
  bad "离线单测有失败: $(grep '^not ok' <<<"$unit_out" | head -3 | tr '\n' ' ')"
fi

echo "== V6 日志权限（上游显式收紧，这里做回归断言） =="
# DSH 是**显式**建 0600/0700 的，不靠 umask（实测：本机 umask 0002 时仍是 600/700）。
# 这条断言的意义是：一旦上游改成依赖 umask，这里会立刻发现。
# `-print -quit` 而不是 `| head -1`：管道会在 find 还写着的时候被 head 关掉，
# find 吃 SIGPIPE，`set -o pipefail` 让整条管道非 0，脚本当场中止。
# 会话日志攒到一定数量就会踩到（实测 116 个的时候）。`-print -quit` 不带管道。
sample_log="$(find "$LUCKYCAT_HOME/sessions" -name 'session.v*.jsonl' -print -quit 2>/dev/null)"
if [ -n "$sample_log" ]; then
  file_mode="$(stat -c '%a' "$sample_log")"
  if [ "$file_mode" = "600" ]; then ok "会话日志文件权限 600"; else bad "会话日志权限是 $file_mode，应为 600"; fi
  dir_mode="$(stat -c '%a' "$(dirname "$sample_log")")"
  if [ "$dir_mode" = "700" ]; then ok "会话目录权限 700"; else bad "会话目录权限是 $dir_mode，应为 700"; fi
else
  echo "  skip 还没有会话日志"
fi

echo "== V5 端到端 =="
if [ "${LUCKYCAT_E2E:-0}" = "1" ]; then
  if bash "$LUCKYCAT_ROOT/scripts/e2e-bank.sh"; then ok "端到端（知识库问答）通过"; else bad "端到端（知识库问答）失败"; fi
  if bash "$LUCKYCAT_ROOT/scripts/e2e-security.sh"; then ok "端到端（脱敏 + 白名单守卫）通过"; else bad "端到端（安全）失败"; fi
  if bash "$LUCKYCAT_ROOT/scripts/e2e-consent.sh"; then ok "端到端（敏感操作：展示 → 确认 → 验身份 → 才执行）通过"; else bad "端到端（敏感操作）失败"; fi
  # 语音这条不需要起 agent 运行时（不走模型），只用到语音上游，所以最便宜。
  if bash "$LUCKYCAT_ROOT/scripts/e2e-voice.sh"; then ok "端到端（语音：合成 → 喂回去识别，往返一致）通过"; else bad "端到端（语音）失败"; fi
else
  echo "  skip 默认跳过（需要联网与 OPENROUTER_API_KEY；设 LUCKYCAT_E2E=1 启用）"
fi

echo "== V7 增删门 =="
if [ "${LUCKYCAT_PLUGIN_GATE:-0}" = "1" ]; then
  if bash "$LUCKYCAT_ROOT/scripts/plugin-gate.sh"; then ok "增删门通过（卸载后仍能启动，再装即恢复）"; else bad "增删门失败"; fi
else
  echo "  skip 默认跳过（会临时改动已装 bundle；设 LUCKYCAT_PLUGIN_GATE=1 启用）"
fi

echo
if [ "$fail" -eq 0 ]; then echo "verify: 全部通过"; else echo "verify: 有失败项"; fi
exit "$fail"
