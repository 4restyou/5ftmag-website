-- 본인은 자기 사진 제출을 status 무관 삭제할 수 있도록 정책 갱신
-- (기존: pending 일 때만 허용. approved / rejected 사진도 본인이 회수
--  가능해야 한다는 요구로 status 조건 제거)
DROP POLICY IF EXISTS "own pending deletable" ON public.reader_submissions;
DROP POLICY IF EXISTS "own deletable" ON public.reader_submissions;
CREATE POLICY "own deletable" ON public.reader_submissions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
