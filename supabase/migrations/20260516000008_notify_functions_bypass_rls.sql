-- 알림 트리거 함수가 user_notifications INSERT 시 RLS 에 막힐 가능성 차단.
-- SECURITY DEFINER + 함수 단위 row_security=off 로 명시 우회.
-- 또한 함수 owner 가 BYPASSRLS 가 없는 환경(supabase_admin 등)에서도 동작하도록
-- user_notifications 에 system INSERT 정책 추가 (postgres role 한정).

-- ────────────────────────────────────────────────
-- 1) 함수 단위 row_security=off (반복 적용 안전)
-- ────────────────────────────────────────────────
ALTER FUNCTION public.notify_reader_submission_status()  SET row_security = off;
ALTER FUNCTION public.notify_reader_submission_deleted() SET row_security = off;
ALTER FUNCTION public.notify_market_listing_status()     SET row_security = off;
ALTER FUNCTION public.notify_editors_new_submission()    SET row_security = off;
ALTER FUNCTION public.notify_editors_new_report()        SET row_security = off;

-- ────────────────────────────────────────────────
-- 2) postgres / supabase_admin / service_role 만 INSERT 허용
--    (트리거 함수가 SECURITY DEFINER 로 실행될 때의 캐치-올)
-- ────────────────────────────────────────────────
DROP POLICY IF EXISTS "notifications system insert" ON public.user_notifications;
CREATE POLICY "notifications system insert" ON public.user_notifications
  FOR INSERT
  WITH CHECK (
    -- postgres / supabase_admin / service_role 셋 중 하나면 INSERT 통과.
    -- anon/authenticated 사용자는 여전히 INSERT 불가.
    current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin')
  );

-- ────────────────────────────────────────────────
-- 3) 편집부 알림 트리거 함수 재정의 — 디버그 NOTICE 포함
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_editors_new_submission()
RETURNS TRIGGER AS $$
DECLARE
  ed RECORD;
  count_editors INTEGER := 0;
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
      count_editors := count_editors + 1;
    END LOOP;
    RAISE NOTICE '[notify_editors_new_submission] submission_id=% editors=%', NEW.id, count_editors;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = off;

CREATE OR REPLACE FUNCTION public.notify_editors_new_report()
RETURNS TRIGGER AS $$
DECLARE
  ed RECORD;
  count_editors INTEGER := 0;
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
    count_editors := count_editors + 1;
  END LOOP;
  RAISE NOTICE '[notify_editors_new_report] listing_id=% editors=%', NEW.listing_id, count_editors;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = off;

NOTIFY pgrst, 'reload schema';
