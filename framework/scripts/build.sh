#!/usr/bin/env bash
# 构建 luckycat 插件包到各自的 lib/。
# npm 安装的 @deepseek-ai/dsh 不带 tsx，只能加载编译后的 JS，所以每次改完必须 build。
#
# ## 为什么不是简单地 for packages/*/
#
# 原来是按 glob（也就是字母序）构建的，**遇到有仓库内依赖的包就会在全新环境失败**：
# `bank-demo` 要 `@luckycat/dsh-consent/types`，而它排在 consent 前面，
# 那一轮 consent 的 `lib/*.d.ts` 还没生成，tsc 直接报
# `Cannot find module '@luckycat/dsh-consent'`。
#
# 本机一直没暴露，是因为 `lib/` 早就构建过一次、一直留在盘上；
# **做服务器部署（干净环境）时才炸出来**。所以这里按 package.json 里的
# `@luckycat/*` 依赖做一次拓扑排序，而不是靠运气。
#
# 目录名与包名同构（`packages/bank-demo` ↔ `@luckycat/dsh-bank-demo`），
# 所以不用额外映射表。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TSC="$ROOT/node_modules/.bin/tsc"
node "$ROOT/scripts/build-knowledge.mjs"

packages=("$@")
if [ ${#packages[@]} -eq 0 ]; then
  # 不带参数时构建全部有 tsconfig.json 的包，避免漏掉新加的包。
  packages=()
  for dir in "$ROOT"/packages/*/; do
    if [ -f "$dir/tsconfig.json" ]; then
      packages+=("$(basename "$dir")")
    fi
  done
fi

# 拓扑排序：被依赖的先建。成环就地报错（而不是安静地建出半个产物）。
ordered="$(
  python3 - "$ROOT" "${packages[@]}" <<'PY'
import json, os, sys

root, want = sys.argv[1], sys.argv[2:]
PREFIX = '@luckycat/dsh-'

def local_deps(name):
    """这个包直接依赖的仓库内包（目录名形式）。"""
    with open(os.path.join(root, 'packages', name, 'package.json')) as fh:
        pkg = json.load(fh)
    merged = {}
    for field in ('dependencies', 'peerDependencies', 'devDependencies'):
        merged.update(pkg.get(field) or {})
    return {k[len(PREFIX):] for k in merged if k.startswith(PREFIX)}

want = set(want)
order, done, stack = [], set(), []

def visit(name):
    if name in done:
        return
    if name in stack:
        raise SystemExit('build: 包依赖成环: ' + ' -> '.join(stack + [name]))
    stack.append(name)
    for dep in sorted(local_deps(name)):
        if dep in want:
            visit(dep)
    stack.pop()
    done.add(name)
    order.append(name)

for name in sorted(want):
    visit(name)
print(' '.join(order))
PY
)"
read -r -a packages <<<"$ordered"

for pkg in "${packages[@]}"; do
  dir="$ROOT/packages/$pkg"
  if [ ! -f "$dir/tsconfig.json" ]; then
    echo "build: 跳过 $pkg（没有 tsconfig.json）" >&2
    continue
  fi
  echo "build: $pkg"
  "$TSC" -p "$dir/tsconfig.json"
done
echo "build: 完成"
