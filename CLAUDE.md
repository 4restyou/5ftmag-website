# CLAUDE.md

Claude Code 가 이 저장소에서 작업할 때 따라야 할 정책.

## 작업 원칙

1. **Think Before Coding** — 코드를 쓰기 전에 원인과 영향 범위를 먼저 파악한다. 추측으로 바로 고치지 않는다.
2. **Simplicity First** — 가장 단순한 해법을 우선한다. 불필요한 추상화, 미래 대비용 일반화, 군더더기 방어 코드를 넣지 않는다.
3. **Surgical Changes** — 요청한 문제만 최소한으로 건드린다. 곁다리 리팩터링이나 무관한 정리는 하지 않는다.
4. **Goal-Driven Execution** — 사용자의 실제 목표를 기준으로 움직인다. 목표 달성에 필요한 것만 하고, 끝나면 결과로 확인한다.

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
- 20년차 편집부가 쓴 것처럼. AI 스러운 어조 금지.
- 사실 확인 안 된 내용은 쓰지 않는다.
- 본문 이미지에 회색 라인 넣지 않음 (썸네일도 동일, 흰 배경이어도 없음).

## 캐시 버스트

정적 자산(`css/*.css`, `js/*.js`) 을 수정하면 그 파일을 참조하는 모든 HTML 의 `?v=YYYYMMDD-feature` 쿼리를 일괄 갱신한다.

## 의도된 디자인 선택 (평가에서 제외)

평가·리뷰 시 다음 항목은 "갭" 으로 지적하지 않는다. 의도된 선택이다.

- **홈(`index.html`) 의 hero 영역 부재** — split-layout 으로 바로 시작하는 게 의도.
- **글 카드(`stories.html`·홈 articles)의 카테고리/날짜 인라인 미노출** — 이미지 위 오버레이만으로 유지하는 게 의도.
