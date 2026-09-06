-- 이주의 사진 선정 알림 — 뽑힌 사람에게 알린다.
--
-- user_notifications 에 한 줄 들어가면 벨 알림과 Web Push 가 함께 나간다
-- (20260614000002_push_dispatch.sql 의 트리거). 그래서 여기서는 알림 종류만
-- 하나 늘리면 된다.
--
-- 보내는 시점은 "게재일" 이 아니라 "선정한 순간" 이다. 예약 게재가 있어서
-- 게재일에 맞춰 보내려면 스케줄러(pg_cron)가 필요한데, 확장이 켜지지 않은
-- 채로 넘어가면 알림이 조용히 안 나가고 편집부는 나갔다고 믿게 된다.
-- 그래서 시점을 옮기는 대신 문구를 나눈다. 오늘 이하 날짜로 걸면 그 순간이
-- 곧 게재 순간이라 "걸렸어요", 미래 날짜면 "언제부터 걸립니다" 로 보낸다.

ALTER TABLE public.user_notifications
  DROP CONSTRAINT IF EXISTS user_notifications_type_check;

ALTER TABLE public.user_notifications
  ADD  CONSTRAINT user_notifications_type_check
       CHECK (type IN (
         'submission_approved',
         'submission_rejected',
         'submission_deleted',
         'submission_pending_editor',
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

NOTIFY pgrst, 'reload schema';
