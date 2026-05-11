# 5ft.mag 콘텐츠 추가 가이드

새로운 글, 소식, 필름을 추가할 때 어떤 파일을 어떻게 수정하는지 정리했습니다.

---

## 콘텐츠 종류별 작업 위치

| 종류 | 데이터 파일 | 본문 페이지 | 이미지 폴더 |
|------|------------|------------|------------|
| **Stories** (글) | `data/stories.json` | `stories/XX.html` | `img/stories/XX/` |
| **News** (소식) | `data/news.json` | (필요 시) | (썸네일만 필요) |
| **Films** (필름) | `data/films.json` | (없음, 모달로 표시) | (필름 박스 + 사진들) |

---

## 1. Stories (글) 추가

### data/stories.json

```json
{
  "id": "02",
  "title": "글 제목",
  "category": "photo",
  "categoryLabel": "PHOTO",
  "author": "작가 이름",
  "date": "2024-12-01",
  "issue": "Vol.01",
  "thumbnail": "img/stories/02/thumb.jpg",
  "excerpt": "카드에 보일 짧은 설명. 2~3줄 정도.",
  "page": "stories/02.html",
  "published": true
}
```

**필드 설명**
- `id`: 고유 번호 (01, 02, 03...)
- `category`: 필터 카테고리 — `photo` / `essay` / `interview` / `review`
- `categoryLabel`: 카드에 표시될 라벨 (PHOTO, ESSAY, EDITORIAL 등)
- `issue`: 호수 (Vol.01) — 카드 좌상단 노란 배지로 표시
- `published`: `false`면 사이트에 안 보임 (초안용)

### 본문 페이지

`stories/01.html`을 복사 → `stories/02.html`로 저장 → 내용 수정.

### 이미지

`img/stories/XX/` 폴더 만들고 사진 업로드.

권장 파일명:

```text
cover.jpg       대표 이미지 / 카드 썸네일
detail-01.jpg   카메라·제품·현장 디테일
detail-02.jpg
sample-01.jpg   촬영 샘플
sample-02.jpg
```

이미지를 추가하거나 이름을 바꾼 뒤에는 반드시 확인합니다.

```bash
npm run optimize-images -- img/stories/XX
npm run qa
```

`data/stories.json`의 `thumbnail`과 본문 HTML의 이미지 경로가 실제 파일명과 일치해야 합니다.

---

## 2. News (소식) 추가

### data/news.json

```json
{
  "id": "02",
  "tag": "Exhibition",
  "title": "창간호 사진전 — 광주",
  "date": "2025-03-15",
  "thumbnail": "img/news/02/poster.jpg",
  "link": "https://example.com/exhibition",
  "external": true,
  "published": true
}
```

**필드 설명**
- `tag`: 뉴스 분류 라벨. 자유롭게 설정 가능
  - 예시: `Release` / `Exhibition` / `Event` / `Interview` / `Press` / `Coming Soon`
- `link`: 클릭 시 이동할 주소
  - 사이트 내부 페이지: `stories/01.html` → `external: false`
  - 외부 사이트(인스타, 기사 등): 전체 URL → `external: true`
- `thumbnail`: 작은 썸네일 이미지 (정사각형 권장, 200×200 이상)
- `external`: 외부 링크면 `true` (새 탭에서 열림)

### 자주 쓰는 케이스

```json
// 새 호 발행
{"tag": "Release", "title": "Vol.02 발행", "link": "stories/05.html", "external": false}

// 사진전
{"tag": "Exhibition", "title": "창간호 사진전 광주", "link": "https://...", "external": true}

// 외부 인터뷰 보도
{"tag": "Press", "title": "ㅇㅇ매체 인터뷰", "link": "https://...", "external": true}

// 인스타 게시물
{"tag": "Event", "title": "작가와의 대화 모집", "link": "https://instagram.com/...", "external": true}
```

---

## 3. Films (필름) 추가

`films.html`의 그리드는 `data/films.json`을 읽어 **자동으로 카드를 만듭니다**. HTML 수정 불필요.

필름은 두 종류:

- **`tier: "featured"`** — 매거진이 한 호를 통째로 다룬 필름. 사진가 36컷이 들어가는 풀 큐레이션.
- **`tier: "library"`** — 독자 Reader's Roll로 채워가는 필름. 썸네일은 사후에 업로드해도 됨.

### data/films.json — Featured 필름

```json
{
  "ultramax": {
    "slug": "ultramax",
    "tier": "featured",
    "brand": "KODAK",
    "name": "UltraMax 400",
    "displayName": "Kodak UltraMax 400",
    "aliases": ["UltraMax 400", "코닥 울트라맥스 400", "울트라맥스", "..."],
    "desc": "필름 설명...",
    "iso": "400",
    "type": "Color Negative",
    "format": "35mm",
    "issue": "Vol.01",
    "thumbnail": "img/films/ultramax-thumb.png",
    "thumbnailStatus": "set",
    "photographers": ["박순렬", "노애경", "장형수"],
    "photos": [
      { "src": "img/films/ultramax/park-ultra1.jpg", "author": "박순렬" }
    ]
  }
}
```

### data/films.json — Library 필름

```json
{
  "portra400": {
    "slug": "portra400",
    "tier": "library",
    "brand": "KODAK",
    "name": "Portra 400",
    "displayName": "Kodak Portra 400",
    "aliases": ["Portra 400", "Kodak Portra 400", "포트라 400", "포트라400", "코닥 포트라 400"],
    "desc": "필름 설명...",
    "iso": "400",
    "type": "Color Negative",
    "format": "35mm",
    "thumbnail": null,
    "thumbnailStatus": "pending",
    "photographers": [],
    "photos": []
  }
}
```

**핵심 필드 설명**

- `slug`: 객체 키와 동일하게. URL/매칭에서 쓰임
- `tier`: `"featured"` 또는 `"library"`
- `displayName`: 카드/모달에 보여지는 정식 표기 (`"Kodak Portra 400"` 같이 풀네임 권장)
- `aliases`: **표기 변형 목록**. 독자가 어떻게 입력하든 이 배열에 있으면 자동으로 이 필름에 매칭됨 (대소문자/공백/하이픈 무시)
- `thumbnailStatus`: `"set"` 또는 `"pending"`. `pending`이면 카드에 캐니스터 실루엣 placeholder가 표시됨
- `issue`: featured 필름에만. Vol.01 같은 배지로 표시
- `photos`: featured 필름의 매거진 36컷. library는 빈 배열

### Library 필름 추가 워크플로우

1. `data/films.json`에 새 entry 추가 (`thumbnailStatus: "pending"`, `thumbnail: null`)
2. **이게 끝** — 사이트에 자동 노출됨 (캐니스터 실루엣 + LIBRARY 배지)
3. 나중에 시간 날 때 썸네일 촬영 → `img/films/{slug}-thumb.png` 저장 → `thumbnail` 채우고 `thumbnailStatus: "set"`

### 새 alias 등록 (운영 중 가장 자주 하는 작업)

독자가 응모할 때 표기가 다양하게 들어옵니다. admin 페이지에서 "직접 수정" 또는 "이 필름으로 정정"으로 그때그때 처리하지만, **같은 변형이 반복**되면 aliases에 등록하는 게 효율적입니다.

**언제 등록?**
- admin에서 fuzzy 매칭 추천이 자주 뜨는 패턴 → aliases 추가
- 독자가 같은 변형을 2번 이상 입력했을 때

**어떻게 등록?**

`data/films.json`의 해당 필름 `aliases` 배열에 새 변형을 추가:

```json
"aliases": [
  "Portra 400",
  "Kodak Portra 400",
  "포트라 400",
  "코닥 포트라 400",
  "포트라400",
  "Kodak 포트라"      ← 새로 들어온 변형 추가
]
```

저장하면 다음부터는 같은 변형이 자동으로 매칭됩니다 — 시간이 지날수록 aliases가 풍부해지는 자기 강화 구조.

**팁**: 정규화 함수는 공백/하이픈/언더스코어/괄호/소문자를 무시합니다. 따라서 "portra 400", "Portra 400", "portra400", "PORTRA 400", "Portra-400"은 모두 같은 alias로 매칭되니 굳이 다 등록할 필요 없어요. **시각적으로 다른 단어 조합만** 추가하면 됩니다.

---

## 4. Reader's Roll (독자 사진) 추가

독자들이 #5ftmag 태그로 공유한 사진을 메인에 큐레이션해서 보여줍니다.

### 작업 순서
1. **사진 다운로드** — 인스타그램이나 독자가 보낸 사진을 `img/readers/` 폴더에 저장
2. **`data/readers.json` 수정** — 새 항목 추가
3. 끝! (메인이 자동으로 랜덤 6장씩 보여줌)

### data/readers.json

```json
{
  "id": "04",
  "image": "img/readers/userhandle-01.jpg",
  "author": "@user_handle",
  "instagramUrl": "https://instagram.com/p/POSTID",
  "film": "Kodak Portra 400",
  "published": true
}
```

**필드 설명**
- `image`: 사진 파일 경로
- `author`: 작가의 인스타 아이디 (`@`로 시작)
- `instagramUrl`: 클릭 시 이동할 인스타 게시물 URL
- `film`: 사용한 필름 (선택사항, 호버 시 표시됨)
- `published`: `false`면 안 보임

### 운영 팁

**사진 모으는 흐름:**
- 인스타그램에서 #5ftmag 태그 검색
- 좋은 사진 발견 → DM으로 게재 동의 받기
- 사진 다운로드 후 가로 800px 정도로 압축 (정사각 권장)
- `data/readers.json`에 추가

**저작권 주의:**
- 반드시 작가 동의 받고 게재
- 작가 인스타 링크 꼭 포함
- 문제 시 즉시 `published: false`로 변경

### 권장 사항
- 사진은 **정사각형(1:1)**이 가장 깔끔
- 가로 800~1000px 정도로 압축 (용량 100~300KB)
- 한 작가당 너무 많은 사진은 피하기 (다양성 위해)
- 10~30장 정도 모아두면 매번 새로운 조합으로 보임

---



### 새 글 추가
1. `img/stories/XX/` 폴더 만들기 → 사진 넣기
2. `stories/01.html` 복사 → `stories/XX.html` 저장 → 내용 수정
3. `data/stories.json` 열어서 새 항목 추가
4. 끝!

### 새 소식 추가
1. (필요시) 썸네일 이미지 준비
2. `data/news.json` 열어서 한 덩어리 추가
3. 끝!

---

## 임시 저장 (초안)

글이 아직 완성 안 됐을 때:

```json
"published": false
```

이렇게 하면 카드에는 안 보이고, URL 직접 입력해서 미리볼 수 있어요.

---

## 자주 묻는 질문

**Q. 카테고리를 새로 추가하고 싶어요**
→ `stories.html`의 filter-bar 부분에 `<button class="filter-chip" data-category="새카테고리">새카테고리</button>` 추가

**Q. 사진을 본문 가운데 크게 보여주고 싶어요**
→ 본문에 `<figure class="full-width">` 사용

**Q. 이미지 용량이 너무 커서 느려요**
→ 가로 폭을 1200~1600px 이하로 줄이고, JPG 품질 80~85%로 압축

**Q. News 카드를 메인이 아닌 다른 곳에도 보여주고 싶어요**
→ 같은 `data/news.json`을 다른 페이지에서 fetch해서 사용 가능
