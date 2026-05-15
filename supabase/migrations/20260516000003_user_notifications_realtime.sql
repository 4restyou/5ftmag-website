-- user_notifications 를 supabase_realtime publication 에 추가
-- (헤더 종 아이콘 토스트 알림이 실시간으로 도착하려면 필요)
-- 이미 추가되어 있을 수 있어 idempotent 하게 처리
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'user_notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications';
  END IF;
END $$;
