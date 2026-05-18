-- ──────────────────────────────────────────────────────────────
-- Remove temporary notification diagnostics
--   debug_notif_status 는 알림 문제 확인용 임시 RPC 였다.
--   운영에서는 공개 클라이언트 경로와 RPC 표면을 줄이기 위해 제거한다.
-- ──────────────────────────────────────────────────────────────

drop function if exists public.debug_notif_status();

notify pgrst, 'reload schema';
