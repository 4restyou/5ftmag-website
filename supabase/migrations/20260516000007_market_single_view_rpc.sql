-- 매물 노출 단순화 — 단일 공개 뷰 + 인증 전용 RPC
--
-- 이전 구조(공개 뷰 + 인증 뷰)는 Supabase view 의 security_invoker
-- 기본 동작과 충돌해 인증 사용자에게 빈 결과를 반환하는 버그가 있었음.
-- 단순화를 위해:
--   - market_listings_public: 모든 사용자가 보는 공개 뷰. PII 컬럼 없음.
--   - market_listing_contact(uuid): 매물 상세 모달에서 인증 사용자만 호출.
--                                    SECURITY DEFINER + 본인-인증 체크.
-- market_listings_authed 뷰는 더 이상 사용하지 않음 → 정리.

-- ────────────────────────────────────────────────
-- 1) 인증 전용 뷰 제거 — 더 이상 사용 안 함
-- ────────────────────────────────────────────────
DROP VIEW IF EXISTS public.market_listings_authed CASCADE;

-- ────────────────────────────────────────────────
-- 2) 공개 뷰 재생성 — security_invoker=false 명시
--    PII 컬럼(seller_name/phone/contact)은 select 절에서 제외
-- ────────────────────────────────────────────────
DROP VIEW IF EXISTS public.market_listings_public CASCADE;
CREATE VIEW public.market_listings_public
  WITH (security_invoker = false)
AS
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
-- 3) 매물 연락처 RPC — 인증 사용자만 호출 가능
--    매물이 visible 상태일 때만 PII 반환. hidden 매물은 null.
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.market_listing_contact(p_listing_id UUID)
RETURNS TABLE (
  seller_name TEXT,
  phone TEXT,
  contact TEXT
) AS $$
BEGIN
  -- 호출자가 인증된 경우에만 PII 반환
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT l.seller_name, l.phone, l.contact
      FROM public.market_listings l
     WHERE l.id = p_listing_id
       AND l.status IN ('available','reserved','sold');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

REVOKE ALL ON FUNCTION public.market_listing_contact(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_listing_contact(UUID) TO authenticated;

-- PostgREST 스키마 캐시 reload
NOTIFY pgrst, 'reload schema';
