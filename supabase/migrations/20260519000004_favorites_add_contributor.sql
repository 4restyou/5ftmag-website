-- user_favorites.target_type CHECK 에 'contributor' 추가
-- 작가별(=submitter 인스타 핸들 또는 표시명) 즐겨찾기를 위한 타입.

ALTER TABLE public.user_favorites
  DROP CONSTRAINT IF EXISTS user_favorites_target_type_check;

ALTER TABLE public.user_favorites
  ADD CONSTRAINT user_favorites_target_type_check
  CHECK (target_type IN ('submission', 'film', 'article', 'contributor'));
