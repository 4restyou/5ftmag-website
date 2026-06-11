# .claude/skills/

Claude Code 세션에 자동 로드되는 프로젝트 전용 스킬 디렉토리.

## 자체 제작 스킬

- **add-lab** — 5ft.mag 필름 현상소(labs) 데이터 관리 워크플로

## 외부 스킬 (ibelick/ui-skills, MIT)

[ibelick/ui-skills](https://github.com/ibelick/ui-skills) (© 2026 Julien Thibeaut, MIT) 에서 우리 vanilla HTML/CSS/JS 스택에 맞는 3개만 골라 원본 그대로 가져옴. 원본 라이선스 사본은 `UI-SKILLS-LICENSE`.

| 스킬 | 우리 적용 영역 |
|---|---|
| `fixing-accessibility` | a11y 감사 — ARIA, 키보드 내비, 포커스, 폼 에러 |
| `fixing-metadata` | SEO 감사 — title/description/canonical/OG/JSON-LD |
| `fixing-motion-performance` | 모션 성능 — 레이아웃 thrashing, 컴포지터, blur |

업스트림이 Tailwind/React 전제로 일부 작성된 부분이 있어서 우리 스택에 적용할 때는 vanilla 등가물로 읽으면 됨 (transform/opacity 규칙, WCAG 가이드 등은 스택 무관하게 그대로 유효).

### CLAUDE.md 우선

스킬의 가이드와 `CLAUDE.md` 의 프로젝트 정책이 충돌하면 **CLAUDE.md 가 우선**한다. 특히:
- em-dash (`—`) 금지 (CLAUDE.md), 스킬 본문의 영문 em-dash 는 가이드 텍스트일 뿐 우리 글에는 적용 안 됨
- "Tailwind 사용" 가정 무시 — 우리는 vanilla CSS + tokens.css
- "motion/react" 가정 무시 — 우리는 vanilla CSS transition
- Surgical Changes 원칙 (CLAUDE.md) 과 "tool boundaries: minimal changes" (스킬) 는 같은 방향
