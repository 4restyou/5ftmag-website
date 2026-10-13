-- 자동 승인이 일어나면 편집부에게 알린다 (운영자 요청, 2026-10-13).
--
-- 20261012000001 의 자동 승인은 조용히 승인만 했다. 바로 확인할 수 있도록 편집부 전원에게
-- 사진 한 장마다 알림을 넣는다. user_notifications 에 넣으면 기존 dispatch 트리거가 웹푸시까지 보낸다.
-- 독자에게 가는 알림은 그대로다(편집부 승인과 같은 「사진이 승인됐어요」).
-- 재실행 안전.

-- 1) type CHECK 에 'submission_auto_approved_editor' 추가. 지금까지 쓴 모든 타입의 상위집합.
ALTER TABLE public.user_notifications
  DROP CONSTRAINT IF EXISTS user_notifications_type_check;
ALTER TABLE public.user_notifications
  ADD  CONSTRAINT user_notifications_type_check
       CHECK (type IN (
         'submission_approved',
         'submission_rejected',
         'submission_deleted',
         'submission_pending_editor',
         'submission_auto_approved_editor',
         'submission_featured',
         'listing_hidden',
         'listing_restored',
         'comment_reply',
         'proposal_approved',
         'proposal_rejected',
         'market_report_editor',
         'debug_test',
         'ebook_sold'
       ));

-- 2) 자동 승인 함수에 편집부 알림을 더한다(나머지는 20261012000001 과 같다).
CREATE OR REPLACE FUNCTION ops_private.run_reader_auto_approvals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $run$
DECLARE
  rec record;
  done integer := 0;
  reason text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(20261012, 1) THEN
    RETURN 0;
  END IF;
  PERFORM set_config('app.auto_approve', 'on', true);

  FOR rec IN
    SELECT a.submission_id, s.status, s.dup_of, s.film, s.user_id
      FROM public.reader_auto_approvals a
      JOIN public.reader_submissions s ON s.id = a.submission_id
     WHERE a.approved_at IS NULL AND a.skipped_at IS NULL AND a.due_at <= now()
     ORDER BY a.due_at
     LIMIT 200
     FOR UPDATE OF a SKIP LOCKED
  LOOP
    reason := CASE
      WHEN rec.status <> 'pending' THEN 'reviewed'          -- 편집부가 먼저 처리함
      WHEN rec.dup_of IS NOT NULL THEN 'duplicate'
      WHEN NOT public.reader_film_in_catalog(rec.film) THEN 'film'   -- 그 사이 필름 표기를 바꿈
      WHEN NOT public.reader_is_trusted(rec.user_id) THEN 'untrusted'
      ELSE NULL END;
    IF reason IS NOT NULL THEN
      UPDATE public.reader_auto_approvals
         SET skipped_at = now(), skip_reason = reason
       WHERE submission_id = rec.submission_id;
      CONTINUE;
    END IF;

    UPDATE public.reader_submissions
       SET status = 'approved', reviewed_at = now()
     WHERE id = rec.submission_id AND status = 'pending';
    UPDATE public.reader_auto_approvals
       SET approved_at = now()
     WHERE submission_id = rec.submission_id;
    done := done + 1;

    -- 편집부 전원에게 알림. 누르면 「승인됨」 탭이 열린다. 독자에게는 가지 않는다
    -- (독자에게는 승인 트리거가 평소와 같은 승인 알림을 보낸다).
    INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
    SELECT p.user_id, 'submission_auto_approved_editor', rec.submission_id,
           '사진이 자동 승인됐어요',
           COALESCE(NULLIF(sub.submitter_name, ''), NULLIF(sub.instagram, ''), '투고자')
             || ' · ' || COALESCE(NULLIF(sub.film, ''), '필름')
             || '. 3시간 동안 검토되지 않아 자동 승인했어요. 문제가 있으면 반려해 주세요.',
           '/admin/submissions.html?status=approved'
      FROM public.profiles p
      CROSS JOIN LATERAL (SELECT submitter_name, instagram, film
                            FROM public.reader_submissions WHERE id = rec.submission_id) sub
     WHERE p.is_editor;
  END LOOP;

  PERFORM set_config('app.auto_approve', 'off', true);
  RETURN done;
END;
$run$;
ALTER FUNCTION ops_private.run_reader_auto_approvals() OWNER TO postgres;
REVOKE ALL ON FUNCTION ops_private.run_reader_auto_approvals() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
