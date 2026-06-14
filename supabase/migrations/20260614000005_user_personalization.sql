-- 개인화 동기화 — "최근 본 필름" + "좋아요 한 브랜드" 를 DB 에 보관해 디바이스 간 공유
-- ════════════════════════════════════════════════════════════
-- 정책:
--   - 로그인 사용자만 동기화 (비로그인은 localStorage 만)
--   - 본인 row 만 SELECT / INSERT / UPDATE / DELETE
--   - 최근 본 필름은 N=20 까지 유지, 가장 오래된 것부터 trim 권장 (client-side)
-- ════════════════════════════════════════════════════════════

-- 최근 본 필름
CREATE TABLE IF NOT EXISTS public.user_recent_films (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  film_slug  TEXT NOT NULL CHECK (char_length(film_slug) BETWEEN 1 AND 80),
  viewed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, film_slug)
);

CREATE INDEX IF NOT EXISTS user_recent_films_viewed_idx
  ON public.user_recent_films (user_id, viewed_at DESC);

ALTER TABLE public.user_recent_films ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own recent films readable" ON public.user_recent_films;
CREATE POLICY "own recent films readable" ON public.user_recent_films
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own recent films writable" ON public.user_recent_films;
CREATE POLICY "own recent films writable" ON public.user_recent_films
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own recent films updatable" ON public.user_recent_films;
CREATE POLICY "own recent films updatable" ON public.user_recent_films
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own recent films deletable" ON public.user_recent_films;
CREATE POLICY "own recent films deletable" ON public.user_recent_films
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 좋아요 한 브랜드
CREATE TABLE IF NOT EXISTS public.user_fav_brands (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand      TEXT NOT NULL CHECK (char_length(brand) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, brand)
);

CREATE INDEX IF NOT EXISTS user_fav_brands_created_idx
  ON public.user_fav_brands (user_id, created_at DESC);

ALTER TABLE public.user_fav_brands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own fav brands readable" ON public.user_fav_brands;
CREATE POLICY "own fav brands readable" ON public.user_fav_brands
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own fav brands writable" ON public.user_fav_brands;
CREATE POLICY "own fav brands writable" ON public.user_fav_brands
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own fav brands deletable" ON public.user_fav_brands;
CREATE POLICY "own fav brands deletable" ON public.user_fav_brands
  FOR DELETE TO authenticated USING (user_id = auth.uid());
