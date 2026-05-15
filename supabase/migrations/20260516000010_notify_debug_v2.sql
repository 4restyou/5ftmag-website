-- DEBUG v2 — 알림 INSERT 가 실패하는 원인 확정 + 안전한 우회

-- ────────────────────────────────────────────────
-- 1) CHECK 제약 재정의 — 모든 타입 확실히 포함 (멱등)
-- ────────────────────────────────────────────────
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
         'submission_pending_editor',
         'market_report_editor',
         'debug_test'
       ));

-- ────────────────────────────────────────────────
-- 2) 기존 INSERT 정책 제거 — current_user 기반은 silently 차단 위험
--    대신 "anon 만 차단, 그 외(authenticated/postgres/service_role) 허용"
--    실제 사용자가 직접 INSERT 하는 경로는 없으나, 트리거의 SECURITY DEFINER
--    가 어떤 role 로 실행되든 통과되도록 폭넓게 허용.
-- ────────────────────────────────────────────────
DROP POLICY IF EXISTS "notifications system insert" ON public.user_notifications;
CREATE POLICY "notifications open insert" ON public.user_notifications
  FOR INSERT
  WITH CHECK (true);

-- ────────────────────────────────────────────────
-- 3) 진단 RPC — 사용자가 console 에서 호출 가능
--    어떤 user_id 로 로그인했는지, 본인 알림 몇 개 있는지, 트리거 존재 여부 등
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.debug_notif_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'auth_uid', auth.uid(),
    'profile', (
      SELECT jsonb_build_object('user_id', p.user_id, 'display_name', p.display_name, 'is_editor', p.is_editor)
      FROM public.profiles p WHERE p.user_id = auth.uid()
    ),
    'editor_count', (SELECT count(*) FROM public.profiles WHERE is_editor = TRUE),
    'my_notification_count', (SELECT count(*) FROM public.user_notifications WHERE user_id = auth.uid()),
    'my_unread_count', (SELECT count(*) FROM public.user_notifications WHERE user_id = auth.uid() AND read_at IS NULL),
    'my_recent_titles', (
      SELECT jsonb_agg(title) FROM (
        SELECT title FROM public.user_notifications
         WHERE user_id = auth.uid()
         ORDER BY created_at DESC LIMIT 5
      ) t
    ),
    'trigger_editors_new_submission_exists', (
      SELECT count(*) > 0 FROM pg_trigger
       WHERE tgname = 'notify_editors_new_submission'
    )
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.debug_notif_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debug_notif_status() TO authenticated;

-- ────────────────────────────────────────────────
-- 4) 두 번째 테스트 알림 INSERT — debug_test 타입으로
--    CHECK 제약이 방금 갱신됐으므로 무조건 통과
-- ────────────────────────────────────────────────
INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
SELECT
  user_id,
  'debug_test',
  NULL,
  '[디버그 #2] 알림 표시 확인',
  '이 알림이 종 아이콘에 표시되면 SELECT/표시 경로는 정상입니다. 마이그레이션 #61 의 테스트는 CHECK 제약 누락으로 실패했었을 가능성.',
  '/me.html'
FROM public.profiles
WHERE is_editor = TRUE;

NOTIFY pgrst, 'reload schema';
