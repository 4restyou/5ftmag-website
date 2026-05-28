-- 5ft.mag 웹진 (편집부가 PDF 를 올려 flipbook 으로 보여주는 기능) 스키마
-- Supabase SQL Editor 에서 한 번 실행. (reader-submissions 와 동일한 수동 적용 방식)
--
-- 권한 요약
--   webzine_issues : 발행분(published)은 누구나 읽기, 쓰기/미발행 열람은 편집부만
--   storage(webzine): 읽기는 공개, 업로드/삭제는 편집부만

CREATE TABLE IF NOT EXISTS public.webzine_issues (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,          -- URL 식별자 (예: vol-01)
  title       TEXT NOT NULL,
  issue_label TEXT,                          -- 표지 뱃지 (예: Vol.01)
  cover_path  TEXT,                          -- 표지 이미지 storage 경로
  pdf_path    TEXT,                          -- 원본 PDF storage 경로
  page_count  INT,                           -- 페이지 수 (페이지 이미지 경로 계산용)
  published   BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.webzine_issues ENABLE ROW LEVEL SECURITY;

-- 발행된 호는 누구나 읽기
DROP POLICY IF EXISTS "webzine read published" ON public.webzine_issues;
CREATE POLICY "webzine read published" ON public.webzine_issues
  FOR SELECT USING (published = TRUE);

-- 편집부는 전체 읽기/쓰기 (미발행 포함). FOR ALL 이 SELECT 도 포함.
DROP POLICY IF EXISTS "webzine editor all" ON public.webzine_issues;
CREATE POLICY "webzine editor all" ON public.webzine_issues
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor = TRUE));

-- ════════════════════════════════════════════════════════════
-- Storage: webzine 버킷 (PDF + 표지 + 페이지 이미지)
-- ════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'webzine', 'webzine', TRUE,
  60 * 1024 * 1024,                          -- 60MB 상한 (웹용 PDF 가정)
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "webzine editor upload" ON storage.objects;
CREATE POLICY "webzine editor upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'webzine'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor = TRUE)
  );

DROP POLICY IF EXISTS "webzine editor delete" ON storage.objects;
CREATE POLICY "webzine editor delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'webzine'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor = TRUE)
  );

DROP POLICY IF EXISTS "webzine public read" ON storage.objects;
CREATE POLICY "webzine public read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'webzine');
