# 네이버 커머스 중계 서버 설정 (고정 IP)

이북 주문번호 인증(`ebook-redeem` 엣지 함수)은 네이버 커머스 API 를 호출한다.
커머스 API 는 **등록된 IP 에서만** 호출을 허용하는데 Supabase 엣지 함수에는
고정 IP 가 없다. 그래서 고정 IP VPS(AWS Lightsail)에서 중계 서버를 돌리고,
엣지 함수의 모든 커머스 호출을 이 서버로 보낸다.

```
ebook-redeem (엣지 함수)  ──X-Relay-Key──▶  중계 서버(고정 IP)  ──▶  api.commerce.naver.com
```

관련 파일:
- `relay/install.sh` — VPS 설치 스크립트 (node + Caddy + systemd)
- `relay/naver-relay.mjs` — 중계 서버. `/forward` 로 받은 요청을 `api.commerce.naver.com` 으로만 전달. `X-Relay-Key` 불일치 시 403.
- `supabase/functions/ebook-redeem/index.ts` — `NAVER_RELAY_URL`·`NAVER_RELAY_KEY` 가 설정돼 있으면 중계 경유, 없으면 직접 호출(로컬 테스트용).

기본 중계 도메인: `relay.5ftmag.com`

---

## 설정 절차

준비물: Lightsail 인스턴스 + 연결된 **고정 IP**, `5ftmag.com` DNS 관리 권한,
로컬에 Supabase CLI 로그인.

### 1. Lightsail 방화벽 개방 ⚠️
Lightsail 콘솔 → 인스턴스 → **Networking** 탭에서:
- 고정 IP 가 인스턴스에 연결돼 있는지 확인
- **포트 80(HTTP)·443(HTTPS)** 추가로 열기

> Lightsail 은 기본적으로 22(SSH)만 열려 있다. 80·443 을 열지 않으면
> Caddy 의 Let's Encrypt TLS 인증서 발급이 실패한다. `install.sh` 는
> OS 레벨만 다루므로 이 방화벽 설정은 콘솔에서 직접 해야 한다.

### 2. DNS A 레코드
`relay.5ftmag.com` 의 A 레코드가 **고정 IP** 를 가리키도록 추가한다.
(5ftmag.com DNS 관리처에서 설정 — 전파가 끝나야 TLS 가 발급된다.)

확인:
```bash
dig +short relay.5ftmag.com
# → 고정 IP 가 나와야 함
```

### 3. 설치 스크립트 실행
Lightsail 인스턴스에 SSH 접속 후 한 줄:
```bash
curl -fsSL https://raw.githubusercontent.com/4restyou/5ftmag-website/main/relay/install.sh | sudo bash
```
하는 일: node·Caddy 설치 → `naver-relay.mjs` 배치 → `RELAY_KEY` 자동 생성 →
systemd 서비스 등록(재부팅 자동 시작) → Caddy TLS 발급.
**마지막 출력에 나오는 `RELAY_KEY` 와 공개 IP 를 메모**한다.

### 4. 네이버 커머스 API센터에 IP 등록
커머스 API센터 → **'API 호출 IP'** 에 고정 IP 를 등록한다.

### 5. Supabase 시크릿 설정
로컬 터미널(레포 루트)에서, 스크립트가 출력한 값으로:
```bash
supabase secrets set \
  NAVER_RELAY_URL=https://relay.5ftmag.com \
  NAVER_RELAY_KEY=<3번에서 출력된 키>
```
> 기존 `NAVER_COMMERCE_CLIENT_ID` / `NAVER_COMMERCE_CLIENT_SECRET` 은
> 이미 설정돼 있다는 전제. 없으면 함께 설정한다.

시크릿을 바꾼 뒤에는 `ebook-redeem` 함수를 재배포해 반영한다:
```bash
supabase functions deploy ebook-redeem
```

### 6. 동작 확인
- 헬스체크: 브라우저/`curl` 로 `https://relay.5ftmag.com/healthz` → `ok`
- TLS: 인증서가 정상 발급됐는지(자물쇠) 확인
- 엔드투엔드: 사이트에서 이북 주문번호 인증 흐름을 1회 실제로 통과시켜 본다

---

## 점검 / 트러블슈팅

| 증상 | 확인 |
| --- | --- |
| `/healthz` 접속 안 됨 | Lightsail 80·443 방화벽, DNS A 레코드 전파, `systemctl status caddy` |
| TLS 인증서 미발급 | DNS 가 고정 IP 를 가리키는지, 80 포트 개방 여부 (Let's Encrypt HTTP-01) |
| 인증 시 relay fail (403) | Supabase `NAVER_RELAY_KEY` 와 서버 `/etc/naver-relay.env` 의 `RELAY_KEY` 일치 여부 |
| 커머스 API 가 IP 거부 | 커머스 API센터에 **고정 IP** 가 등록됐는지, Lightsail 아웃바운드 IP 가 그 IP 인지 |
| 중계 서버 상태 | `systemctl status naver-relay`, `journalctl -u naver-relay -n 50` |

서버 재시작:
```bash
sudo systemctl restart naver-relay
sudo systemctl restart caddy
```
