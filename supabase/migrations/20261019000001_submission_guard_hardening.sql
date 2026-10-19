-- 독자 투고 보안 손질 (2026-10-19 점검).
--  1) 올릴 때 theme_month 는 짧은 호수 이름(예: Vol.03)만 받는다. 관리 화면이 이 값을 그대로 출력하던 곳이 있어
--     HTML 을 심을 수 있었다(화면도 함께 고쳤다). 기존 행은 건드리지 않는다(새로 들어오는 행만 검사).
--  2) 올릴 때 storage_path 는 본인 폴더(<user_id>/...)만. 남의 사진 경로로 투고를 만들 수 있었다.
--  3) 승인된 사진을 본인이 고치면(이름·SNS·필름·카메라·메모) 검토 대기로 되돌린다(운영자 결정).
--  4) 승인된 투고가 쓰는 사진 파일은 본인이 지울 수 없다. 지우고 같은 이름으로 다른 사진을 올려
--     검토 없이 바꿔치기할 수 있었다. 투고를 회수할 때는 행을 먼저 지우므로(me-page) 영향이 없다.
-- 재실행 안전.

CREATE OR REPLACE FUNCTION public.reader_submissions_owner_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  is_editor_now BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' AND auth.uid() IS NULL
     AND current_setting('app.auto_approve', true) = 'on'
     AND OLD.status = 'pending' AND NEW.status = 'approved'
     AND NEW.user_id = OLD.user_id AND NEW.storage_path = OLD.storage_path
     AND NEW.film IS NOT DISTINCT FROM OLD.film THEN
    RETURN NEW;
  END IF;

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
    IF NEW.theme_month IS NOT NULL AND NEW.theme_month !~ '^[A-Za-z0-9 ._-]{1,20}$' THEN
      RAISE EXCEPTION 'theme_month 형식이 올바르지 않습니다';
    END IF;
    IF auth.uid() IS NULL
       OR NOT starts_with(COALESCE(NEW.storage_path, ''), auth.uid()::text || '/')
       OR position('..' IN NEW.storage_path) > 0 THEN
      RAISE EXCEPTION '사진은 본인 폴더에 올린 것만 쓸 수 있습니다';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['submitter_name', 'instagram', 'film', 'camera', 'caption'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['submitter_name', 'instagram', 'film', 'camera', 'caption']) THEN
      RAISE EXCEPTION '이름, SNS, 필름, 카메라, 메모만 수정할 수 있습니다';
    END IF;
    -- 승인된 사진을 고치면 다시 검토를 거친다
    IF OLD.status = 'approved' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      NEW.status := 'pending';
      NEW.reviewed_at := NULL;
      NEW.reviewed_by := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 승인된 투고가 이 경로를 쓰는가. 정책 안에서 RLS 와 관계없이 보도록 정의자 권한으로 둔다.
CREATE OR REPLACE FUNCTION public.reader_photo_in_approved_use(p_path text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.reader_submissions s WHERE s.storage_path = p_path AND s.status = 'approved');
$$;
REVOKE ALL ON FUNCTION public.reader_photo_in_approved_use(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reader_photo_in_approved_use(text) TO authenticated;

DROP POLICY IF EXISTS "user delete own folder" ON storage.objects;
CREATE POLICY "user delete own folder" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'reader-submissions'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND NOT public.reader_photo_in_approved_use(name)
  );
