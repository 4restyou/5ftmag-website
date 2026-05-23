-- ──────────────────────────────────────────────────────────────
-- 1) 5월 16일 notification 디버그 사이클 잔재 정리
--    user_notifications 의 debug_test 타입은 운영 데이터 아님.
--    debug_notif_status RPC 자체는 20260518000005 에서 이미 drop 됨.
-- 2) comments.updated_at 을 서버 트리거로 보증
--    현재 js/db-client.js 가 클라이언트 시계 ISO 문자열을 함께 보내고 있으나,
--    클라이언트 시계는 신뢰 불가. BEFORE UPDATE 트리거로 강제.
--    본문 수정 시에만 발화 (soft delete 등 다른 컬럼 변경은 updated_at 영향 X).
-- ──────────────────────────────────────────────────────────────

DELETE FROM public.user_notifications
WHERE type = 'debug_test';

CREATE OR REPLACE FUNCTION public.set_comments_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_set_updated_at ON public.comments;
CREATE TRIGGER comments_set_updated_at
  BEFORE UPDATE ON public.comments
  FOR EACH ROW
  WHEN (OLD.body IS DISTINCT FROM NEW.body)
  EXECUTE FUNCTION public.set_comments_updated_at();
