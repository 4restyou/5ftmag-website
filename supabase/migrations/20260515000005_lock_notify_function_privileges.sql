-- 알림 webhook 함수 실행 권한 잠금
-- SECURITY DEFINER 함수는 생성 직후 PUBLIC 실행 권한이 열릴 수 있으므로,
-- trigger 내부 실행 외에 클라이언트가 직접 호출하지 못하게 명시적으로 닫는다.

REVOKE ALL ON FUNCTION public._notify_webhook_url() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._notify_webhook_url() FROM anon;
REVOKE ALL ON FUNCTION public._notify_webhook_url() FROM authenticated;

REVOKE ALL ON FUNCTION public._notify_send(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._notify_send(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public._notify_send(TEXT) FROM authenticated;

REVOKE ALL ON FUNCTION public._notify_new_submission() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._notify_new_submission() FROM anon;
REVOKE ALL ON FUNCTION public._notify_new_submission() FROM authenticated;

REVOKE ALL ON FUNCTION public._notify_new_market_report() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._notify_new_market_report() FROM anon;
REVOKE ALL ON FUNCTION public._notify_new_market_report() FROM authenticated;
