# Secret 운영 / 회전 절차

5ft.mag 운영에 쓰이는 시크릿들을 누가 어디에 두고, 언제 어떻게 바꾸는지 정리.

## 시크릿 목록

| 이름 | 위치 | 변경 빈도 | 변경 시 영향 |
|---|---|---|---|
| `VAPID_PRIVATE_KEY` | Supabase Edge Function Secrets | 사고 시에만 | 모든 푸시 구독 endpoint 재생성 필요 (전원 재구독) |
| `VAPID_PUBLIC_KEY` | Edge Function Secrets + `js/db-client.js` (코드) | private 와 동시 | 〃 |
| `VAPID_SUBJECT` | Edge Function Secrets | 메일 변경 시 | 즉시 반영 |
| `PUSH_DISPATCH_SECRET` | Edge Function Secrets + Vault `push_dispatch_secret` | 6개월 1회 또는 사고 시 | DB 트리거 ↔ Edge Function 인증 |
| Vault `push_function_url` | Supabase Vault | URL 변경 시 | DB 트리거 호출 대상 |
| Service Role Key | Edge Function 자동 주입 (`SUPABASE_SERVICE_ROLE_KEY`) | Supabase 가 관리 | — |
| `SUPABASE_ACCESS_TOKEN` | GitHub Secrets (CI 용) | 사용자 키 만료 시 | CI 만 영향 |
| `SUPABASE_DB_PASSWORD` | GitHub Secrets | DB 비밀번호 변경 시 | 〃 |

## VAPID 키 회전 (사고 시)

1. **새 키 생성** — 로컬에서:
   ```bash
   node -e "
   const { generateKeyPairSync } = require('crypto');
   const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
   const pub = publicKey.export({ format: 'jwk' });
   const priv = privateKey.export({ format: 'jwk' });
   const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+\$/,'');
   const xBuf = Buffer.from(pub.x, 'base64url');
   const yBuf = Buffer.from(pub.y, 'base64url');
   const pubBuf = Buffer.concat([Buffer.from([0x04]), xBuf, yBuf]);
   console.log('PUBLIC:', b64u(pubBuf));
   console.log('PRIVATE:', b64u(Buffer.from(priv.d, 'base64url')));
   "
   ```
2. **Edge Function Secrets** 의 `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY` 둘 다 교체
3. **`js/db-client.js`** 의 `VAPID_PUBLIC_KEY` 상수 새 값으로 — PR 로 머지
4. **모든 구독자가 재구독 필요** — `push_subscriptions` 테이블 비우거나, 클라이언트가 다음 방문 시 `pushsubscriptionchange` 로 자동 재구독 시도 (SW 핸들러 있음). 단 사용자가 사이트 재방문해야만 갱신됨
5. 사고가 아니라면 이 회전은 안 하는 게 좋음 — 회전하는 순간 기존 구독은 모두 무효

## PUSH_DISPATCH_SECRET 회전 (정기)

위 둘 (Edge Function Secrets + Vault) 이 항상 같은 값이어야 동작.

1. 새 시크릿 생성: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Vault `push_dispatch_secret` 업데이트
3. Edge Function Secrets `PUSH_DISPATCH_SECRET` 업데이트
4. 두 업데이트 사이 약 5~10초 정도 푸시가 403 으로 막힐 수 있음. 트래픽 적은 시간대에 진행
5. 알림 INSERT 한 번으로 정상 동작 확인

## workroom-by-4rest 프로젝트에 잘못 넣었던 시크릿 정리

세션 #2026-06-14 에 5ftmag 가 아닌 다른 Supabase 프로젝트(workroom-by-4rest) 에 같은 이름의 시크릿을 잘못 등록한 적 있음. 해당 프로젝트엔 push 인프라가 없어 무해하지만, 정리하려면:

1. Supabase Dashboard → `workroom-by-4rest` 프로젝트 선택
2. Edge Functions → Secrets → `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `PUSH_DISPATCH_SECRET` 삭제
3. Vault → `push_function_url`, `push_dispatch_secret` 삭제

workroom 도 향후 푸시를 붙일 거라면, **5ft 와 별개의 VAPID 키 쌍을 새로 만들어** 등록하는 게 표준 (같은 키 공유는 권장되지 않음).

## 사고 대응 — 푸시 발송 정지

푸시 발송을 즉시 중단하려면:
- **빠른 방법**: Supabase Vault 의 `push_function_url` 을 빈 문자열로 변경 → DB 트리거가 silent no-op
- **완전 정지**: Edge Function `send-push` 를 dashboard 에서 비활성화

이 두 방법 모두 in-app 알림 (종 아이콘 패널) 은 그대로 동작. OS 푸시만 멈춤.

## 정기 점검 체크리스트 (분기 1회 권장)

- [ ] `push_subscriptions` row 수 정상 범위인가 (비정상 급증 = 자동화 의심)
- [ ] `admin_push_subscriptions_purge(30)` 한 번 실행해서 stale endpoint 정리
- [ ] `app_events` 30일치 push_subscribed 추이 — 0 이면 인프라 점검
- [ ] Edge Function 로그에 5xx 에러 비율

## 알려진 TODO

- **PR CI 의 migration dry-run** — 2026-06-14 article_drafts `profiles.id` 오타가
  머지 후에야 db-deploy 에서 발견된 사고가 있었다. PR 단계에서 임시 postgres
  + Supabase stub schema 로 migration 들을 적용해서 사후 발견을 막는 step 을
  test.yml 에 추가하는 작업이 미해결. Supabase 전용 객체(auth.users, vault,
  pg_net 등) 의 stub 신뢰도 확보가 관건이라 별도 PR 로 분리됨.
