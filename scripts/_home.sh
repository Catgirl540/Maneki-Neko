#!/usr/bin/env bash
# 解析「仓库内隔离的 DSH_HOME」，并硬性拒绝任何写到仓库外的路径。
#
# 为什么不能用 ${DSH_HOME:-默认}：当前 DSH 会话本身已经导出了 DSH_HOME=~/.dsh，
# 那样一旦写成默认值语法就会被环境值吃掉，把 profile 写进用户的真实 home。
# 因此：
#   1) 只认 LUCKYCAT_DSH_HOME 这个专属变量；
#   2) 解析结果必须落在仓库根目录内，否则拒绝执行（fail closed）；
#   3) 最后显式 export DSH_HOME 给子进程，覆盖任何环境残留。
set -euo pipefail

LUCKYCAT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LUCKYCAT_HOME="${LUCKYCAT_DSH_HOME:-$LUCKYCAT_ROOT/.dsh-home}"

case "$LUCKYCAT_HOME" in
  "$LUCKYCAT_ROOT"/*) ;;
  *)
    echo "luckycat: 拒绝使用仓库外的 DSH_HOME：$LUCKYCAT_HOME" >&2
    echo "luckycat: 本框架只允许 \$LUCKYCAT_DSH_HOME 落在 $LUCKYCAT_ROOT 之内" >&2
    exit 1
    ;;
esac

# 显式覆盖，避免调用方环境里的 DSH_HOME 泄漏进来。
export DSH_HOME="$LUCKYCAT_HOME"