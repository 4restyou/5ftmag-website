-- 5ft.mag Reader's Roll 직접 제출 시스템
-- Supabase SQL Editor에서 한 번만 실행
-- 사전조건: db/comments-schema.sql 가 먼저 실행되어 있어야 함 (profiles 테이블, is_editor 플래그 사용)

-- ════════════════════════════════════════════════════════════
-- reader_submissions: 독자 직접 제출 데이터
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.reader_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Storage 경로 (bucket: reader-submissions). 예: '{user_id}/{uuid}.jpg'
  storage_path  TEXT NOT NULL,

  -- 제출자 정보 (자동 채움 + 수정 가능)
  -- submitter_name: 표시용 이름 (인스타그램 없는 사용자 대응). 둘 중 하나는 필수 (JS 검증)
  -- 길이 CHECK 는 클라이언트 maxlength 와 동일 — DB 레벨에서도 한 번 더 가드 (RLS bypass / API 직접 호출 대비)
  submitter_name TEXT CHECK (submitter_name IS NULL OR char_length(submitter_name) <= 60),
  instagram     TEXT CHECK (instagram IS NULL OR char_length(instagram) <= 80),
  film          TEXT CHECK (film IS NULL OR char_length(film) <= 120),
  camera        TEXT CHECK (camera IS NULL OR char_length(camera) <= 80),
  caption       TEXT CHECK (caption IS NULL OR char_length(caption) <= 200),

  -- 월간 테마 응모 여부 (예: '2026-05' / NULL이면 일반 제출)
  theme_month   TEXT,

  -- 워크플로우
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 500),

  -- 동의 (게재 동의 + 저작권 본인 확인)
  consent_publish BOOLEAN NOT NULL DEFAULT FALSE,

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at   TIMESTAMPTZ,
  reviewed_by   UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_submissions_status ON public.reader_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON public.reader_submissions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_theme ON public.reader_submissions(theme_month) WHERE theme_month IS NOT NULL;

-- ════════════════════════════════════════════════════════════
-- 공개 뷰: 승인된 제출만 + 작가 표시정보 조인
-- 메인 Reader's Roll에서 이걸 SELECT
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.reader_submissions_approved AS
SELECT
  rs.id,
  rs.storage_path,
  rs.submitter_name,
  rs.instagram,
  rs.film,
  rs.camera,
  rs.caption,
  rs.theme_month,
  rs.created_at,
  p.display_name,
  p.avatar_url
FROM public.reader_submissions rs
LEFT JOIN public.profiles p ON p.user_id = rs.user_id
WHERE rs.status = 'approved';

-- ────────────────────────────────────────────────────────────
-- ★ 마이그레이션 (이미 schema 가 적용된 환경에서 submitter_name 컬럼 추가)
--   Supabase SQL Editor 에 따로 한 번만 실행:
--   ※ CREATE OR REPLACE VIEW 는 칼럼 순서 변경을 거부하므로 DROP + CREATE 로
-- ────────────────────────────────────────────────────────────
-- ALTER TABLE public.reader_submissions
--   ADD COLUMN IF NOT EXISTS submitter_name TEXT;
--
-- DROP VIEW IF EXISTS public.reader_submissions_approved;
--
-- CREATE VIEW public.reader_submissions_approved AS
-- SELECT
--   rs.id,
--   rs.storage_path,
--   rs.submitter_name,
--   rs.instagram,
--   rs.film,
--   rs.camera,
--   rs.caption,
--   rs.theme_month,
--   rs.created_at,
--   p.display_name,
--   p.avatar_url
-- FROM public.reader_submissions rs
-- LEFT JOIN public.profiles p ON p.user_id = rs.user_id
-- WHERE rs.status = 'approved';

-- ════════════════════════════════════════════════════════════
-- RLS 정책
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.reader_submissions ENABLE ROW LEVEL SECURITY;

-- 본인 제출만 조회
DROP POLICY IF EXISTS "own submissions readable" ON public.reader_submissions;
CREATE POLICY "own submissions readable" ON public.reader_submissions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 편집부는 모든 제출 조회 가능
DROP POLICY IF EXISTS "editors read all" ON public.reader_submissions;
CREATE POLICY "editors read all" ON public.reader_submissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles
            WHERE user_id = auth.uid() AND is_editor = TRUE)
  );

-- 인증 사용자: 본인 user_id로만 INSERT 가능
DROP POLICY IF EXISTS "authenticated can submit" ON public.reader_submissions;
CREATE POLICY "authenticated can submit" ON public.reader_submissions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND consent_publish = TRUE
  );

-- 본인은 자기 제출을 status 무관 삭제 가능 (마이그레이션 20260513000001)
DROP POLICY IF EXISTS "own pending deletable" ON public.reader_submissions;
DROP POLICY IF EXISTS "own deletable" ON public.reader_submissions;
CREATE POLICY "own deletable" ON public.reader_submissions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 편집부는 모든 제출 UPDATE 가능 (status, rejection_reason 등)
DROP POLICY IF EXISTS "editors review" ON public.reader_submissions;
CREATE POLICY "editors review" ON public.reader_submissions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles
            WHERE user_id = auth.uid() AND is_editor = TRUE)
  );

-- 본인은 자기 제출의 메타(필름/카메라/캡션/IG/이름)만 UPDATE 가능.
-- status, storage_path, user_id, rejection_reason, reviewed_* 는
-- 아래 트리거로 막아서 본인이 변경할 수 없게 가드.
DROP POLICY IF EXISTS "own submissions updatable" ON public.reader_submissions;
CREATE POLICY "own submissions updatable" ON public.reader_submissions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 컬럼 보호 트리거: 편집부가 아닌 사용자의 UPDATE 가
-- 핵심 컬럼을 바꾸지 못하게 막음
CREATE OR REPLACE FUNCTION public.reader_submissions_owner_guard()
RETURNS TRIGGER AS $$
DECLARE
  is_editor_now BOOLEAN;
BEGIN
  SELECT COALESCE(is_editor, FALSE) INTO is_editor_now
  FROM public.profiles WHERE user_id = auth.uid();
  IF NOT COALESCE(is_editor_now, FALSE) THEN
    IF NEW.status           IS DISTINCT FROM OLD.status           THEN RAISE EXCEPTION 'status 는 본인이 변경할 수 없습니다'; END IF;
    IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN RAISE EXCEPTION 'rejection_reason 은 본인이 변경할 수 없습니다'; END IF;
    IF NEW.reviewed_at      IS DISTINCT FROM OLD.reviewed_at      THEN RAISE EXCEPTION 'reviewed_at 는 본인이 변경할 수 없습니다'; END IF;
    IF NEW.reviewed_by      IS DISTINCT FROM OLD.reviewed_by      THEN RAISE EXCEPTION 'reviewed_by 는 본인이 변경할 수 없습니다'; END IF;
    IF NEW.user_id          IS DISTINCT FROM OLD.user_id          THEN RAISE EXCEPTION 'user_id 변경 불가'; END IF;
    IF NEW.storage_path     IS DISTINCT FROM OLD.storage_path     THEN RAISE EXCEPTION '사진 교체는 별도 절차로만 가능합니다'; END IF;
    IF NEW.theme_month      IS DISTINCT FROM OLD.theme_month      THEN RAISE EXCEPTION 'theme_month 은 본인이 변경할 수 없습니다'; END IF;
    IF NEW.consent_publish  IS DISTINCT FROM OLD.consent_publish  THEN RAISE EXCEPTION 'consent_publish 는 변경할 수 없습니다'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS reader_submissions_owner_guard ON public.reader_submissions;
CREATE TRIGGER reader_submissions_owner_guard
  BEFORE UPDATE ON public.reader_submissions
  FOR EACH ROW EXECUTE FUNCTION public.reader_submissions_owner_guard();

-- 편집부는 모든 제출 DELETE 가능
DROP POLICY IF EXISTS "editors delete any" ON public.reader_submissions;
CREATE POLICY "editors delete any" ON public.reader_submissions
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles
            WHERE user_id = auth.uid() AND is_editor = TRUE)
  );

-- 익명 사용자: 승인된 제출만 뷰를 통해 SELECT 가능
DROP POLICY IF EXISTS "public reads approved" ON public.reader_submissions;
CREATE POLICY "public reads approved" ON public.reader_submissions
  FOR SELECT TO anon, authenticated
  USING (status = 'approved');

-- 뷰는 RLS 안 받지만 베이스 테이블 정책에 의해 자동으로 필터됨

-- ════════════════════════════════════════════════════════════
-- Storage bucket 'reader-submissions' 설정
-- (Supabase Dashboard → Storage 에서 수동 생성하거나 아래 SQL)
-- ════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reader-submissions',
  'reader-submissions',
  TRUE,                                        -- public read (URL 직접 접근 가능)
  5 * 1024 * 1024,                             -- 5MB 상한 (브라우저에서 리사이즈 후 업로드 가정)
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 업로드 정책: 인증 사용자가 자기 user_id 폴더에만 업로드
-- 확장자 화이트리스트도 RLS 단에서 추가 가드 (bucket allowed_mime_types 와 이중 가드)
DROP POLICY IF EXISTS "user upload to own folder" ON storage.objects;
CREATE POLICY "user upload to own folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'reader-submissions'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (
      lower(name) LIKE '%.jpg'
      OR lower(name) LIKE '%.jpeg'
      OR lower(name) LIKE '%.png'
      OR lower(name) LIKE '%.webp'
    )
  );

-- 본인은 자기 폴더 객체 DELETE 가능 (제출 취소 시)
DROP POLICY IF EXISTS "user delete own folder" ON storage.objects;
CREATE POLICY "user delete own folder" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'reader-submissions'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 편집부는 모든 객체 DELETE 가능 (반려 처리)
DROP POLICY IF EXISTS "editor delete any" ON storage.objects;
CREATE POLICY "editor delete any" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'reader-submissions'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_editor = TRUE
    )
  );

-- 모든 사용자 SELECT (bucket public이라 사실상 항상 OK이지만 명시)
DROP POLICY IF EXISTS "public read submissions" ON storage.objects;
CREATE POLICY "public read submissions" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'reader-submissions');

-- ════════════════════════════════════════════════════════════
-- 기존 환경용 마이그레이션 (이미 schema 적용된 프로젝트)
-- Supabase SQL Editor 에서 따로 한 번만 실행:
-- ════════════════════════════════════════════════════════════
-- ALTER TABLE public.reader_submissions
--   ADD CONSTRAINT reader_submissions_submitter_name_len
--     CHECK (submitter_name IS NULL OR char_length(submitter_name) <= 60);
-- ALTER TABLE public.reader_submissions
--   ADD CONSTRAINT reader_submissions_instagram_len
--     CHECK (instagram IS NULL OR char_length(instagram) <= 80);
-- ALTER TABLE public.reader_submissions
--   ADD CONSTRAINT reader_submissions_film_len
--     CHECK (film IS NULL OR char_length(film) <= 120);
-- ALTER TABLE public.reader_submissions
--   ADD CONSTRAINT reader_submissions_camera_len
--     CHECK (camera IS NULL OR char_length(camera) <= 80);
-- ALTER TABLE public.reader_submissions
--   ADD CONSTRAINT reader_submissions_rejection_len
--     CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 500);
