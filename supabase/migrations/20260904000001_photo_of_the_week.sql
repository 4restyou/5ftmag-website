-- 이주의 사진 — 편집부가 승인된 독자 사진 하나를 골라 홈에 건다.
--
-- 뜻은 "이번 주에 올라온 사진" 이 아니라 "이번 주에 선정된 사진" 이다.
-- 그래서 선정일(featured_at)은 제출일(created_at)과 무관하다. 3년 전에 올라온
-- 사진도 이번 주 픽이 될 수 있다.
--
-- 예약을 전제로 만든다. 편집부가 한 번에 여러 장을 골라 각각 다른 날짜를
-- 찍어 두면 홈이 알아서 넘어간다. 매주 들어와야 하는 구조면 바쁜 주에
-- 지난 사진이 그대로 걸린다.

-- ── 컬럼 ──
-- featured_at   이 날짜부터 홈에 건다. NULL 이면 선정되지 않은 사진(대부분).
-- featured_note 편집부 한 줄. 비워도 된다. 비면 화면에 아예 나오지 않는다.
ALTER TABLE public.reader_submissions
  ADD COLUMN IF NOT EXISTS featured_at   DATE,
  ADD COLUMN IF NOT EXISTS featured_note TEXT;

-- 길이 가드. 클라이언트 maxlength 와 같은 값을 DB 에서도 한 번 더 막는다
-- (RLS 를 통과한 API 직접 호출 대비). 이미 있으면 건너뛴다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reader_submissions_featured_note_len'
  ) THEN
    ALTER TABLE public.reader_submissions
      ADD CONSTRAINT reader_submissions_featured_note_len
      CHECK (featured_note IS NULL OR char_length(featured_note) <= 300);
  END IF;
END $$;

-- 홈은 "오늘 이하의 featured_at 중 가장 최근 것 하나" 를 찾는다.
-- 선정된 사진은 전체의 극히 일부라 부분 인덱스로 좁힌다.
CREATE INDEX IF NOT EXISTS idx_submissions_featured
  ON public.reader_submissions (featured_at DESC)
  WHERE featured_at IS NOT NULL;

-- ── 공개 뷰에 두 컬럼을 더한다 ──
-- CREATE OR REPLACE VIEW 는 기존 컬럼의 순서·이름을 바꾸지 못하고 뒤에 덧붙이는
-- 것만 허용한다. 그래서 avatar_url 뒤에 붙인다.
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
  p.avatar_url,
  rs.featured_at,
  rs.featured_note
FROM public.reader_submissions rs
LEFT JOIN public.profiles p ON p.user_id = rs.user_id
WHERE rs.status = 'approved';

-- 정의자 권한을 다시 고정한다. 베이스 테이블의 SELECT 정책은 본인·편집부로
-- 좁혀져 있어서, 이 뷰가 호출자 권한으로 돌면 홈의 사진이 전부 사라진다
-- (20260710000001_security_hardening_pii.sql 참고).
ALTER VIEW IF EXISTS public.reader_submissions_approved SET (security_invoker = false);
