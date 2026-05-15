-- HOTFIX2 — 로그인 상태에서 매물이 안 보이던 문제
-- 20260516000005 의 ALTER VIEW IF EXISTS 가 silent-skip 됐을 가능성을
-- 배제하기 위해, 두 뷰를 WITH (security_invoker = false) 로 명시 재생성.
-- 동일한 GRANT/REVOKE 도 재적용.

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

DROP VIEW IF EXISTS public.market_listings_authed CASCADE;
CREATE VIEW public.market_listings_authed
  WITH (security_invoker = false)
AS
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

-- PostgREST 스키마 캐시 reload 알림
NOTIFY pgrst, 'reload schema';
