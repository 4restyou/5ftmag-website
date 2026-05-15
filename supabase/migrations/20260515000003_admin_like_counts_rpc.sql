-- 편집부 전용 — 사진 좋아요 수 집계 (개인정보 노출 없음, 카운트만)
-- 종이 매거진 우수작 선정 보조용. SECURITY DEFINER 로 user_favorites RLS 우회,
-- 내부에서 호출자가 is_editor 인지 검사.

CREATE OR REPLACE FUNCTION public.admin_submission_like_counts()
RETURNS TABLE (target_id TEXT, like_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 편집부만 호출 허용
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND is_editor = TRUE
  ) THEN
    RAISE EXCEPTION 'editor only';
  END IF;
  RETURN QUERY
    SELECT uf.target_id, COUNT(*)::BIGINT AS like_count
    FROM public.user_favorites uf
    WHERE uf.target_type = 'submission'
    GROUP BY uf.target_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_submission_like_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_submission_like_counts() TO authenticated;
