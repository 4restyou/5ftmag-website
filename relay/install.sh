#!/usr/bin/env bash
# 5ft.mag 네이버 커머스 중계 서버 설치 스크립트 (Ubuntu 22.04/24.04)
#
# VPS 의 브라우저 SSH 터미널에서 아래 한 줄로 실행:
#   curl -fsSL https://raw.githubusercontent.com/4restyou/5ftmag-website/main/relay/install.sh | sudo bash
#
# 하는 일:
#   1) node + caddy 설치
#   2) naver-relay.mjs 다운로드, RELAY_KEY 자동 생성
#   3) systemd 서비스 등록 (재부팅에도 자동 시작)
#   4) Caddy 로 https://<도메인> TLS 자동 발급 + 중계 서버 연결
#   5) 마지막에 supabase secrets set 에 쓸 값들을 화면에 출력
set -euo pipefail

DOMAIN_DEFAULT="relay.5ftmag.com"
read -rp "중계 도메인 [${DOMAIN_DEFAULT}]: " DOMAIN < /dev/tty || DOMAIN=""
DOMAIN="${DOMAIN:-$DOMAIN_DEFAULT}"

echo "▸ 패키지 설치 (node, caddy)..."
apt-get update -qq
apt-get install -y -qq nodejs curl debian-keyring debian-archive-keyring apt-transport-https >/dev/null
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

echo "▸ 중계 서버 설치..."
mkdir -p /opt/naver-relay
curl -fsSL https://raw.githubusercontent.com/4restyou/5ftmag-website/main/relay/naver-relay.mjs -o /opt/naver-relay/naver-relay.mjs

RELAY_KEY=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
cat > /etc/naver-relay.env <<EOF
RELAY_KEY=${RELAY_KEY}
PORT=8787
EOF
chmod 600 /etc/naver-relay.env

cat > /etc/systemd/system/naver-relay.service <<'EOF'
[Unit]
Description=5ft.mag naver commerce relay
After=network.target

[Service]
EnvironmentFile=/etc/naver-relay.env
ExecStart=/usr/bin/node /opt/naver-relay/naver-relay.mjs
Restart=always
RestartSec=3
User=nobody

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now naver-relay

echo "▸ Caddy TLS 설정 (${DOMAIN})..."
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
  reverse_proxy 127.0.0.1:8787
}
EOF
systemctl restart caddy

PUBLIC_IP=$(curl -fsS https://api.ipify.org || echo "확인 실패")

echo
echo "════════════════════════════════════════════════════"
echo "✅ 설치 완료"
echo
echo "1) 네이버 커머스API센터의 'API호출 IP' 에 등록할 IP:"
echo "   ${PUBLIC_IP}"
echo
echo "2) 도메인 DNS 확인: ${DOMAIN} 의 A 레코드가 위 IP 를 가리켜야"
echo "   TLS 인증서가 발급됩니다."
echo
echo "3) 내 컴퓨터 터미널에서 (5ftmag-website-clean 폴더):"
echo "   supabase secrets set NAVER_RELAY_URL=https://${DOMAIN} NAVER_RELAY_KEY=${RELAY_KEY}"
echo
echo "4) 동작 확인: 브라우저에서 https://${DOMAIN}/healthz → ok"
echo "════════════════════════════════════════════════════"
