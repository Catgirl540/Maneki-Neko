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

# 必须**先转成绝对路径**：脚本后面会 cd 到 app/ 去构建，
# 相对路径到那时就指向 app/.deploy/key 了 —— 报错还是 "Identity file not accessible"，
# 看起来像密钥不存在，其实是路径被 cd 带偏了。
if [ ! -f "$KEY" ]; then
  echo "❌ 找不到密钥：$KEY" >&2
  exit 1
fi
KEY="$(cd "$(dirname "$KEY")" && pwd)/$(basename "$KEY")"

HOST="${BANK_HOST:-ubuntu@81.71.23.46}"
REMOTE_DIR="${BANK_REMOTE_DIR:-/var/www/bank.waveflow.cn}"
DOMAIN="${BANK_DOMAIN:-bank.waveflow.cn}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH=(ssh -F /dev/null -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$HOST")

# HTTP 版本发布前必须确认银行服务和同源代理已就绪，避免覆盖可用站点后才发现接口未接通。
echo "▶ 验证银行后端与 /api 代理"
"${SSH[@]}" "
  set -e
  health=\$(curl --max-time 10 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health)
  api=\$(curl --max-time 10 -s -o /dev/null -w '%{http_code}' --resolve '$DOMAIN:443:127.0.0.1' https://$DOMAIN/api/accounts)
  if [ \"\$health\" != 200 ] || [ \"\$api\" != 401 ]; then
    echo '银行后端或 /api 代理未就绪：先启动 server/index.mjs 并配置 nginx，再发布前端。' >&2
    exit 1
  fi
"

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

echo "▶ 线上自检（不依赖 DNS：把域名 --resolve 到本机）"
"${SSH[@]}" "
  set -e
  # 必须走 **HTTPS + --resolve**：上了证书之后 http 会 301，
  # 拿 http 状态码自检的话每一项都是 301，看着像全挂，其实只是被跳转了。
  # --resolve 让 curl 连本机、但带上正确的 SNI 与 Host，证书校验也照常走。
  code() { curl -s -o /dev/null -w '%{http_code}' --resolve '$DOMAIN:443:127.0.0.1' \"https://$DOMAIN\$1\"; }
  printf '  官网首页 /       %s\n' \"\$(code /)\"
  printf '  深链接 /dashboard %s（SPA 回落；未登录会被前端送去登录页）\n' \"\$(code /dashboard)\"
  printf '  深链接 /cards    %s（SPA 回落）\n' \"\$(code /cards)\"
  printf '  行标            %s\n' \"\$(code /banks/cn-102.svg)\"
  printf '  问一个不存在的    %s（SPA 回落也应 200）\n' \"\$(code /no-such-page)\"
  printf '  HTTP 是否跳 HTTPS %s（应 301）\n' \"\$(curl -s -o /dev/null -w '%{http_code}' --resolve '$DOMAIN:80:127.0.0.1' http://$DOMAIN/)\"
  printf '  其它站点未受影响  %s\n' \"\$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: waveflow.cn' http://127.0.0.1/)\"
"

echo "✅ 完成：https://$DOMAIN"
