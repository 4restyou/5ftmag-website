-- user_favorites.target_type CHECK 에 'webzine' 추가
-- 기존: ('submission', 'film', 'article', 'contributor') → 추가: 'webzine'
-- 웹진(webzine.html)의 좋아요는 webzine 테이블 id 를 target_id 로 저장한다.
-- 이 타입이 빠져 있어 웹진 좋아요 upsert 가 CHECK 위반으로 거부되던 버그 수정.

ALTER TABLE public.user_favorites
  DROP CONSTRAINT IF EXISTS user_favorites_target_type_check;

ALTER TABLE public.user_favorites
  ADD CONSTRAINT user_favorites_target_type_check
  CHECK (target_type IN ('submission', 'film', 'article', 'contributor', 'webzine'));
