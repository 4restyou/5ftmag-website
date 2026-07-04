---
name: add-external-service
description: 외부 SDK·API(결제, 지도, 분석 등)를 5ft.mag 에 연동하거나, 연동한 기능이 "안 뜸/Failed to fetch/Load failed" 로 막힐 때 사용. CSP 4개 지시어 체크리스트 + 시크릿 정책 + 콘솔 기반 디버깅 절차.
---

# 외부 서비스 연동 (/add-external-service)

사례: PortOne 결제 연동이 CSP 누락으로 3연속 실패 (#577 script/frame, #580 connect-src, #581 옛 도메인 iamport.co).

## 1. CSP — netlify.toml 의 한 줄 정책에 4개 지시어 각각

| 지시어 | 필요한 경우 |
|---|---|
| `script-src` | SDK `<script>` 로드 (예: cdn.portone.io) |
| `connect-src` | SDK/클라이언트의 fetch·XHR·WebSocket (**가장 자주 빠뜨림**) |
| `frame-src` | 결제창·임베드 iframe |
| `form-action` | 폼 제출로 이동하는 결제/인증 |

- 수정 후 `npx vitest run tests/unit/security-headers.spec.mjs` 통과 확인.
- **서비스가 옛 브랜드 도메인을 함께 쓸 수 있다** (포트원 → `*.iamport.co`). 문서에 없으면 추측하지 말고 3번 절차로 확정.
- CSP 는 헤더라 캐시버스트 불필요. 배포 후 반영.

## 2. 키 정책

- **비밀키는 채팅으로 받지 않는다.** 사용자에게 명령을 안내:
  `supabase secrets set KEY_NAME=값` (프로젝트 폴더에서. 즉시 반영, 함수 재배포 불필요)
- 공개키(anon key, Store ID, Channel Key 등)는 클라이언트 하드코딩 허용. 어느 키가 공개인지 서비스 문서로 확인 후 구분해서 안내.
- 새 엣지 함수를 만들면: CORS 는 기존 함수(ebook-page 등)의 allowOrigin 패턴 복사, functions-deploy 가 디렉토리 스캔이므로 워크플로우 수정은 불필요하나 **머지 후 배포 성공을 확인**.

## 3. 막혔을 때 — 콘솔이 답이다

추측으로 도메인·코드를 늘리지 말 것. 순서:

1. 사용자에게 **콘솔 캡처 요청**: 맥 크롬 `⌘+⌥+J` → `⌘+Shift+R` 강력 새로고침 → 문제 동작 재현 → 빨간 줄 캡처.
2. 증상별 1순위 (CLAUDE.md 디버깅 프로토콜):
   - 아무것도 안 뜸 + 에러 없음 → **z-index** (리더 오버레이 2200 위) 또는 모달 생성 코드 미도달
   - `Failed to fetch` / `Load failed` → **connect-src** 차단. 콘솔의 `Refused to connect to 'https://...'` 도메인을 그대로 추가
   - 고쳤는데 그대로 → 캐시버스트 누락 (`node scripts/bump-version.mjs ...`) 또는 브라우저 캐시
   - jsdelivr `.map` 경고 → 소스맵 차단, 무해. 무시
3. 에러를 화면에 표면화: catch 에서 "다시 시도해 주세요" 만 띄우지 말고 `e.message` 를 함께 노출 + `console.error`. 캡처 한 장으로 원인이 잡히게.

## 4. 검증·배포

- 결제류는 서버 검증 필수 항목 확인: 상태(PAID 등) / 금액 == 서버측 가격 / 통화 / 상품 식별자 일치 / **재사용 차단**(order_ref 부분 유니크) / 환불 시 회수 경로.
- /ship 절차로 배포하고, 사용자 테스트 안내는 결과별 분기(되면 A, 안 되면 콘솔 캡처)로.
