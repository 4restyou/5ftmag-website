-- 5ft.mag user_favorites — 본인용 즐겨찾기 (사진/필름)
-- 공개 카운터 없음. 본인만 SELECT/INSERT/DELETE.
-- target_type: 'submission' (reader_submissions.id, UUID) | 'film' (films.json slug)
-- target_id  : TEXT — UUID 든 slug 든 같은 컬럼에 저장 (서버 측 폴리모피즘)

CREATE TABLE IF NOT EXISTS public.user_favorites (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('submission', 'film')),
  target_id   TEXT NOT NULL CHECK (char_length(target_id) <= 80),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_type_created
  ON public.user_favorites(user_id, target_type, created_at DESC);

-- ════════════════════════════════════════════════════════════
-- RLS — 본인 row 만 모든 작업 가능 (공개 카운터 없으므로 anon 정책 불필요)
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
