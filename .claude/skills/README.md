# .claude/skills/

Claude Code 세션에 자동 로드되는 프로젝트 전용 스킬 디렉토리.

## 자체 제작 스킬

- **add-lab** — 5ft.mag 필름 현상소(labs) 데이터 관리 워크플로
- **ship** — 표준 배포 루프 (브랜치 → PR → CI 폴링 → squash 머지 → 후속 워크플로우 확인)
- **new-article** — 기사 제작 파이프라인 (원고 추출 → 이미지 처리 → 페이지 생성 → stories.json 등록)
- **add-external-service** — 외부 SDK/API 연동 (CSP 체크리스트 + 시크릿 정책 + 콘솔 디버깅)

## 외부 스킬 (ibelick/ui-skills, MIT)

[ibelick/ui-skills](https://github.com/ibelick/ui-skills) (© 2026 Julien Thibeaut, MIT) 에서 우리 vanilla HTML/CSS/JS 스택에 맞는 3개만 골라 원본 그대로 가져옴. 원본 라이선스 사본은 `UI-SKILLS-LICENSE`.

| 스킬 | 우리 적용 영역 |
|---|---|
| `fixing-accessibility` | a11y 감사 — ARIA, 키보드 내비, 포커스, 폼 에러 |
| `fixing-metadata` | SEO 감사 — title/description/canonical/OG/JSON-LD |
| `fixing-motion-performance` | 모션 성능 — 레이아웃 thrashing, 컴포지터, blur |

업스트림이 Tailwind/React 전제로 일부 작성된 부분이 있어서 우리 스택에 적용할 때는 vanilla 등가물로 읽으면 됨 (transform/opacity 규칙, WCAG 가이드 등은 스택 무관하게 그대로 유효).

## 외부 스킬 (DietrichGebert/ponytail, MIT)

[DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (© 2026 DietrichGebert, MIT) 의 `skills/` 6개를 원본 그대로 가져옴. "가장 게으른 시니어 개발자" 처럼 코드를 쓰기 전에 사다리(꼭 필요한가 → 이미 있나 → 표준 라이브러리 → 네이티브 → 한 줄)를 밟아 최소한만 쓰게 함. 웹 세션엔 `/plugin` 이 없어서 훅·규칙 없이 스킬만 vendoring. 원본 라이선스 사본은 `PONYTAIL-LICENSE`.

| 스킬 | 하는 일 |
|---|---|
| `ponytail` | 게으른(최소) 구현 모드. `/ponytail lite\|full\|ultra` 로 강도 조절, 기본 full |
| `ponytail-review` | diff 를 오버엔지니어링 관점으로만 리뷰 (뭘 지울지) |
| `ponytail-audit` | 저장소 전체를 훑어 삭제·단순화 후보 랭킹 |
| `ponytail-debt` | 코드의 `ponytail:` 주석(의도된 지름길)을 장부로 수집 |
| `ponytail-gain` | 벤치마크 요약 스코어보드 (일회성 표시) |
| `ponytail-help` | ponytail 명령·모드 요약 카드 |

우리 프로젝트의 *Simplicity First / Surgical Changes* 와 같은 방향이라 코드 작업엔 그대로 유효. 단 주의:
- **운영자 소통은 예외** — ponytail 은 "코드 뒤 설명 3줄 이하" 로 짧게 몰지만, CLAUDE.md 의 "운영자는 개발자가 아니다, 한 번에 한 단계" 가 우선한다. 게으름은 *만드는 코드* 에만 적용, *답변 문장* 은 CLAUDE.md 규칙을 따른다.
- **훅/항상켜짐 규칙은 안 가져옴** — 플러그인 원본의 hooks/rules 는 우리 CLAUDE.md 와 중복이라 제외. 필요할 때 스킬로 호출하는 방식.
- 스킬 본문의 영문 em-dash·terse 예시는 가이드 텍스트일 뿐, 우리 글 규칙(em-dash 금지)엔 영향 없음.

### CLAUDE.md 우선

스킬의 가이드와 `CLAUDE.md` 의 프로젝트 정책이 충돌하면 **CLAUDE.md 가 우선**한다. 특히:
- em-dash (`—`) 금지 (CLAUDE.md), 스킬 본문의 영문 em-dash 는 가이드 텍스트일 뿐 우리 글에는 적용 안 됨
- "Tailwind 사용" 가정 무시 — 우리는 vanilla CSS + tokens.css
- "motion/react" 가정 무시 — 우리는 vanilla CSS transition
- Surgical Changes 원칙 (CLAUDE.md) 과 "tool boundaries: minimal changes" (스킬) 는 같은 방향
