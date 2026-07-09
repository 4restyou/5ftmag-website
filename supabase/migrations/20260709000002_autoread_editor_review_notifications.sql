-- 편집부 검토 알림 자동 읽음 처리
-- ════════════════════════════════════════════════════════════
-- 편집부가 알림(종)을 직접 누르지 않고 관리 페이지에서 바로 요청을 처리해도,
-- 그 처리 자체를 "알림을 확인한 것"으로 간주해 관련 검토 알림을 자동으로 읽음 처리한다.
--
--  · 사진 검토 요청(submission_pending_editor): 해당 사진이 승인/반려/삭제되면
--    그 사진에 대한 편집부 전원의 검토 알림을 읽음 처리.
--  · 매물 신고(market_report_editor): 해당 매물의 신고가 처리(resolved/dismissed)되고
--    같은 매물에 남은 미처리 신고가 없으면 편집부 전원의 신고 알림을 읽음 처리.
--
-- read_at 만 갱신하므로 user_notifications_owner_guard(컬럼 가드)를 통과한다.
-- 트리거 함수는 SECURITY DEFINER + row_security=off 로 편집부 전원의 알림 행을 갱신한다.

-- ════════════════════════════════════════════════════════════
-- 1) 사진 상태 변경 → 독자 알림 INSERT + 편집부 검토 알림 자동 읽음
--    (기존 notify_reader_submission_status 동작 유지 + 자동 읽음 추가)
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.notify_reader_submission_status()
RETURNS TRIGGER AS $$
BEGIN
  -- 승인
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
    VALUES (
      NEW.user_id,
      'submission_approved',
      NEW.id,
      '사진이 승인됐어요',
      COALESCE(NULLIF(NEW.film, ''), '필름') || ' 사진이 라이브러리에 공개됐어요.',
      '/me.html#photos'
    );
  -- 반려
  ELSIF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
    VALUES (
      NEW.user_id,
      'submission_rejected',
      NEW.id,
      '사진이 반려됐어요',
      COALESCE(NULLIF(NEW.rejection_reason, ''), '편집부 사유를 /me.html 에서 확인하세요.'),
      '/me.html#photos'
    );
  END IF;

  -- 검토 요청이 처리(pending → 그 외)됐으면 편집부 검토 알림을 자동 읽음.
  IF NEW.status IS DISTINCT FROM 'pending' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.user_notifications
       SET read_at = NOW()
     WHERE type = 'submission_pending_editor'
       AND related_id = NEW.id
       AND read_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = off;

-- ════════════════════════════════════════════════════════════
-- 2) 사진 삭제 → 독자 알림(편집부 삭제만) + 편집부 검토 알림 자동 읽음
--    (기존 notify_reader_submission_deleted 동작 유지 + 자동 읽음 추가)
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.notify_reader_submission_deleted()
RETURNS TRIGGER AS $$
DECLARE
  acting UUID;
BEGIN
  acting := auth.uid();
  IF acting IS NULL OR acting <> OLD.user_id THEN
    INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
    VALUES (
      OLD.user_id,
      'submission_deleted',
      OLD.id,
      '사진이 편집부에 의해 삭제됐어요',
      '문의가 있으면 편집부로 연락해주세요.',
      '/me.html#photos'
    );
  END IF;

  -- 삭제된 사진은 더 이상 검토 대상이 아니므로 편집부 검토 알림을 자동 읽음.
  UPDATE public.user_notifications
     SET read_at = NOW()
   WHERE type = 'submission_pending_editor'
     AND related_id = OLD.id
     AND read_at IS NULL;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = off;

-- ════════════════════════════════════════════════════════════
-- 3) 매물 신고 처리 → 편집부 신고 알림 자동 읽음
--    같은 매물에 남은 pending 신고가 없을 때만 읽음 처리.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.autoread_market_report_editor()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('resolved', 'dismissed')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.market_reports
       WHERE listing_id = NEW.listing_id
         AND status = 'pending'
         AND id <> NEW.id
    ) THEN
      UPDATE public.user_notifications
         SET read_at = NOW()
       WHERE type = 'market_report_editor'
         AND related_id = NEW.listing_id
         AND read_at IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = off;

DROP TRIGGER IF EXISTS autoread_market_report_editor ON public.market_reports;
CREATE TRIGGER autoread_market_report_editor
  AFTER UPDATE OF status ON public.market_reports
  FOR EACH ROW EXECUTE FUNCTION public.autoread_market_report_editor();

-- ════════════════════════════════════════════════════════════
-- 4) 함수 권한 잠금
-- ════════════════════════════════════════════════════════════
REVOKE ALL ON FUNCTION public.autoread_market_report_editor() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
