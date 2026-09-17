#!/usr/bin/env bash
#
# 把前端产物发布到公网服务器（bank.waveflow.cn）。
#
# 这个项目是**纯前端**：数据全在浏览器 localStorage 里，服务端只负责发静态文件，
# 所以「部署」= 构建 → 上传 → 让 nginx 指向新目录。没有后端要起、没有数据库要迁。
#
# 用法：
#   BANK_SSH_KEY=~/.ssh/waveflow.pem tools/deploy-bank.sh
#   BANK_SSH_KEY=... BANK_HOST=ubuntu@1.2.3.4 tools/deploy-bank.sh
#
# 密钥**不进仓库**：用环境变量传。发布用的私钥能登服务器，混进 git 历史就收不回来了。
set -euo pipefail

KEY="${BANK_SSH_KEY:?请用 BANK_SSH_KEY 指定 SSH 私钥路径}"
HOST="${BANK_HOST:-ubuntu@81.71.23.46}"
REMOTE_DIR="${BANK_REMOTE_DIR:-/var/www/bank.waveflow.cn}"
DOMAIN="${BANK_DOMAIN:-bank.waveflow.cn}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH=(ssh -F /dev/null -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$HOST")

echo "▶ 构建"
cd "$ROOT/app"
npm run build

echo "▶ 上传到 $HOST:$REMOTE_DIR"
tar czf - -C dist . | "${SSH[@]}" "
  set -e
  sudo mkdir -p '$REMOTE_DIR'
  # 先清空再解包：Vite 的产物文件名带指纹，旧文件留着只会越堆越多
  sudo find '$REMOTE_DIR' -mindepth 1 -delete
  sudo tar xzf - -C '$REMOTE_DIR'
  sudo chown -R www-data:www-data '$REMOTE_DIR'
"

echo "▶ 线上自检（用 Host 头，不依赖 DNS）"
"${SSH[@]}" "
  set -e
  code() { curl -s -o /dev/null -w '%{http_code}' -H 'Host: $DOMAIN' \"\$1\"; }
  printf '  首页            %s\n' \"\$(code http://127.0.0.1/)\"
  printf '  深链接 /cards    %s（SPA 回落）\n' \"\$(code http://127.0.0.1/cards)\"
  printf '  行标            %s\n' \"\$(code http://127.0.0.1/banks/cn-102.svg)\"
  printf '  其它站点未受影响  %s\n' \"\$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: waveflow.cn' http://127.0.0.1/)\"
"

echo "✅ 完成：https://$DOMAIN"
