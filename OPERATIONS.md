# 5ft.mag 운영 체크리스트

배포 전에 사이트가 깨지지 않도록 확인하는 최소 절차 + 외부 서비스 가동을 위한 일회성 설정.

## 인프라 1단계 — 외부 서비스 가동 (한 번만)

코드에 깔린 인프라(법무 / 분석 / 모니터링 / 알림 / DB 자동화 / 테스트)를
**실제 가동**시키려면 외부 계정/시크릿이 필요합니다. 각 항목은 한 번만 설정.

### 법무 페이지 — 즉시 동작 ✅
`legal/terms.html` / `legal/privacy.html` / `legal/copyright.html` 가 자동으로
footer 에 링크 inject 됨 (site-common.js). 별도 설정 불필요.
- [ ] 변호사 검토 — 초안을 법무팀에 보여서 4rest 사업자 정보·관할 법원·환불 조건이 정확한지 확인

### Plausible Analytics (트래픽) — 도메인 등록 + 1 줄 채우기 ⚠️
- [ ] [plausible.io](https://plausible.io) 가입 → `5ftmag.com` 등록
- [ ] `js/analytics.js` 의 `PLAUSIBLE_DOMAIN = ''` 에 도메인 입력 후 push

### Sentry (JS 에러) — DSN 받아 1 줄 채우기 ⚠️
- [ ] [sentry.io](https://sentry.io) 가입 → Browser JavaScript Project → DSN 받음
- [ ] `js/analytics.js` 의 `SENTRY_DSN = ''` 에 DSN 붙여넣고 push

### 운영 알림 (사진 투고/매물 신고) — Slack/Discord webhook 등록 ⚠️
- [ ] Supabase Dashboard → Database → Extensions → **pg_net** 활성화
- [ ] Slack(Incoming Webhooks) 또는 Discord(채널 → 통합 → 웹후크)에서 webhook URL 생성
- [ ] Supabase Dashboard → **Vault** → 새 secret
  - 이름: `notification_webhook_url`
  - 값: 위 webhook URL
- [ ] 마이그레이션 `20260515000004_notifications_webhook.sql` 가 적용되면 자동 가동
- 끄려면: vault secret 비우거나 `DROP TRIGGER notify_new_submission ON public.reader_submissions;` / `DROP TRIGGER notify_new_market_report ON public.market_reports;`

### DB 마이그레이션 자동화 — GitHub Secrets 3종 ⚠️
`.github/workflows/db-deploy.yml` 가 `supabase/migrations/**` 변경된 main 머지에서 자동 실행.
- [ ] `SUPABASE_ACCESS_TOKEN` — [Supabase tokens](https://supabase.com/dashboard/account/tokens)
- [ ] `SUPABASE_PROJECT_REF` — `https://supabase.com/dashboard/project/<REF>` 의 `<REF>`
- [ ] `SUPABASE_DB_PASSWORD` — 프로젝트 Settings → Database → Connection Password

세 가지 등록하면 다음부터 SQL Editor 안 들어가도 됨.

### Playwright 스모크 테스트 (자동) ✅
- 코드: `playwright.config.js`, `tests/smoke.spec.js`, `scripts/static-server.mjs`
- 워크플로우: `.github/workflows/test.yml` — main push + PR 시 자동 실행
- 로컬: `npm install && npx playwright install --with-deps chromium && npm test`

### 아직 라이브에 안 들어간 마이그레이션
자동화가 처음 도는 시점부터 자동 적용. 그 전에 푸시된 건 한 번 수동 실행 필요:
- `supabase/migrations/20260515000004_notifications_webhook.sql` — pg_net trigger + webhook
- 그 외 5개 마이그레이션은 이미 적용했을 수 있음 (각 파일 멱등 패턴이라 재실행 OK)

---


## 배포 전 필수 명령

```bash
npm run qa:release
```

`npm run qa:release`는 RSS와 sitemap을 먼저 최신 공개 글 기준으로 다시 만든 뒤 `npm run qa`를 실행합니다.

`npm run qa`는 다음을 확인합니다.

- HTML의 로컬 `src`/`href` 참조가 실제 파일로 존재하는지
- `data/*.json`의 `page`, `link`, `image`, `thumbnail`, `src` 참조가 실제 파일로 존재하는지
- 병합 충돌 마커가 남아 있지 않은지
- `stories/12`의 이전 깨진 이미지명으로 회귀하지 않았는지
- `scripts/*.mjs`, `scripts/*.js`, `js/*.js` 문법이 깨지지 않았는지
- 공개 글의 페이지와 썸네일이 존재하는지

## 이미지 운영 규칙

스토리 이미지는 다음 이름을 우선 사용합니다.

```text
img/stories/XX/cover.jpg
img/stories/XX/detail-01.jpg
img/stories/XX/detail-02.jpg
img/stories/XX/sample-01.jpg
img/stories/XX/sample-02.jpg
```

웹용 이미지는 긴 변 2000px 이하를 기본으로 하고, 가능하면 같은 이름의 `.webp` 페어를 둡니다.

```bash
npm run optimize-images -- img/stories/XX
npm run qa
```

원본 고해상도 파일은 배포 폴더가 아니라 별도 보관 위치에 둡니다.

## 배포 전 눈으로 볼 화면

최소 아래 화면을 데스크톱과 모바일 폭에서 확인합니다.

- `/`
- `/stories.html`
- `/films.html`
- `/about.html`
- 가장 최근 글 상세 페이지

확인 기준:

- 깨진 이미지 아이콘이나 alt 텍스트 노출 없음
- 헤더/모바일 메뉴 동작
- 다크모드 토글 동작
- 최신 글 카드와 관련 글 카드 이미지 정상

## 배포 후 공개 URL 확인

푸시 후 Netlify 배포가 끝나면 캐시 우회를 위해 커밋 해시를 붙여 확인합니다.

```bash
curl -I "https://www.5ftmag.com/stories/12.html?v=<commit>"
curl -I "https://www.5ftmag.com/data/stories.json?v=<commit>"
```

이미지 교체가 있었던 글은 대표 이미지와 샘플 이미지를 직접 확인합니다.

## 작업 기준 정리

로컬 작업 폴더에 미추적 이미지나 오래된 수정이 많은 상태에서는 바로 `pull`/`merge`하지 않습니다.
먼저 별도 worktree에서 원격 최신 `main`을 기준으로 작업합니다.

```bash
git fetch origin
git worktree add /tmp/5ftmag-work origin/main
```

이 방식이면 기존 로컬 작업물을 잃지 않고 운영 수정만 안전하게 배포할 수 있습니다.
