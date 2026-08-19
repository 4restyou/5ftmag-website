# .claude/output-styles/

Claude Code 의 출력 스타일(output-style) 디렉토리. 스킬과 달리 **시스템 프롬프트 층위**에 올라가서, Claude 가 한국어로 답할 때의 문장 형태를 사전에 규율한다.

## fluent-korean (snflkd/fluent-korean, MIT)

[snflkd/fluent-korean](https://github.com/snflkd/fluent-korean) (© 2026 snflkd, MIT) 의 output-style 두 개를 원본 그대로 가져왔다. 라이선스 사본은 `FLUENT-KOREAN-LICENSE`.

웹 세션에는 `/plugin` 이 없어서 플러그인으로 설치하지 못한다. 그래서 원본 README 가 안내하는 대체 경로대로 md 파일만 이 디렉토리에 두고, `.claude/settings.json` 의 `outputStyle` 로 선택한다.

| 파일 | 쓰임 |
|---|---|
| `fluent-korean.md` | 코딩 지침을 유지한다. 이 저장소의 기본값 |
| `fluent-korean-not-coding.md` | 코딩 지침이 빠진 판. Claude 가 코드를 직접 고치지 않을 때 |

무엇을 고치는 지침인가:
- 문장 성분·조사·어미를 생략하지 않는다 (명사 나열식 전보체 방지)
- 명사구나 연결어미로 문장을 끊지 않고 서술어로 맺는다
- 일반 어휘 자리에 비유적 어휘를 넣지 않는다
- em-dash 를 쓰지 않고 콜론이나 접속사로 바꾼다
- 인용·코드·코드 주석에는 적용하지 않는다

## 바꾸는 방법

`.claude/settings.json` 의 `outputStyle` 값을 바꾼 뒤 새 세션을 시작한다. output-style 은 세션 시작 시점에 적용되므로 진행 중인 세션에는 반영되지 않는다.

```json
{ "outputStyle": "fluent-korean" }
```

끄려면 이 항목을 지운다.

## CLAUDE.md 우선

`CLAUDE.md` 의 정책과 충돌하면 CLAUDE.md 가 우선한다. 겹치거나 갈리는 지점은 다음과 같다.

- **em-dash 금지** — 양쪽이 같은 방향이라 충돌하지 않는다.
- **기사 본문은 CLAUDE.md 를 따른다** — 이 output-style 은 기본적으로 Claude 가 운영자에게 하는 답변에 적용된다. 원본 README 의 "다른 한국어 출력에도 적용" 옵션 블록은 일부러 넣지 않았다. 기사 문체는 CLAUDE.md 의 글쓰기 규칙(짧은 문장, 구체적인 동사, byline 별 문체)이 기준이다.
- **운영자 소통 원칙 유지** — "운영자는 개발자가 아니다, 터미널 안내는 한 번에 한 단계" 는 그대로 유효하다.

## 세부 동작 블록

원본 README 에는 md 파일 끝에 덧붙일 수 있는 선택 블록이 몇 가지 있다 (높임말 강제, 저빈도 어휘 억제, 영어 출력 억제, 출력 직전 자기 점검 등). 지금은 하나도 넣지 않은 원본 상태다. 필요하면 해당 md 파일 본문 끝에 블록 텍스트를 붙이면 된다.
