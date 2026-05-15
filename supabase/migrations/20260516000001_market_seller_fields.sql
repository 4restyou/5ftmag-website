-- 마켓 매물 — 판매자 정보(이름/전화/거래방식) + 지역 필수화 + 민감정보 보호
-- ────────────────────────────────────────────────
-- 1) 컬럼 추가 (NULL 허용 → backfill → NOT NULL 승격)
-- ────────────────────────────────────────────────
ALTER TABLE public.market_listings
  ADD COLUMN IF NOT EXISTS seller_name     TEXT,
  ADD COLUMN IF NOT EXISTS phone           TEXT,
  ADD COLUMN IF NOT EXISTS delivery_method TEXT;

-- 기존 행 backfill (사용자가 추후 수정)
UPDATE public.market_listings
   SET seller_name     = COALESCE(seller_name, '미입력'),
       phone           = COALESCE(phone, '미입력'),
       delivery_method = COALESCE(delivery_method, 'both'),
       location        = COALESCE(location, '미입력');

ALTER TABLE public.market_listings
  ALTER COLUMN seller_name     SET NOT NULL,
  ALTER COLUMN phone           SET NOT NULL,
  ALTER COLUMN delivery_method SET NOT NULL,
  ALTER COLUMN location        SET NOT NULL;

-- CHECK 제약 (멱등)
ALTER TABLE public.market_listings
  DROP CONSTRAINT IF EXISTS market_listings_seller_name_chk,
  DROP CONSTRAINT IF EXISTS market_listings_phone_chk,
  DROP CONSTRAINT IF EXISTS market_listings_delivery_method_chk;
ALTER TABLE public.market_listings
  ADD  CONSTRAINT market_listings_seller_name_chk
       CHECK (char_length(seller_name) BETWEEN 1 AND 60),
  ADD  CONSTRAINT market_listings_phone_chk
       CHECK (char_length(phone) BETWEEN 1 AND 20),
  ADD  CONSTRAINT market_listings_delivery_method_chk
       CHECK (delivery_method IN ('courier','direct','both'));

-- ────────────────────────────────────────────────
-- 2) base 테이블 SELECT 정책 — anon 차단 (뷰만 접근)
--    authenticated 는 그대로 visible 행 조회 가능
-- ────────────────────────────────────────────────
DROP POLICY IF EXISTS "market public visible" ON public.market_listings;
CREATE POLICY "market public visible" ON public.market_listings
  FOR SELECT TO authenticated
  USING (status <> 'hidden');

-- ────────────────────────────────────────────────
-- 3) 공개 뷰 — 민감정보(이름/전화/연락처) 마스킹
-- ────────────────────────────────────────────────
DROP VIEW IF EXISTS public.market_listings_public CASCADE;
CREATE VIEW public.market_listings_public AS
SELECT
  l.id, l.user_id,
  l.title, l.price, l.category, l.description,
  l.storage_paths,
  l.location, l.delivery_method,
  l.status, l.created_at, l.updated_at,
  p.display_name, p.avatar_url
FROM public.market_listings l
LEFT JOIN public.profiles p ON p.user_id = l.user_id
WHERE l.status IN ('available','reserved','sold');

GRANT SELECT ON public.market_listings_public TO anon, authenticated;

-- ────────────────────────────────────────────────
-- 4) 인증 전용 뷰 — 판매자 연락정보 포함
-- ────────────────────────────────────────────────
DROP VIEW IF EXISTS public.market_listings_authed CASCADE;
CREATE VIEW public.market_listings_authed AS
SELECT
  l.id, l.user_id,
  l.title, l.price, l.category, l.description,
  l.storage_paths,
  l.contact, l.seller_name, l.phone,
  l.location, l.delivery_method,
  l.status, l.created_at, l.updated_at,
  p.display_name, p.avatar_url
FROM public.market_listings l
LEFT JOIN public.profiles p ON p.user_id = l.user_id
WHERE l.status IN ('available','reserved','sold');

REVOKE ALL ON public.market_listings_authed FROM PUBLIC;
GRANT SELECT ON public.market_listings_authed TO authenticated;
