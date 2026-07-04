---
name: ship
description: 5ft.mag 표준 배포 루프. 코드 변경을 브랜치 → PR → CI 확인 → squash 머지 → 후속 워크플로우 확인까지 끝까지 수행할 때 사용. "배포해", "머지까지 진행해", PR 을 만들고 CI 를 지켜봐야 하는 모든 작업에 적용.
---

# 배포 루프 (/ship)

CLAUDE.md "배포 정책 + 배포 루프" 의 실행 절차서. 이 순서를 벗어나지 않는다.

## 0. 시작 전 체크

- 지금 브랜치가 main 이면 즉시 새 브랜치 생성: `git checkout -B claude/<slug> origin/main` (main 직접 커밋 금지).
- css/js 를 수정했다면 캐시버스트: `node scripts/bump-version.mjs <css/x.css|js/x.js> <YYYYMMDD-feature>` (전 페이지 + 템플릿 일괄. 수동 sed 금지 — 버전 분열은 CI 가 실패시킨다).
- 로컬 검증: `node scripts/validate-assets.mjs` (exit 0), DB 관련이면 `node scripts/db-audit.mjs`, JS 수정이면 `node --check <파일>`, 테스트 관련이면 `npx vitest run`.

## 1. 커밋 → 푸시 → PR

- 커밋 메시지: 한 줄 요약 + 본문(무엇을/왜). 모델 ID 는 넣지 않는다.
- `git push -u origin <branch>` (네트워크 실패 시 2/4/8/16초 백오프 재시도).
- PR 생성. 본문에 원인/변경/검증을 적고, 머지 후 수동 설정이 필요하면 "머지 후" 섹션으로 명시.

## 2. CI 확인 → 머지

- **auto-merge 금지** (커밋 완료 전 첫 커밋만 머지된 사고 3회).
- `validate` 체크런을 확인. in_progress 면 **150초 뒤 재확인** (반복).
- success → **squash 머지**, 커밋 제목 = PR 제목 + ` (#NN)`.
- failure → 로그를 읽고 원인별 대응:
  - `fatal: no merge base` → 코드 문제 아님(직전 squash 머지 + 얕은 fetch 플레이크). 브랜치에 `git merge origin/main --no-edit` 후 재푸시.
  - 그 외 → 실제 원인 수정 후 재푸시.

## 3. 머지 후 확인 (여기까지가 배포)

- `supabase/migrations/**` 포함 → **db-deploy** 워크플로우 성공 확인. 실패 시:
  - `Unauthorized` → SUPABASE_ACCESS_TOKEN 만료. 사용자에게 갱신 안내 + Studio SQL Editor 직접 적용 안내.
  - SQL 에러(23505 등) → prod 기존 데이터 충돌. **같은 마이그레이션 파일을 수정**해 재적용 (실패한 마이그레이션은 기록되지 않음. 새 파일 만들지 말 것).
- `supabase/functions/**` 포함 → **functions-deploy** 성공 확인 (전 함수 디렉토리 스캔 배포).
- Netlify 는 main 머지 시 자동 (1~2분).

## 4. 사용자 보고

- 머지 커밋 SHA + 무엇이 배포됐는지 + **사용자가 확인할 방법** (되면 A, 안 되면 B 캡처)을 결과별 분기로 안내.
- 남은 수동 작업(시크릿 설정 등)이 있으면 명령어까지 정확히.
