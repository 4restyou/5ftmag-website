# 노션으로 5ft.mag 글 쓰기 — 설정 가이드

이 가이드를 한 번만 따라가면, 이후엔 **노션에서 글 쓰고 → main에 푸시 → 자동 배포**가 됩니다.

---

## 1. 노션 Integration 만들기 (1회)

1. https://www.notion.so/profile/integrations 접속
2. **+ New integration** 클릭
3. 이름: `5ftmag-build`
4. Workspace: 본인 워크스페이스 선택
5. **Type**: Internal
6. **Submit** → **Internal Integration Secret** 복사 (이게 `NOTION_TOKEN`)
   - `secret_` 또는 `ntn_`으로 시작하는 긴 문자열

> ⚠️ **이 토큰은 Netlify 환경 변수에만 저장합니다. 절대 코드/노션페이지/채팅에 붙여넣지 마세요.**

---

## 2. 노션에서 데이터베이스 만들기

노션 워크스페이스에서 새 페이지를 만들고, 그 안에 4개의 **데이터베이스(Table)** 를 추가합니다.

### 2-1. Stories DB (글)

데이터베이스 이름: **5ftmag — Stories**

| 속성 이름 | 속성 타입 | 설명 |
|---|---|---|
| **ID** | Title | `09`, `10` 등 — URL이 됨 (`stories/09.html`) |
| **Title** | Rich text | 글 제목 |
| **Subtitle** | Rich text | 부제 (옵션) |
| **Category** | Select | photo / essay / interview / review / goods 등 |
| **CategoryLabel** | Rich text | 카드 라벨 (예: PHOTO, EDITORIAL) |
| **Author** | Rich text | 작가 이름 |
| **Date** | Date | 발행일 |
| **Issue** | Select | Vol.01 / Vol.02 ... |
| **Excerpt** | Rich text | 카드/SEO에 보일 짧은 설명 (2~3줄) |
| **Published** | Checkbox | 체크해야 사이트에 보임 |
| **Cover** | Files & media | 히어로 이미지 (옵션 — 페이지 커버를 써도 됨) |

> ID 속성을 Title 타입으로 만들어 주세요. `09`처럼 직접 입력합니다.
> 기존 글 01–08과 겹치지 않게 09부터 시작하세요.

### 2-2. News DB (소식)

데이터베이스 이름: **5ftmag — News**

| 속성 | 타입 | 설명 |
|---|---|---|
| **ID** | Title | 고유 번호 (예: `02`, `03`) |
| **Tag** | Select | Release / Exhibition / Event / Interview / Press |
| **Title** | Rich text | 소식 제목 |
| **Date** | Date | 날짜 |
| **Link** | URL | 클릭 시 이동할 주소 (사이트 내부 또는 외부) |
| **External** | Checkbox | 외부 링크면 체크 |
| **Published** | Checkbox | 공개 여부 |
| **Thumbnail** | Files & media | 썸네일 (옵션) |

### 2-3. Films DB (필름)

데이터베이스 이름: **5ftmag — Films**

| 속성 | 타입 | 설명 |
|---|---|---|
| **Slug** | Title | URL 슬러그 (예: `portra`, `cinestill800t`) |
| **Brand** | Rich text | 제조사 (KODAK, CINESTILL 등) |
| **Name** | Rich text | 필름 이름 (Portra 400 등) |
| **Desc** | Rich text | 필름 설명 |
| **ISO** | Number | 필름 감도 (100, 400 등) |
| **Type** | Rich text | Color Negative / Slide / B&W |
| **Format** | Rich text | 35mm / 120 |
| **Issue** | Select | 어느 호에 실렸는지 |
| **Photographers** | Multi-select | 참여 작가 이름 |
| **Thumbnail** | Files & media | 박스/패키지 썸네일 |
| **Photos** | Files & media | 필름으로 찍은 사진들 (여러 장) |

### 2-4. Readers DB (독자 사진)

데이터베이스 이름: **5ftmag — Readers**

| 속성 | 타입 | 설명 |
|---|---|---|
| **ID** | Title | 고유 식별자 (예: `userhandle-01`) |
| **Author** | Rich text | `@user_handle` 형식 |
| **InstagramUrl** | URL | 인스타 게시물 URL |
| **Film** | Rich text | 사용 필름 (예: Cinestill 800T) |
| **Published** | Checkbox | 공개 여부 |
| **Image** | Files & media | 사진 (옵션 — 페이지 커버 가능) |

---

## 3. Integration에 DB 권한 부여

각 데이터베이스마다 한 번씩:

1. 데이터베이스 페이지 우상단 **⋯** 메뉴 클릭
2. **Connections** → **Add connections**
3. **5ftmag-build** 선택

> 4개 DB 모두 해야 합니다. 빠뜨리면 빌드 시 해당 DB를 못 읽습니다.

---

## 4. DB ID 복사

각 데이터베이스를 풀페이지로 열고 URL에서 DB ID를 복사합니다.

```
https://www.notion.so/workspace/<DB_ID>?v=...
                                ^^^^^^^
                                여기 32자 영숫자
```

4개 ID를 메모해 두세요 (Stories, News, Films, Readers).

---

## 5. Netlify 환경 변수 등록

1. https://app.netlify.com → 사이트 선택
2. **Site configuration** → **Environment variables**
3. **Add a variable** 로 5개 추가:

| Key | Value |
|---|---|
| `NOTION_TOKEN` | 1단계에서 받은 Integration Secret |
| `STORIES_DB_ID` | Stories DB ID |
| `NEWS_DB_ID` | News DB ID |
| `FILMS_DB_ID` | Films DB ID |
| `READERS_DB_ID` | Readers DB ID |

> 모든 변수의 Scope는 **All scopes** (또는 **Builds**)로 두면 됩니다.

---

## 6. 첫 배포 트리거

방법 A — 코드 푸시:
```
git push
```
이 가이드가 main에 올라가는 순간 Netlify가 자동으로 빌드합니다.

방법 B — Netlify에서 수동 트리거:
- **Deploys** 탭 → **Trigger deploy** → **Deploy site**

빌드 로그에서 `📝 Stories 빌드 중…` 같은 로그가 나오면 성공.

---

## 7. 글 쓰는 흐름

이제부터는:

1. **노션에서** Stories DB에 새 행 추가
2. ID = `09` (다음 번호), Title 입력, Category 선택, Date 설정, Excerpt 작성
3. **본문**: 행을 클릭해서 페이지를 열고 본문 작성
   - 일반 텍스트는 그냥 작성
   - 이미지는 노션에 그대로 올리기 (자동 다운로드됨)
   - **첫 문단은 자동으로 lead 스타일** 적용
4. **Cover 이미지** 등록 (페이지 커버 또는 Cover 속성)
5. **Published 체크박스 ON**
6. **Netlify Deploys** 탭에서 **Trigger deploy** 클릭
   - 또는 코드를 한 번 푸시 (.gitkeep 파일 등 더미 변경)

빌드 1~2분 후 사이트에 반영됩니다.

---

## 8. 본문에서 쓸 수 있는 노션 블록

| 노션 블록 | 사이트 결과 |
|---|---|
| 일반 텍스트 (paragraph) | `<p>` (첫 단락은 lead 강조) |
| Heading 1, 2 | `<h2>` 섹션 제목 |
| Heading 3 | `<h3>` |
| Quote | `<blockquote>` (강조 인용구) |
| Bulleted list | `<ul>` |
| Numbered list | `<ol>` |
| Image | `<figure>` (캡션 포함) |
| Image (캡션에 `[full]`) | `<figure class="full-width">` 화면 가득 |
| Divider | `<hr>` |
| Callout | `<div class="callout">` |
| Video / Embed (YouTube) | 자동 임베드 |
| Code (언어=html) | 그대로 HTML 삽입 (escape hatch) |

> **굵게/기울임/링크/코드** 인라인 서식 모두 지원.

### 커스텀 컴포넌트 사용

기존 글의 `preview-card`, `cta-box`, `contributors-mini` 같은 특수 박스를 쓰려면 노션에서:

1. **Code 블록** 추가
2. 언어를 **HTML** 로 변경
3. 안에 raw HTML 작성

예:
````
```html
<div class="cta-box">
  <span class="cta-box-tag">Get Vol.02</span>
  <h3 class="cta-box-title">예약구매 시작</h3>
  <a href="..." class="cta-box-btn cta-box-btn-primary">바로가기 →</a>
</div>
```
````

---

## 9. 로컬에서 미리 빌드해보기 (선택)

```
cp .env.example .env
# .env 열어서 토큰/ID 입력
npm install
npm run build
```

빌드가 끝나면 `data/stories.json`, `stories/09.html` 등이 생성됩니다.
브라우저에서 `index.html`을 열어 확인.

> `.env`는 절대 git에 커밋하지 마세요 (이미 `.gitignore`에 포함).

---

## 트러블슈팅

**Q. 빌드 로그에 `Stories DB ID 미설정` 이라고 나옵니다**
→ Netlify 환경 변수에 `STORIES_DB_ID`가 추가되었는지 확인. 추가 후 재배포.

**Q. `object_not_found` 에러**
→ 해당 DB의 Connections에 `5ftmag-build` integration이 추가되어 있는지 확인.

**Q. 이미지가 깨져요**
→ 노션에서 이미지를 페이지 안에 직접 업로드해야 합니다. 외부 URL 임베드는 이미지 다운로드가 안 될 수 있음.

**Q. 첫 단락이 lead 스타일이 아닌 일반 단락이 되었으면**
→ 첫 단락 위에 빈 줄(divider)을 넣지 마세요. 첫 paragraph 블록이 자동으로 lead가 됩니다.

**Q. 기존 01–08 글을 노션으로 옮기고 싶어요**
→ Stories DB에 새 행으로 작성한 뒤, 기존 `data/stories.json`에서 해당 항목의 `manual: true`를 제거하면 노션 버전으로 대체됩니다. ID는 같게 유지하세요.
