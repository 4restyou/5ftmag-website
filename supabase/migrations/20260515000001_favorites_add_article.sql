-- user_favorites.target_type CHECK 에 'article' 추가
-- 기존: ('submission', 'film') → 추가: 'article'
-- stories.json 의 id 를 target_id 로 저장 (예: 'lomo-mca', 'spc-issue01', '01').

ALTER TABLE public.user_favorites
  DROP CONSTRAINT IF EXISTS user_favorites_target_type_check;

ALTER TABLE public.user_favorites
  ADD CONSTRAINT user_favorites_target_type_check
  CHECK (target_type IN ('submission', 'film', 'article'));
