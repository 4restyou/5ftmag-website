-- 5ft.mag user_favorites — 본인용 즐겨찾기 (사진/필름)
-- Supabase SQL Editor에서 한 번만 실행
-- 사전조건: auth.users 존재 (기본). profiles 의존 없음.
-- 공개 카운터 없음. 본인만 SELECT/INSERT/DELETE.
--
-- target_type: 'submission' | 'film' | 'article'
--   - 'submission' → target_id = reader_submissions.id (UUID, TEXT 캐스팅)
--   - 'film'       → target_id = films.json slug (예: 'kodakgold200')
--   - 'article'    → target_id = stories.json id (예: 'lomo-mca', 'spc-issue01', '01')
-- target_id 컬럼은 TEXT 로 통일 — 서버 측 폴리모피즘.

CREATE TABLE IF NOT EXISTS public.user_favorites (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('submission', 'film', 'article')),
  target_id   TEXT NOT NULL CHECK (char_length(target_id) <= 80),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_type_created
  ON public.user_favorites(user_id, target_type, created_at DESC);

-- ════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own favorites readable" ON public.user_favorites;
CREATE POLICY "own favorites readable" ON public.user_favorites
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own favorites insertable" ON public.user_favorites;
CREATE POLICY "own favorites insertable" ON public.user_favorites
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own favorites deletable" ON public.user_favorites;
CREATE POLICY "own favorites deletable" ON public.user_favorites
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
