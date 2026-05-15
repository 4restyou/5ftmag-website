-- HOTFIX — 매물이 비로그인 사용자에게 안 보이던 버그
--
-- 원인: 20260516000001 에서 market_listings_public / _authed 뷰를 만들 때
--       Supabase 기본값(security_invoker = true) 으로 생성됨.
--       view 가 caller 권한으로 실행되는데, 같은 마이그레이션이 base 테이블
--       RLS 를 anon → authenticated 로 좁힌 결과, anon 이 뷰를 조회해도
--       내부 base 조회가 막혀 결과가 항상 0건.
--
-- 수정: 두 뷰를 security_invoker = false 로 전환해 view OWNER(postgres) 권한
--       으로 실행. base RLS 가 우회됨.
--       - public 뷰는 PII 컬럼(seller_name/phone/contact) 자체가 빠져있어
--         owner-bypass 가 정보 누출로 이어지지 않음.
--       - authed 뷰는 GRANT SELECT 가 authenticated 한정이라
--         anon 이 호출 자체를 못함 → owner-bypass 안전.
ALTER VIEW IF EXISTS public.market_listings_public  SET (security_invoker = false);
ALTER VIEW IF EXISTS public.market_listings_authed  SET (security_invoker = false);
