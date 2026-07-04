---
name: new-article
description: 5ft.mag 기사(Articles/stories) 제작 파이프라인. 사용자가 원고·PDF·이미지를 주며 "기사로 작성해줘", "articles 에 올려줘" 할 때 사용. 페이지 생성 + stories.json 등록 + 이미지 처리(EXIF 회전·리사이즈·webp)까지 한 번에.
---

# 기사 제작 (/new-article)

기준 사례: stories/15.html (CineStill 800T), stories/18.html (UltraMax 400).

## 1. 재료 확인

- **원고**: PDF/이미지 스캔이면 페이지를 읽어 글 전체를 확보. **원문에 없는 사실을 지어내지 않는다** (CLAUDE.md 글쓰기 규칙).
- **byline 확정**: 5ft.mag 편집부(분석적) / Film Social Club(사담조). 원고 말미의 "글." 표기 확인.
- **사진**: 작가별 폴더면 작가 이름·인스타 핸들을 확보. 핸들은 `authors/*.html` 에서 `grep -o 'instagram.com/[A-Za-z0-9_.]+'` 로 찾는다. 없으면 사용자에게 묻지 말고 대체 링크(유튜브 등)로 두고 보고 시 알린다.
- **번호**: `ls stories/ | grep -E '^[0-9]+\.html$'` 로 다음 번호 결정.

## 2. 이미지 처리 (Pillow)

`img/stories/<NN>/` 에 `<slug>-1.jpg ...` 로 생성. 반드시:

```python
from PIL import Image, ImageOps
im = ImageOps.exif_transpose(Image.open(src))   # EXIF 회전 — 빠뜨리면 눕는다
im = im.convert("RGB")
# 폭 1600px 초과 시 LANCZOS 리사이즈
im.save(dst_jpg, "JPEG", quality=85, optimize=True, progressive=True)
im.save(dst_webp, "WEBP", quality=82, method=6)  # webp 페어 필수 (validate 경고)
```

- 히어로 1컷(가장 대표성 있는 것) + 본문 섹션별 배치. 캡션은 사진을 **실제로 보고** 쓴다 (추측 금지). 크레딧 `ⓒ 작가명 @핸들`.

## 3. 페이지 생성 (stories/NN.html)

**기존 기사(stories/15.html 등)를 통째로 복사해 시작**한다. 직접 새로 짜지 말 것. 바꿀 곳:

- `<title>`/description/OG/twitter/canonical/JSON-LD (datePublished, headline, image)
- article-header: 태그(FILM REVIEW 등)·제목·부제·byline·날짜
- 히어로 이미지 + photo-credit
- 본문: 원고를 사이트 문체로. **글쓰기 규칙 준수** — em-dash 금지, 번역체·AI 어조 금지, 짧은 문장과 구체적 동사.
- 필름 리뷰면 film-spec 카드(Base/Process/ISO/Look), CTA 박스(호수 구매 유도), article-end 시그니처(글/사진 크레딧)
- 하단 관련글 스크립트의 `CURRENT_ID` 갱신, 댓글 `data-page-id="stories/NN"`

## 4. 등록 + 검증

- `data/stories.json` **최상단**에 항목 삽입 (id, title, excerpt, date=오늘, category, categoryLabel, author, films[슬러그 — data/films.json 에서 확인], manual: true, page, published: true, thumbnail).
- `node scripts/validate-assets.mjs` — webp 페어 경고까지 0 이어야 함.
- rss/sitemap 은 Netlify 빌드가 재생성하므로 커밋 불필요.

## 5. 배포

/ship 절차로 PR → 머지. 보고 시 기사 URL 과 "Articles 목록 맨 위 노출"을 안내하고, 임시 처리(핸들 미확보 등)가 있으면 명시한다.
