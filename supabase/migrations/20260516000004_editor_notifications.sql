-- 편집부용 in-app 알림 — 새 사진 검토 / 새 매물 신고
-- ════════════════════════════════════════════════════════════
-- 1) user_notifications.type CHECK 확장
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.user_notifications
  DROP CONSTRAINT IF EXISTS user_notifications_type_check;
ALTER TABLE public.user_notifications
  ADD  CONSTRAINT user_notifications_type_check
       CHECK (type IN (
         'submission_approved',
         'submission_rejected',
         'submission_deleted',
         'listing_hidden',
         'listing_restored',
         -- 편집부용
         'submission_pending_editor',
         'market_report_editor'
       ));

-- ════════════════════════════════════════════════════════════
-- 2) 새 사진 제출(status=pending) → 편집부 전원에게 알림
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.notify_editors_new_submission()
RETURNS TRIGGER AS $$
DECLARE
  ed RECORD;
BEGIN
  IF NEW.status = 'pending' THEN
    FOR ed IN SELECT user_id FROM public.profiles WHERE is_editor = TRUE
    LOOP
      INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
      VALUES (
        ed.user_id,
        'submission_pending_editor',
        NEW.id,
        '새 사진 검토 요청',
        '독자가 새 사진을 제출했어요. 승인/반려를 검토해 주세요.',
        '/admin/submissions.html'
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS notify_editors_new_submission ON public.reader_submissions;
CREATE TRIGGER notify_editors_new_submission
  AFTER INSERT ON public.reader_submissions
  FOR EACH ROW EXECUTE FUNCTION public.notify_editors_new_submission();

-- ════════════════════════════════════════════════════════════
-- 3) 새 매물 신고 → 편집부 전원에게 알림
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.notify_editors_new_report()
RETURNS TRIGGER AS $$
DECLARE
  ed RECORD;
BEGIN
  FOR ed IN SELECT user_id FROM public.profiles WHERE is_editor = TRUE
  LOOP
    INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
    VALUES (
      ed.user_id,
      'market_report_editor',
      NEW.listing_id,
      '매물 신고가 접수됐어요',
      '신고된 매물을 검토하고 필요한 조치를 진행해 주세요.',
      '/admin/market-reports.html'
    );
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS notify_editors_new_report ON public.market_reports;
CREATE TRIGGER notify_editors_new_report
  AFTER INSERT ON public.market_reports
  FOR EACH ROW EXECUTE FUNCTION public.notify_editors_new_report();

-- ════════════════════════════════════════════════════════════
-- 4) 함수 권한 잠금
-- ════════════════════════════════════════════════════════════
REVOKE ALL ON FUNCTION public.notify_editors_new_submission() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_editors_new_report()     FROM PUBLIC, anon, authenticated;
