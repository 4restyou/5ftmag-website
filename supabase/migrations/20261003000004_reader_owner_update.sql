-- 초기 baseline에만 있던 본인 수정 정책을 기존 운영 DB에도 적용한다.
-- 사용자에게 허용하는 변경은 표시 메타데이터 다섯 칸뿐이다.
CREATE OR REPLACE FUNCTION public.reader_submissions_owner_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  is_editor_now BOOLEAN;
BEGIN
  SELECT COALESCE(is_editor, FALSE) INTO is_editor_now
  FROM public.profiles WHERE user_id = auth.uid();
  IF COALESCE(is_editor_now, FALSE) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'status 는 본인이 정할 수 없습니다'; END IF;
    IF NEW.rejection_reason IS NOT NULL THEN RAISE EXCEPTION 'rejection_reason 은 본인이 정할 수 없습니다'; END IF;
    IF NEW.reviewed_at IS NOT NULL THEN RAISE EXCEPTION 'reviewed_at 는 본인이 정할 수 없습니다'; END IF;
    IF NEW.reviewed_by IS NOT NULL THEN RAISE EXCEPTION 'reviewed_by 는 본인이 정할 수 없습니다'; END IF;
    IF NEW.featured_at IS NOT NULL THEN RAISE EXCEPTION 'featured_at 는 편집부만 정할 수 있습니다'; END IF;
    IF NEW.featured_note IS NOT NULL THEN RAISE EXCEPTION 'featured_note 는 편집부만 정할 수 있습니다'; END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['submitter_name', 'instagram', 'film', 'camera', 'caption'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['submitter_name', 'instagram', 'film', 'camera', 'caption']) THEN
      RAISE EXCEPTION '이름, SNS, 필름, 카메라, 메모만 수정할 수 있습니다';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reader_submissions_owner_guard ON public.reader_submissions;
CREATE TRIGGER reader_submissions_owner_guard
  BEFORE INSERT OR UPDATE ON public.reader_submissions
  FOR EACH ROW EXECUTE FUNCTION public.reader_submissions_owner_guard();

DROP POLICY IF EXISTS "own submissions updatable" ON public.reader_submissions;
CREATE POLICY "own submissions updatable" ON public.reader_submissions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
