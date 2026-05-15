-- DEBUG 마이그레이션 — 알림 표시 경로 vs 트리거 경로 분리 검증
--
-- 1) 편집부 전원에게 테스트 알림 한 건 INSERT
--    → 이게 헤더 종/뱃지에 나타나면: 표시 로직은 정상, 트리거가 문제.
--    → 안 나타나면: 표시 로직(RLS, realtime, 뷰) 자체가 깨져있음.
--
-- 2) 알림 트리거 함수 완전 재정의 — 예외 처리 + RAISE WARNING 으로
--    실제 실행되는지 + 실패 시 흔적이 남도록.

-- ────────────────────────────────────────────────
-- 1) 표시 경로 검증용 테스트 알림
-- ────────────────────────────────────────────────
INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
SELECT
  user_id,
  'submission_pending_editor',
  NULL,
  '[테스트] 알림 시스템 점검',
  '이 알림이 보이면 표시 경로는 정상이에요. 트리거/INSERT 경로만 손보면 됩니다.',
  '/admin/submissions.html'
FROM public.profiles
WHERE is_editor = TRUE;

-- ────────────────────────────────────────────────
-- 2) 편집부 알림 트리거 함수 — 예외 캐치 + WARNING 로깅
--    트리거가 안 도는 경우 / INSERT 가 막히는 경우를 로그로 구분 가능
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_editors_new_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  ed RECORD;
  inserted_count INTEGER := 0;
BEGIN
  RAISE WARNING '[notify_editors_new_submission] FIRED submission_id=% status=%', NEW.id, NEW.status;
  IF NEW.status = 'pending' THEN
    FOR ed IN
      SELECT user_id FROM public.profiles WHERE is_editor IS TRUE
    LOOP
      BEGIN
        INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
        VALUES (
          ed.user_id,
          'submission_pending_editor',
          NEW.id,
          '새 사진 검토 요청',
          '독자가 새 사진을 제출했어요. 승인/반려를 검토해 주세요.',
          '/admin/submissions.html'
        );
        inserted_count := inserted_count + 1;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[notify_editors_new_submission] INSERT failed for editor=% sqlstate=% msg=%',
                      ed.user_id, SQLSTATE, SQLERRM;
      END;
    END LOOP;
    RAISE WARNING '[notify_editors_new_submission] DONE inserted=%', inserted_count;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[notify_editors_new_submission] OUTER FAIL sqlstate=% msg=%', SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$$;

-- 같은 방식으로 매물 신고 트리거도
CREATE OR REPLACE FUNCTION public.notify_editors_new_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  ed RECORD;
  inserted_count INTEGER := 0;
BEGIN
  RAISE WARNING '[notify_editors_new_report] FIRED listing_id=%', NEW.listing_id;
  FOR ed IN
    SELECT user_id FROM public.profiles WHERE is_editor IS TRUE
  LOOP
    BEGIN
      INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
      VALUES (
        ed.user_id,
        'market_report_editor',
        NEW.listing_id,
        '매물 신고가 접수됐어요',
        '신고된 매물을 검토하고 필요한 조치를 진행해 주세요.',
        '/admin/market-reports.html'
      );
      inserted_count := inserted_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[notify_editors_new_report] INSERT failed for editor=% sqlstate=% msg=%',
                    ed.user_id, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  RAISE WARNING '[notify_editors_new_report] DONE inserted=%', inserted_count;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[notify_editors_new_report] OUTER FAIL sqlstate=% msg=%', SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$$;

-- 트리거 재바인딩 (이미 있어도 idempotent)
DROP TRIGGER IF EXISTS notify_editors_new_submission ON public.reader_submissions;
CREATE TRIGGER notify_editors_new_submission
  AFTER INSERT ON public.reader_submissions
  FOR EACH ROW EXECUTE FUNCTION public.notify_editors_new_submission();

DROP TRIGGER IF EXISTS notify_editors_new_report ON public.market_reports;
CREATE TRIGGER notify_editors_new_report
  AFTER INSERT ON public.market_reports
  FOR EACH ROW EXECUTE FUNCTION public.notify_editors_new_report();

NOTIFY pgrst, 'reload schema';
