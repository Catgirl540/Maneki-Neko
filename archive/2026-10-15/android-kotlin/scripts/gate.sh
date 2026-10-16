#!/usr/bin/env bash
# 安卓侧门禁：桥接契约测试。
#
# 分两层，**都不需要模拟器和真机**（`:contract` 是纯 JVM 模块）：
#   1. 离线：打 MockWebServer，验"客户端把桥接的字节解对了没有"
#   2. 真桥接：打 $LUCKYCAT_CONTRACT_BASE，验"桥接真的是这个形状"
#
# 第 2 层是唯一能发现"桥接改了、客户端没跟上"的门禁，桥接没起就跳过。
#
# 用法：
#   bash android/scripts/gate.sh
#   LUCKYCAT_CONTRACT_BASE=http://127.0.0.1:8788 bash android/scripts/gate.sh
#
# 注意：真桥接那层必须带 `--rerun-tasks`——Gradle 不跟踪环境变量，
# 不带的话第二次跑会直接 UP-TO-DATE，变成一条永远绿的假门禁。
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
fail=0
ok() { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fail=1; }

BASE="${LUCKYCAT_CONTRACT_BASE:-http://127.0.0.1:8788}"
REPORT="contract/build/reports/tests/test/index.html"

echo "== 静态检查：Kotlin 嵌套注释 =="
# Kotlin 的块注释**可以嵌套**，所以在 KDoc 里写 `` `/api/*` `` 这种路径时，
# 那个 `/*` 会开一个永远闭合不了的嵌套注释。报错是 "Unclosed comment"
# 而且指向文件末尾——排查方向完全是错的。这个错在本项目里犯过四次
# （AgentApi、BankApi、PhoneRules、LoginViewModel），所以做成机械检查。
#
# 只查**注释续行**（行首是 `*` 的行）：那里出现的 `/*` 一定是在注释体内部。
# 行首是 `/*` 或 `/**` 的是合法注释开头，不能一并算进去
# （第一版就是这么写的，结果误报了 Labels.kt 里一个正常的块注释）。
#
# 覆盖不到的：单行 KDoc 里夹 `/*`（`/** 见 /api/* */`）。留个记录，
# 别以为这条检查是完备的。
nested="$(grep -rnE '^[[:space:]]*\*.*/\*' --include=*.kt . 2>/dev/null || true)"
if [ -z "$nested" ]; then
  ok "没有嵌套注释隐患"
else
  bad "注释里有嵌套的 /*（改成 … 或去掉那个斜杠）"
  echo "$nested" | sed 's/^/      /'
fi

echo "== 静态检查：矢量图标必须是描边（透明填充） =="
# `ColorFilter.tint` 是 SRC_IN：**所有非透明像素**会被整片染成传入的颜色。
# 所以图标资源里 `fillColor` 必须是透明，否则描边图标会变成一块实心色块——
# 而这件事**编译期查不出来**，只有上了真机才发现图标是个方坨。
#
# 为什么放在这里、不放 IconVectorTest：那里量过覆盖率，**像素阈值判别不了**它。
# 描边形态最高的 `ic_image` 是 0.395，而填实的 `ic_home` 是 0.544——看着能分开，
# 但话筒那种小形状填实之后覆盖率可能更低，一个全局阈值不是漏判就是误判。
# 透明度是资源里的**静态事实**，用静态检查表达最诚实。
fill_bad=""
for f in app/src/main/res/drawable/ic_*.xml; do
  [ -e "$f" ] || continue
  # ① 不许出现非透明的 fillColor
  hit="$(grep -n 'android:fillColor' "$f" | grep -v 'android:fillColor="#00000000"' | head -1 || true)"
  if [ -n "$hit" ]; then
    fill_bad="$fill_bad
      $f: $(echo "$hit" | sed 's/^[0-9]*://' | sed 's/^ *//')"
    continue
  fi
  # ② 也不能干脆不写：缺省填充在部分版本上是黑色，tint 一样会把图标填实
  if ! grep -q 'android:fillColor="#00000000"' "$f"; then
    fill_bad="$fill_bad
      $f: 缺 android:fillColor（必须显式写成透明）"
  fi
done
if [ -z "$fill_bad" ]; then
  ok "业务矢量图标都是透明填充（tint 不会把它们填实）"
else
  bad "矢量图标里有非透明/缺失的 fillColor：$fill_bad"
fi

echo "== 静态检查：界面代码里不许有 emoji =="
# 为什么要管这个：**emoji 不是图标。**它由系统 emoji 字体渲染——彩色、
# 字面体量跟字号走、不吃我们的品牌色。这个项目里 icons 只有一套语言
# （`res/drawable/ic_*.xml` 的矢量资源，圆头描边、靠 tint 上色），
# 中间混进一个 emoji，在真机上就是很显眼的一处突兀
# （起因：客服输入栏那两个 U+1F5BC / U+1F3A4，实测确实刺眼）。
#
# 只扫 `src/main` 的 Kotlin：那是"会不会渲染给用户"的分界线。
# 不扫注释之外的东西（测试、脚本、设计文档里 `✅ ❌ ⚠️` 是开发者面的输出，
# 而且不少文档本来就用这些符号画表格）。
#
# 覆盖不到的，别以为这条是完备的：
#   · 纯文本符号不在范围内——`✓`(U+2713)、`›`、`·` 没有彩色呈现、受 `color` 控制，
#     属于排版符号，本来就是有意用的。所以 dingbat 那一段把 U+2713/U+2714
#     用负向先行断言剔掉了（不剔的话选择态那三处 `✓` 会误报）；
#   · 从后端/模型来的正文（助手回复）不经过这里，那是内容不是界面。
emoji="$(grep -rnP '[\x{1F000}-\x{1FAFF}\x{1F1E6}-\x{1F1FF}\x{2600}-\x{26FF}]|(?![\x{2713}\x{2714}])[\x{2700}-\x{27BF}]|\x{FE0F}' \
  --include=*.kt app/src/main 2>/dev/null || true)"
if [ -z "$emoji" ]; then
  ok "界面代码里没有 emoji"
else
  bad "界面代码里有 emoji（换成 res/drawable 里的矢量图标）"
  echo "$emoji" | sed 's/^/      /'
fi

echo "== 离线测试（契约 + 业务逻辑，都不需要桥接与模拟器） =="
if ./gradlew :contract:test :domain:test --console=plain -q >/tmp/luckycat-android-offline.log 2>&1; then
  ok "离线测试通过（报告：android/$REPORT）"
else
  bad "离线测试失败，日志：/tmp/luckycat-android-offline.log"
fi

echo "== 真桥接契约测试（$BASE） =="
if curl -s --max-time 3 "$BASE/agent-api/health" >/dev/null 2>&1; then
  if LUCKYCAT_CONTRACT_LIVE=1 LUCKYCAT_CONTRACT_BASE="$BASE" \
    ./gradlew :contract:test --tests '*LiveContractTest*' --rerun-tasks --console=plain -q \
    >/tmp/luckycat-android-live.log 2>&1; then
    ok "真桥接契约测试通过"
  else
    bad "真桥接契约测试失败，日志：/tmp/luckycat-android-live.log"
  fi
else
  echo "  skip $BASE 没响应（先起桥接：node framework/bridge/demo-server.mjs）"
fi

echo
if [ "$fail" -eq 0 ]; then echo "android gate: 全部通过"; else echo "android gate: 有失败项"; fi
exit "$fail"
