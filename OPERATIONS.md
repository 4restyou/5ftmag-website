# 5ft.mag 운영 체크리스트

배포 전에 사이트가 깨지지 않도록 확인하는 최소 절차입니다.

## 배포 전 필수 명령

```bash
npm run qa
```

`npm run qa`는 다음을 확인합니다.

- HTML의 로컬 `src`/`href` 참조가 실제 파일로 존재하는지
- `data/*.json`의 `page`, `link`, `image`, `thumbnail`, `src` 참조가 실제 파일로 존재하는지
- 병합 충돌 마커가 남아 있지 않은지
- `stories/12`의 이전 깨진 이미지명으로 회귀하지 않았는지
- `scripts/*.mjs`, `scripts/*.js`, `js/*.js` 문법이 깨지지 않았는지
- 공개 글의 페이지와 썸네일이 존재하는지

## 이미지 운영 규칙

스토리 이미지는 다음 이름을 우선 사용합니다.

```text
img/stories/XX/cover.jpg
img/stories/XX/detail-01.jpg
img/stories/XX/detail-02.jpg
img/stories/XX/sample-01.jpg
img/stories/XX/sample-02.jpg
```

웹용 이미지는 긴 변 2000px 이하를 기본으로 하고, 가능하면 같은 이름의 `.webp` 페어를 둡니다.

```bash
npm run optimize-images -- img/stories/XX
npm run qa
```

원본 고해상도 파일은 배포 폴더가 아니라 별도 보관 위치에 둡니다.

## 배포 전 눈으로 볼 화면

최소 아래 화면을 데스크톱과 모바일 폭에서 확인합니다.

- `/`
- `/stories.html`
- `/films.html`
- `/about.html`
- 가장 최근 글 상세 페이지

확인 기준:

- 깨진 이미지 아이콘이나 alt 텍스트 노출 없음
- 헤더/모바일 메뉴 동작
- 다크모드 토글 동작
- 최신 글 카드와 관련 글 카드 이미지 정상

## 배포 후 공개 URL 확인

푸시 후 Netlify 배포가 끝나면 캐시 우회를 위해 커밋 해시를 붙여 확인합니다.

```bash
curl -I "https://www.5ftmag.com/stories/12.html?v=<commit>"
curl -I "https://www.5ftmag.com/data/stories.json?v=<commit>"
```

이미지 교체가 있었던 글은 대표 이미지와 샘플 이미지를 직접 확인합니다.

## 작업 기준 정리

로컬 작업 폴더에 미추적 이미지나 오래된 수정이 많은 상태에서는 바로 `pull`/`merge`하지 않습니다.
먼저 별도 worktree에서 원격 최신 `main`을 기준으로 작업합니다.

```bash
git fetch origin
git worktree add /tmp/5ftmag-work origin/main
```

이 방식이면 기존 로컬 작업물을 잃지 않고 운영 수정만 안전하게 배포할 수 있습니다.

---

## Supabase 마이그레이션 자동화 (GitHub Actions)

`supabase/migrations/*.sql` 파일이 변경되어 `main` 으로 머지되면 GitHub Actions 가 자동으로 `supabase db push` 를 실행해 DB 에 적용합니다. 매번 Supabase SQL Editor 에서 손으로 실행할 필요 없음.

### 1회 셋업 (한 번만 등록)

1. **Supabase Access Token 발급**
   - https://supabase.com/dashboard/account/tokens → "Generate new token" → 이름 입력 → 토큰 복사 (다시는 안 보임)

2. **DB Password 확인**
   - Supabase Dashboard → Project Settings → Database → "Database Password" (생성 시 정한 비밀번호)
   - 분실했으면 같은 페이지에서 "Reset database password" 로 새로 발급

3. **Project Ref 확인**
   - Supabase Dashboard URL 의 `pucpqsfwqouqohwsvmnd` 부분
   - 또는 Project Settings → General → "Reference ID"

4. **GitHub Secrets 등록**
   - 저장소 Settings → Secrets and variables → Actions → "New repository secret" 로 3 개 등록:
     - `SUPABASE_ACCESS_TOKEN` — 1번에서 발급한 토큰
     - `SUPABASE_DB_PASSWORD` — 2번 DB 비밀번호
     - `SUPABASE_PROJECT_REF` — 3번 Reference ID

### 동작 흐름

- 새 마이그레이션 추가 → `supabase/migrations/YYYYMMDDHHMMSS_name.sql` 파일로 추가 (timestamp prefix 필수)
- PR 머지 → GitHub Actions `Deploy Supabase migrations` 워크플로우 자동 실행
- Actions 탭에서 결과 확인 가능

### 마이그레이션 작성 규칙

- 멱등성 유지 — `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS` 패턴
- 파일명 timestamp 는 단조 증가 — 새 마이그레이션은 가장 최근 timestamp 보다 큰 값으로
- 운영 DB 에 destructive 변경(테이블/컬럼 삭제) 은 PR 본문에 명시하고 사용자 승인 후 머지

### 실패 시 폴백

GitHub Actions 가 실패하면 자동으로 알림. 그동안 수동 적용은:
```bash
# 로컬에서 Supabase CLI 설치 후
supabase link --project-ref $REF --password $PASSWORD
supabase db push --password $PASSWORD
```
또는 SQL Editor 에서 신규 파일 내용 직접 실행.
