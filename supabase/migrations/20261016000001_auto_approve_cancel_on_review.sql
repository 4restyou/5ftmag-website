-- 편집부가 먼저 승인·반려하면 자동 승인 예약을 그 자리에서 거둔다 (운영자 제보, 2026-10-16).
--
-- 20261012000001 은 편집부가 먼저 처리한 예약을 기한(3시간 뒤)이 되어서야 'reviewed' 로 정리했다.
-- 그 사이 관리 화면이 승인된 사진에 「자동 승인 예정」을 계속 띄웠다. 승인은 정상이었고 두 번
-- 승인되지도 않았지만 헷갈린다. 상태가 pending 에서 바뀌는 순간 예약을 닫는다.
-- 자동 승인 함수 자신이 바꾸는 경우(app.auto_approve = 'on')는 건드리지 않는다. 그쪽은 approved_at 을 채운다.
-- 재실행 안전.

CREATE OR REPLACE FUNCTION public.reader_submissions_revoke_auto_approve()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 편집부가 기한 전에 처리함 → 예약을 닫는다.
  IF OLD.status = 'pending' AND NEW.status IS DISTINCT FROM 'pending'
     AND current_setting('app.auto_approve', true) IS DISTINCT FROM 'on' THEN
    UPDATE public.reader_auto_approvals
       SET skipped_at = now(), skip_reason = 'reviewed'
     WHERE submission_id = NEW.id AND approved_at IS NULL AND skipped_at IS NULL;
  END IF;

  -- 자동 승인한 사진을 나중에 반려함 → 그 사람은 자동 승인에서 뺀다 (중복 반려는 빼고).
  IF NEW.status = 'rejected' AND OLD.status = 'approved'
     AND NOT COALESCE(NEW.duplicate_rejected, false)
     AND EXISTS (SELECT 1 FROM public.reader_auto_approvals a
                 WHERE a.submission_id = NEW.id AND a.approved_at IS NOT NULL) THEN
    INSERT INTO public.reader_auto_approve_revoked(user_id, submission_id)
    VALUES (NEW.user_id, NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.reader_auto_approvals
       SET skipped_at = now(), skip_reason = 'revoked'
     WHERE user_id = NEW.user_id AND approved_at IS NULL AND skipped_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;

-- 이미 처리된 사진에 남아 있는 예약을 정리한다(지금 화면에 잘못 뜨는 것들).
UPDATE public.reader_auto_approvals a
   SET skipped_at = now(), skip_reason = 'reviewed'
  FROM public.reader_submissions s
 WHERE s.id = a.submission_id AND s.status <> 'pending'
   AND a.approved_at IS NULL AND a.skipped_at IS NULL;
