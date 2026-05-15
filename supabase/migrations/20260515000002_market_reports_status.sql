-- market_reports 에 처리 상태 컬럼 + 편집부 UPDATE 정책 추가
-- status: 'pending' (기본) / 'resolved' (조치 완료) / 'dismissed' (기각)

ALTER TABLE public.market_reports
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'dismissed'));
ALTER TABLE public.market_reports
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE public.market_reports
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES auth.users(id);
ALTER TABLE public.market_reports
  ADD COLUMN IF NOT EXISTS resolver_note TEXT
    CHECK (resolver_note IS NULL OR char_length(resolver_note) <= 300);

CREATE INDEX IF NOT EXISTS idx_market_reports_status
  ON public.market_reports(status, created_at DESC);

-- 편집부는 모든 신고 UPDATE 가능 (처리 완료/기각 + 노트)
DROP POLICY IF EXISTS "market reports editor update" ON public.market_reports;
CREATE POLICY "market reports editor update" ON public.market_reports
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND is_editor = TRUE
  ));
