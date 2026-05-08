# 5ft.mag 댓글 시스템 — 설정 가이드

Supabase + Netlify 환경에서 댓글, 답글, 좋아요, 편집부 답변 표시 기능을 구축합니다.

전체 작업은 30~60분, 모두 한 번만 설정하면 됩니다.

---

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 가입 (Google/GitHub 로그인)
2. **New project** 클릭
3. 프로젝트 정보 입력:
   - **Name**: `5ftmag-comments` (자유)
   - **Database Password**: 안전한 비밀번호 (잊지 않게 보관)
   - **Region**: `Northeast Asia (Seoul)` 또는 `(Tokyo)` 권장
4. **Create new project** → 약 2분 대기

생성 완료 후, 좌측 메뉴에서 사용할 항목들:
- **Table Editor** — 데이터 확인
- **SQL Editor** — 스키마 생성용
- **Authentication** — OAuth 설정
- **Settings → API** — URL, anon key

---

## 2. 데이터베이스 스키마 만들기

1. **SQL Editor** 열기 → **+ New query**
2. 프로젝트 루트의 [`db/comments-schema.sql`](db/comments-schema.sql) 내용 전체를 복사 → 붙여넣기
3. **Run** 클릭
4. `Success. No rows returned` 메시지 확인

이걸로 다음이 생성됩니다:
- `profiles` 테이블 (사용자 표시 정보)
- `comments` 테이블 (댓글 본문)
- `likes` 테이블 (좋아요)
- `comments_with_meta` 뷰 (댓글 + 작성자 + 좋아요 수)
- RLS 정책 (인증된 사용자만 작성, 본인 글만 수정/삭제)
- 신규 가입 시 프로필 자동 생성 트리거
- Realtime 구독 활성화

---

## 3. 사이트 URL 등록

**Authentication → URL Configuration** 에서:

- **Site URL**: `https://5ftmag.com`
- **Redirect URLs** (한 줄에 하나씩):
  ```
  https://5ftmag.com/**
  http://localhost:8000/**
  ```

저장 후 적용됩니다 (몇 초 걸림).

---

## 4. Google OAuth 설정

### 4-1. Google Cloud Console
1. https://console.cloud.google.com 접속
2. 새 프로젝트 만들기 (예: `5ftmag-auth`)
3. 좌측 메뉴 **APIs & Services → OAuth consent screen**
   - User Type: **External** 선택 → 만들기
   - App name: `5ft.mag`
   - User support email: 본인 이메일
   - App logo: (선택) 5ft.mag 로고
   - Developer contact: 본인 이메일
   - **저장** 후 Scopes는 기본으로 두고 진행
   - Test users는 비워두고 → **Publish app** (테스트 모드 해제)

4. **Credentials → + Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Name: `5ftmag-supabase`
   - **Authorized redirect URIs**:
     ```
     https://YOUR-PROJECT-ID.supabase.co/auth/v1/callback
     ```
     (Supabase 프로젝트의 Settings → API 에서 URL 확인)
   - **Create**
5. 생성된 **Client ID**와 **Client Secret** 복사

### 4-2. Supabase에 등록
1. Supabase **Authentication → Providers**
2. **Google** 토글 ON
3. **Client ID** 와 **Client Secret** 붙여넣기
4. **Save**

---

## 5. 프론트엔드에 키 입력

`js/supabase-config.js` 열어서 두 값을 본인 프로젝트 것으로 교체:

```js
window.SUPABASE_CONFIG = {
  url: 'https://YOUR-PROJECT-ID.supabase.co',     // ← 여기
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', // ← 여기
};
```

값은 **Supabase → Settings → API** 에서 복사:
- **Project URL** → `url`
- **Project API keys → anon public** → `anonKey`

> ⚠️ `service_role` 키는 절대 프론트엔드에 넣지 마세요. 그건 서버 전용입니다.
> `anon public` 키는 브라우저에 노출되어도 안전 — RLS 정책이 데이터를 보호합니다.

수정 후 git에 커밋 → 푸시하면 Netlify가 자동 배포.

---

## 6. 동작 확인

배포 후 https://5ftmag.com/stories/10.html (또는 다른 글) 하단에서:
- "댓글 0" 영역이 보이면 ✅ 연결 성공
- **Google로 계속하기** 버튼 클릭 → 로그인 → 댓글 작성 가능

---

## 7. 본인을 편집부로 등록

기본값으로 모든 사용자는 일반 사용자입니다. 본인(또는 다른 편집부 멤버)을 편집부로 표시하려면:

1. 한 번 사이트에 Google로 로그인 (계정이 만들어짐)
2. Supabase **SQL Editor**에서 실행:

```sql
-- 본인 이메일로 편집부 권한 주기
UPDATE public.profiles
SET is_editor = TRUE
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'colorfg@gmail.com');
```

이제 본인이 단 댓글 옆에 노란 **편집부** 배지가 표시됩니다.

또한 편집부는 다른 사용자의 댓글도 삭제할 수 있습니다 (스팸 차단용).

---

## 8. 댓글 모더레이션 (필요할 때)

**Table Editor → comments** 에서 댓글을 직접 보거나, SQL로 검색:

```sql
-- 최근 댓글 100개
SELECT c.body, p.display_name, c.created_at, c.page_id, c.deleted_at
FROM public.comments c
LEFT JOIN public.profiles p ON p.user_id = c.user_id
ORDER BY c.created_at DESC
LIMIT 100;

-- 특정 댓글 강제 삭제 (소프트 삭제)
UPDATE public.comments SET deleted_at = NOW() WHERE id = '<comment-uuid>';

-- 사용자 차단 (모든 댓글 삭제 + 향후 작성 막기)
-- 1. 이 사용자의 모든 댓글 소프트 삭제
UPDATE public.comments SET deleted_at = NOW() WHERE user_id = '<user-uuid>';
-- 2. (필요 시) auth.users 에서 사용자 차단/삭제는 Supabase 대시보드에서 진행
```

---

## 9. 비용

Supabase 무료 티어:
- DB 스토리지 500MB
- 월 50,000 monthly active users (인증)
- 월 5GB 송수신
- Realtime 동시 연결 200

5ft.mag 트래픽 규모에서는 **수년간 무료**로 충분합니다.

---

## 트러블슈팅

**Q. 댓글 영역에 "Supabase 미연결" 메시지**
→ `js/supabase-config.js`의 url/anonKey가 아직 placeholder. 5단계 다시 확인.

**Q. Google 로그인 시 redirect_uri_mismatch 에러**
→ Google Console의 Authorized redirect URIs에 Supabase callback URL이 등록되어 있는지 확인. 정확히 `https://YOUR-PROJECT-ID.supabase.co/auth/v1/callback` 형태.

**Q. 댓글이 다른 페이지에서도 보이는 것 같다**
→ `data-page-id` 속성을 확인. `stories/10`처럼 페이지마다 고유값이어야 함. 각 글의 ID에 자동으로 들어가도록 작성됨.

**Q. 사이트에 댓글 위젯 자체가 안 보임**
→ 브라우저 콘솔(F12 → Console)을 열어 에러 확인. 보통 supabase-js 로딩 실패 또는 config 미설정.

**Q. 편집부 배지가 안 떠요**
→ 7단계의 UPDATE를 실행한 후, 사이트에서 한 번 로그아웃 → 재로그인. 또는 페이지 새로고침.

**Q. 스팸이 너무 많아요**
→ Supabase의 Auth → Rate Limits 에서 초당 인증 요청 수 줄이기. 또는 모더레이션 모드로 전환 (본 가이드에서는 자동 게시지만, 사후 모더레이션은 8단계 SQL로 가능).

**Q. Kakao 로그인을 추가하고 싶어요**
→ Kakao OIDC와 Supabase의 Kakao provider 매칭이 까다롭습니다. 별도 작업으로 진행하세요. (현재 5ft.mag은 Google만 사용)

---

## 향후 확장 가능

이 시스템을 기반으로 다음을 더 만들 수 있습니다:

- **이메일 알림** — 새 댓글 시 편집부에 메일 (Netlify Functions + Supabase Webhooks)
- **댓글 좋아요 순 정렬** — `comments_with_meta` 정렬 옵션 변경
- **사진 첨부** — Supabase Storage + 폼 확장
- **번역** — 외국 독자용 자동 번역 버튼
- **`@user` 멘션** — 답글 알림

필요할 때 알려주세요.
