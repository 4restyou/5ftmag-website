-- RECOVERY — 이전 마이그레이션이 실패해서 debug_notif_status 함수가 없는 상태 복구.
-- 단일 책임: 진단 함수만 생성. CHECK 변경, INSERT, 정책 변경 일체 없음.
-- 실패 가능성을 최소화.

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
      SELECT jsonb_build_object(
        'user_id', p.user_id,
        'display_name', p.display_name,
        'is_editor', p.is_editor
      )
      FROM public.profiles p WHERE p.user_id = auth.uid()
    ),
    'editor_count', (SELECT count(*) FROM public.profiles WHERE is_editor = TRUE),
    'my_notification_count', (
      SELECT count(*) FROM public.user_notifications WHERE user_id = auth.uid()
    ),
    'my_unread_count', (
      SELECT count(*) FROM public.user_notifications
       WHERE user_id = auth.uid() AND read_at IS NULL
    ),
    'my_recent_titles', (
      SELECT jsonb_agg(title)
        FROM (
          SELECT title FROM public.user_notifications
           WHERE user_id = auth.uid()
           ORDER BY created_at DESC LIMIT 5
        ) t
    ),
    'trigger_editors_new_submission_exists', (
      SELECT count(*) > 0 FROM pg_trigger
       WHERE tgname = 'notify_editors_new_submission'
    ),
    'user_notif_check_constraint', (
      SELECT pg_get_constraintdef(c.oid)
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname = 'user_notifications'
         AND c.conname = 'user_notifications_type_check'
    )
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.debug_notif_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debug_notif_status() TO authenticated;

NOTIFY pgrst, 'reload schema';
