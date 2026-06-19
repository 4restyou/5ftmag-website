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
