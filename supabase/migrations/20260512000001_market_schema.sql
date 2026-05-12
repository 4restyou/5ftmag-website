-- 5ft.mag Market — 구독자 중고 장터
-- 사전조건: db/comments-schema.sql 가 먼저 실행되어 있어야 함 (profiles, is_editor)
-- ════════════════════════════════════════════════════════════
-- market_listings: 매물
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.market_listings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  price         TEXT NOT NULL CHECK (char_length(price) BETWEEN 1 AND 40),
  category      TEXT NOT NULL CHECK (category IN ('film','camera','lens','accessory','etc')),
  description   TEXT CHECK (description IS NULL OR char_length(description) <= 1000),

  -- Storage 경로 1~3장 (bucket: market-listings)
  storage_paths TEXT[] NOT NULL CHECK (
    array_length(storage_paths, 1) BETWEEN 1 AND 3
  ),

  contact       TEXT NOT NULL CHECK (char_length(contact) BETWEEN 1 AND 100),
  location      TEXT CHECK (location IS NULL OR char_length(location) <= 60),

  status        TEXT NOT NULL DEFAULT 'available'
                CHECK (status IN ('available','reserved','sold','hidden')),

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_listings_public
  ON public.market_listings(status, created_at DESC)
  WHERE status IN ('available','reserved','sold');
CREATE INDEX IF NOT EXISTS idx_market_listings_user
  ON public.market_listings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_listings_category
  ON public.market_listings(category, status);

-- ════════════════════════════════════════════════════════════
-- market_reports: 신고
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.market_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   UUID NOT NULL REFERENCES public.market_listings(id) ON DELETE CASCADE,
  reporter_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason       TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (listing_id, reporter_id)  -- 한 사람당 한 매물 1회 신고
);

CREATE INDEX IF NOT EXISTS idx_market_reports_listing
  ON public.market_reports(listing_id, created_at DESC);

-- ════════════════════════════════════════════════════════════
-- 공개 뷰: hidden 제외 + 작성자 표시 정보
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.market_listings_public AS
SELECT
  l.id,
  l.user_id,
  l.title,
  l.price,
  l.category,
  l.description,
  l.storage_paths,
  l.contact,
  l.location,
  l.status,
  l.created_at,
  l.updated_at,
  p.display_name,
  p.avatar_url
FROM public.market_listings l
LEFT JOIN public.profiles p ON p.user_id = l.user_id
WHERE l.status IN ('available','reserved','sold');

GRANT SELECT ON public.market_listings_public TO anon, authenticated;

-- ════════════════════════════════════════════════════════════
-- 본인 매물 컬럼 보호 트리거
--   본인이 변경할 수 없는 컬럼: user_id, storage_paths(별도 절차로만)
--   본인이 변경 가능: title, price, category, description, contact,
--                    location, status (available/reserved/sold 순환)
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.market_listings_owner_guard()
RETURNS TRIGGER AS $$
DECLARE
  is_editor_now BOOLEAN;
BEGIN
  SELECT COALESCE(is_editor, FALSE) INTO is_editor_now
  FROM public.profiles WHERE user_id = auth.uid();
  IF NOT COALESCE(is_editor_now, FALSE) THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'user_id 변경 불가';
    END IF;
    -- 'hidden' 으로의 본인 변경 금지 (편집부만 처리)
    IF NEW.status = 'hidden' AND OLD.status <> 'hidden' THEN
      RAISE EXCEPTION 'hidden 상태는 본인이 설정할 수 없습니다';
    END IF;
    -- 한번 hidden 된 매물의 status 변경 금지 (편집부만 복구 가능)
    IF OLD.status = 'hidden' THEN
      RAISE EXCEPTION 'hidden 매물은 본인이 변경할 수 없습니다';
    END IF;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS market_listings_owner_guard ON public.market_listings;
CREATE TRIGGER market_listings_owner_guard
  BEFORE UPDATE ON public.market_listings
  FOR EACH ROW EXECUTE FUNCTION public.market_listings_owner_guard();

-- ════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.market_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_reports  ENABLE ROW LEVEL SECURITY;

-- listings: 누구나 hidden 제외 SELECT (뷰 + base 정책)
DROP POLICY IF EXISTS "market public visible" ON public.market_listings;
CREATE POLICY "market public visible" ON public.market_listings
  FOR SELECT TO anon, authenticated
  USING (status <> 'hidden');

-- 본인은 본인 매물 전체 SELECT (hidden 포함)
DROP POLICY IF EXISTS "market own readable" ON public.market_listings;
CREATE POLICY "market own readable" ON public.market_listings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 편집부는 모든 매물 SELECT
DROP POLICY IF EXISTS "market editor read" ON public.market_listings;
CREATE POLICY "market editor read" ON public.market_listings
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND is_editor = TRUE
  ));

-- 인증 사용자: 본인 user_id 로 INSERT, status='available' 만
DROP POLICY IF EXISTS "market insert own" ON public.market_listings;
CREATE POLICY "market insert own" ON public.market_listings
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'available'
  );

-- 본인 UPDATE (트리거가 컬럼 제한)
DROP POLICY IF EXISTS "market update own" ON public.market_listings;
CREATE POLICY "market update own" ON public.market_listings
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 편집부 UPDATE (모든 컬럼)
DROP POLICY IF EXISTS "market editor update" ON public.market_listings;
CREATE POLICY "market editor update" ON public.market_listings
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND is_editor = TRUE
  ));

-- 본인 DELETE
DROP POLICY IF EXISTS "market delete own" ON public.market_listings;
CREATE POLICY "market delete own" ON public.market_listings
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 편집부 DELETE
DROP POLICY IF EXISTS "market editor delete" ON public.market_listings;
CREATE POLICY "market editor delete" ON public.market_listings
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND is_editor = TRUE
  ));

-- reports: 인증 사용자가 본인 reporter_id 로 INSERT
DROP POLICY IF EXISTS "market reports insert" ON public.market_reports;
CREATE POLICY "market reports insert" ON public.market_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- 본인 신고 SELECT
DROP POLICY IF EXISTS "market reports own read" ON public.market_reports;
CREATE POLICY "market reports own read" ON public.market_reports
  FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

-- 편집부는 모든 신고 SELECT
DROP POLICY IF EXISTS "market reports editor read" ON public.market_reports;
CREATE POLICY "market reports editor read" ON public.market_reports
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND is_editor = TRUE
  ));

-- ════════════════════════════════════════════════════════════
-- Storage bucket 'market-listings'
-- ════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'market-listings',
  'market-listings',
  TRUE,
  5 * 1024 * 1024,
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 본인 폴더에만 업로드 + 확장자 화이트리스트
DROP POLICY IF EXISTS "market upload own" ON storage.objects;
CREATE POLICY "market upload own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'market-listings'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (
      lower(name) LIKE '%.jpg'
      OR lower(name) LIKE '%.jpeg'
      OR lower(name) LIKE '%.png'
      OR lower(name) LIKE '%.webp'
    )
  );

-- 본인 폴더 객체 DELETE
DROP POLICY IF EXISTS "market delete own folder" ON storage.objects;
CREATE POLICY "market delete own folder" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'market-listings'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 편집부 임의 객체 DELETE
DROP POLICY IF EXISTS "market editor delete obj" ON storage.objects;
CREATE POLICY "market editor delete obj" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'market-listings'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_editor = TRUE
    )
  );

-- 공개 SELECT
DROP POLICY IF EXISTS "market public read obj" ON storage.objects;
CREATE POLICY "market public read obj" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'market-listings');
