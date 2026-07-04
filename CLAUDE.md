# CLAUDE.md

Claude Code 가 이 저장소에서 작업할 때 따라야 할 정책.

## 작업 원칙

1. **Think Before Coding** — 코드를 쓰기 전에 원인과 영향 범위를 먼저 파악한다. 추측으로 바로 고치지 않는다.
2. **Simplicity First** — 가장 단순한 해법을 우선한다. 불필요한 추상화, 미래 대비용 일반화, 군더더기 방어 코드를 넣지 않는다.
3. **Surgical Changes** — 요청한 문제만 최소한으로 건드린다. 곁다리 리팩터링이나 무관한 정리는 하지 않는다.
4. **Goal-Driven Execution** — 사용자의 실제 목표를 기준으로 움직인다. 목표 달성에 필요한 것만 하고, 끝나면 결과로 확인한다.
5. **Propose Before Acting on Suggestions** — 사용자가 "어떨까?", "~게 어떨까?" 처럼 제안·탐색형으로 물으면 코드 변경 전에 의견과 트레이드오프 먼저 짧게 답하고 명시적 진행 지시 ("진행", "해줘" 등) 를 기다린다. 명령형 지시는 바로 실행.

## 배포 정책

PR 생성 후 CI(`validate`) 통과하면 **사용자가 "배포하지 마" / "PR 만 만들어" 등으로 명시적 중단을 지시하지 않는 한** 머지·배포까지 자동 진행한다.

- 자동 파이프라인:
  - **Netlify** — `main` 머지 시 정적 사이트 자동 빌드/배포 (1–2분)
  - **GitHub Actions** (`.github/workflows/db-deploy.yml`) — `supabase/migrations/**` 변경 시 `supabase db push` 자동 실행
- 머지 방식: **squash** (커밋 메시지 = PR 제목 + ` (#NN)`)
- main 에 직접 커밋 금지. 모든 작업은 새 브랜치 `claude/<feature-or-fix-slug>` 에서 진행 → PR → squash 머지

### 배포 루프 (표준 절차)

1. 브랜치 → 커밋 → 푸시 → PR 생성.
2. `validate` 성공을 확인한 뒤 squash 머지. **auto-merge 는 쓰지 않는다** (커밋이 다 올라가기 전에 첫 커밋만 머지된 사고 이력 3회). CI 대기는 150초 간격으로 재확인.
3. 머지 후 후속 워크플로우까지 확인하고 보고한다: 마이그레이션 포함이면 **db-deploy**, `supabase/functions/**` 포함이면 **functions-deploy** 의 성공 여부.
4. `fatal: no merge base` 로 validate 가 죽으면 코드 문제가 아니다 (squash 머지 직후 얕은 fetch 플레이크). 브랜치에 `git merge origin/main` 후 다시 푸시하면 해결.

## 인프라 / DB 환경 (주의)

DB 관련 작업 전에 반드시 인지. 자세한 진단·할 일은 `docs/maintenance.md`.

- **Supabase 워크스페이스가 둘이고 스키마가 다르다.**
  - workroom: `profiles_public` 뷰 + `profiles.is_editor` 존재.
  - production: `profiles` 에 `id`(PK)/`role`('admin'|'user'), `is_editor`·`profiles_public` **없을 수 있음**.
  - SQL 을 실행할 땐 **어느 워크스페이스인지 먼저 확인**. prod 에서 테스트.
- **편집부 권한 체크는 스키마 확정 전까지 단정하지 말 것.** `is_editor` 와 `role='admin'` 두 패턴이 혼재.
- **`db-deploy.yml` 은 `SUPABASE_ACCESS_TOKEN` 시크릿에 의존.** 만료되면 마이그레이션 자동 적용이 조용히 실패한다 (`Unauthorized`). 마이그레이션 머지 후엔 db-deploy 워크플로우 성공 여부를 확인하고, 실패면 Studio SQL Editor 에 직접 적용 + 시크릿 갱신 안내.
- **마이그레이션 폴더가 prod 스키마의 완전한 원본이 아니다.** `comments`/`likes`/`market_listings`/`profiles_public` 등은 prod 에 있으나 `supabase/migrations/**` 에 정의가 없다. 레포만으로 DB 재현 불가. `node scripts/db-audit.mjs` 로 현황 확인.
- 마이그레이션은 **재실행 안전(replay-safe)** 하게 작성 (`if not exists`, `create or replace`, `drop policy if exists`).
- **기존 데이터가 위반할 수 있는 제약(유니크·NOT NULL 등)을 추가할 땐 prod 데이터를 먼저 확인한다.** 사례: 수동 부여 열람권들의 order_ref 가 같은 입금자명 메모여서 전체 유니크 인덱스 생성이 실패(#590). 필요하면 부분 인덱스로 범위를 좁힌다.
- **실패한 마이그레이션은 기록되지 않는다.** 새 파일을 만들지 말고 **같은 파일을 수정해 재적용**한다.
- RLS 편집부 정책은 `profiles.user_id + is_editor` 패턴으로 통일 (다른 패턴으로 썼다가 prod 컬럼 불일치로 실패한 이력 있음).

## 글쓰기 규칙

- 제목 / 본문에 em-dash (`—`) 사용 금지. 마침표·쉼표·괄호로 풀어쓴다.
- byline 별 문체 유지:
  - **5ft.mag 편집부** — 분석적·반성적
  - **Film Social Club** — 사담조가 가미된 가벼운 분위기
- 20년차 편집부가 쓴 것처럼. AI 스러운 어조와 영문 직역체 금지.
  - 어색한 비유 (예: "동선이 이상하다", "이름의 사슬", "한 발 떨어져 보면", "들고 들어왔다") 쓰지 않는다.
  - 번역기 단어 (예: "통상의", "본질적으로", "친화적인", "더 친한가", "공통된 지적", "정상가 인상으로") 쓰지 않는다.
  - "X의 Y의 Z" 식 명사 연쇄 / "~로 보인다 / ~인 셈이다" 반복으로 추상화하지 않는다.
  - 문장과 문단이 한국어로 자연스럽게 이어지도록 다듬는다. 짧은 문장과 구체적인 동사가 우선.
- 사실 확인 안 된 내용은 쓰지 않는다.
- 본문 이미지에 회색 라인 넣지 않음 (썸네일도 동일, 흰 배경이어도 없음).

## 캐시 버스트

정적 자산(`css/*.css`, `js/*.js`) 을 수정하면 그 파일을 참조하는 모든 HTML 의 `?v=YYYYMMDD-feature` 쿼리를 일괄 갱신한다.

- **같은 자산은 전 페이지 단일 버전**이어야 한다. 일부 페이지만 갱신하면 버전이 갈라져 캐시 중복 다운로드 + 스타일 불일치가 생긴다 (tokens.css 가 4개 버전으로 갈라졌던 사례).
- 갱신 대상에 `scripts/templates/` 안의 템플릿도 포함한다 (템플릿이 옛 버전을 물고 있으면 새로 만드는 페이지마다 stale 버전이 전파된다).
- 갱신 후 `grep -rho "파일명?v=[0-9a-z-]*" --include="*.html" . | sort | uniq -c` 로 단일 버전인지 확인한다.

## 외부 서비스 연동 체크리스트

외부 SDK·API(결제, 지도 등)를 붙일 때 순서대로:

1. **CSP 4개 지시어 각각** 확인: `script-src`(SDK 로드) / `connect-src`(API 호출) / `frame-src`(결제창 등 iframe) / `form-action`(폼 제출). `netlify.toml` 의 한 줄 CSP 에 추가하고 `tests/unit/security-headers.spec.mjs` 통과 확인.
2. 서비스가 **옛 브랜드 도메인을 함께 쓸 수 있다** (포트원이 `*.iamport.co` 로 통신했던 사례). 문서에 없으면 3번으로 확정한다.
3. 막히면 추측으로 도메인을 늘리지 말고 **사용자에게 콘솔(⌘+⌥+J) 캡처를 요청**한다. `Refused to connect to 'https://...'` 줄에 막힌 도메인이 정확히 찍힌다.
4. **비밀키는 채팅에 받지 않는다.** `supabase secrets set KEY=...` 명령을 안내한다 (설정 즉시 반영, 함수 재배포 불필요). 공개키(anon key, Store ID, Channel Key)는 클라이언트 하드코딩 허용.
5. 새 엣지 함수를 만들면 `functions-deploy.yml` 이 그 함수를 배포하는지 확인한다.

## 필드 추가 3곳 동기화

DB 컬럼을 추가하면 반드시 세 곳을 함께 고친다. 하나라도 빠지면 "저장은 되는데 화면에 안 나오는" 버그가 된다 (shop `ebook_slug` 사례):

1. **마이그레이션** (`supabase/migrations/`)
2. **admin 폼** — HTML input + admin JS 의 load(`form.x.value = row?.x`)와 save(row 빌드) 양쪽
3. **공개 화면 매핑 둘 다** — `scripts/build-*.mjs` 의 rowToJson **과** 클라이언트 JS 의 rowToJson (shop 등은 DB 우선 로드라 클라이언트 매핑이 실제 경로다)

## 디버깅 프로토콜 (증상 → 1순위 용의자)

수정 전에 콘솔 증거를 확보한다. 추측 수정 금지.

| 증상 | 1순위 용의자 |
|---|---|
| 모달·요소가 "안 뜸" (에러 없음) | z-index (리더 오버레이가 2200 — 그 위에 올려야 함), 버튼 안의 텍스트는 `color` 미상속 |
| `Failed to fetch` / `Load failed` | CSP `connect-src` 차단 — 콘솔에서 막힌 도메인 확인 |
| 고쳤는데 그대로 | 캐시버스트 누락 또는 브라우저 캐시 — `⌘+Shift+R` 안내 |
| 로그인 직후 동작 안 함 | 세션 폴링 지연 — `db().isReady()` / `session()` 대기 패턴 확인 |
| jsdelivr `.map` CSP 경고 | 소스맵 차단 — 무해, 무시 |

## 사용자(운영자) 커뮤니케이션

- 운영자는 개발자가 아니다. **터미널 안내는 한 번에 한 단계**: 명령 한 줄 + 예상 결과 + 실패 시 나올 메시지별 대응을 함께 주고, 출력을 붙여받아 확인한 뒤 다음 단계로 간다.
- 에러는 사용자 화면(alert·콘솔)에 실제 메시지를 표면화한다. 원인 모를 때 "다시 시도해 주세요"만 띄우면 디버깅이 안 된다. 캡처 한 장으로 원인이 잡히게 만든다.
- 배포가 끝나면 "무엇을 어떻게 확인하면 되는지"를 결과별 분기(되면 A, 안 되면 B 캡처)로 안내한다.

## 데이터 소스 (admin 페이지가 source of truth)

다음 카탈로그·자료는 **Supabase 테이블이 원본**이고, 정적 JSON(`data/*.json`) 은 *빌드 산출물*이다. 빌드 시 `scripts/build-*.mjs` 가 DB 를 dump 해서 정적 파일을 덮어쓴다.

| 정적 파일 | 원본 (DB) | admin UI | 빌드 스크립트 |
|---|---|---|---|
| `data/films.json` | `films` 테이블 | `admin/films.html` | `scripts/build-films.mjs` |
| `data/labs.json` | `labs` 테이블 | `admin/labs.html` | `scripts/build-labs.mjs` |
| `data/authors.json` | `profiles` 등 | — | `scripts/build-authors.mjs` |

### 신규 항목 추가 절차

**git push 로 `data/films.json` 만 수정해도 라이브에 반영되지 않는다.** 빌드 시 DB dump 로 덮어쓰여 사라지기 때문.

올바른 흐름:

1. **admin 페이지에서 등록** — `admin/films.html` "+ 새 필름" / `admin/labs.html` 등. 가장 안전. 즉시 반영.
2. **수량이 많으면 SQL INSERT** — Supabase Studio SQL Editor 에서 한 번에. `films` 의 `aliases`/`photographers`/`photos` 는 **jsonb** (예: `'[...]'::jsonb`). `ON CONFLICT (slug) DO NOTHING` 권장.
3. 정적 JSON 에 직접 추가하는 경우엔 `build-films.mjs` 의 supplement 로직(DB 에 없는 slug 만 보강) + `films-page.js` 클라이언트 supplement 가 자동 살려주지만, **admin 페이지들은 DB 만 보므로 거기서는 안 보인다** — 임시 노출만 되고 운영 관리 불가. 빠른 노출이 끝나면 위 1·2 로 옮겨야 한다.

### 정공법 우선
세 경로 중 1·2 가 정공법, 3 은 안전망. **신규 작업은 항상 1 또는 2 로 시작**한다.

## 의도된 디자인 선택 (평가에서 제외)

평가·리뷰 시 다음 항목은 "갭" 으로 지적하지 않는다. 의도된 선택이다.

- **홈(`index.html`) 의 hero 영역 부재** — split-layout 으로 바로 시작하는 게 의도.
- **글 카드(`stories.html`·홈 articles)의 카테고리/날짜 인라인 미노출** — 이미지 위 오버레이만으로 유지하는 게 의도.
