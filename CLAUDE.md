# CLAUDE.md

Claude Code 가 이 저장소에서 작업할 때 따라야 할 정책.

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
