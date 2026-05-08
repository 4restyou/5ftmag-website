# Reader's Roll 직접 제출 시스템 — 셋업 가이드

## 1. Supabase에 스키마 적용

[Supabase Dashboard](https://supabase.com/dashboard) → 프로젝트 → **SQL Editor** → "New query"

`db/reader-submissions-schema.sql` 파일 내용을 통째로 붙여넣고 **Run**.

확인:
- **Database → Tables**에 `reader_submissions` 가 보여야 함
- **Storage → Buckets**에 `reader-submissions` (Public, 5MB 제한) 이 만들어져 있어야 함

## 2. 편집부 권한 부여

본인이 검토자여야 하므로, 관리 SQL Editor에서:

```sql
-- 본인 계정 user_id 확인 (이메일로)
SELECT id, email FROM auth.users WHERE email = 'colorfg@gmail.com';

-- profiles 테이블에 is_editor = TRUE 적용
UPDATE public.profiles
SET is_editor = TRUE
WHERE user_id = '여기에-위에서-조회한-uuid';
```

(이미 댓글 시스템에서 편집부 권한을 받았다면 그대로 적용됨)

## 3. 테스트 시나리오

1. 메인 페이지 → Reader's Roll 섹션의 **"내 사진 올리기"** 클릭
2. 비로그인 상태면 Google 로그인 유도 → 완료 후 폼이 열림
3. 사진 업로드 + 인스타·필름·동의 체크 → 제출
4. 확인 모달 표시
5. Supabase Dashboard → Tables → `reader_submissions` 에 새 row 가 `status: 'pending'`로 들어와야 함
6. Storage → `reader-submissions/` 에 `{user_id}/...jpg` 파일이 있어야 함

## 4. 승인 (현재는 Dashboard에서)

검토 후 메인에 노출하려면 Dashboard에서:

```sql
-- 게시 (승인)
UPDATE public.reader_submissions
SET status = 'approved',
    reviewed_at = NOW(),
    reviewed_by = auth.uid()  -- 또는 본인 user_id 직접
WHERE id = '제출-uuid';

-- 반려
UPDATE public.reader_submissions
SET status = 'rejected',
    rejection_reason = '사유 (선택)',
    reviewed_at = NOW(),
    reviewed_by = auth.uid()
WHERE id = '제출-uuid';
```

승인 즉시 메인 Reader's Roll의 무작위 셔플에 포함됨 (캐시 없음, 페이지 새로고침마다 반영).

## 5. 다음 단계 (예정)

- 편집부 전용 `/admin/submissions.html` 화면 — 클릭 한 번으로 승인/반려
- 월간 테마 시스템 (current-theme JSON + 응모 체크박스 활성화 + 테마 갤러리)
- 사용자 "내 제출 현황" 페이지

## 데이터 흐름 요약

```
사용자                  브라우저                Supabase
──────                  ────────                ────────
[내 사진 올리기]
  └─ 로그인 안되어있음 → Google OAuth ──────→ auth.users (자동 트리거 → profiles)
[폼 작성 + 사진]
  └─ 캔버스 리사이즈 (긴변 2000px, JPEG q85)
  └─ Storage 업로드 ──────────────────────→ storage.objects (reader-submissions/{uid}/...)
  └─ DB insert ──────────────────────────→ reader_submissions (status=pending)

편집부
──────
[Supabase Dashboard]
  └─ status = 'approved' UPDATE ─────────→ reader_submissions

방문자
──────
메인 Reader's Roll
  └─ static readers.json + reader_submissions_approved 뷰 SELECT
  └─ 셔플해서 6장 노출
```
