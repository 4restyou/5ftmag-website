-- user_notifications INSERT → send-push edge function 호출
-- ════════════════════════════════════════════════════════════
-- pg_net.http_post 로 send-push 함수 URL 호출.
-- 함수 URL 과 공유 시크릿은 Vault Secret 으로 보관 (notifications_webhook 와 같은 패턴).
--
-- 사전 설정 (Supabase Dashboard 에서 1회):
--   Vault → 새 secret 추가:
--     이름: push_function_url
--     값:  https://pucpqsfwqouqohwsvmnd.supabase.co/functions/v1/send-push
--   Vault → 새 secret 추가:
--     이름: push_dispatch_secret
--     값:  <임의의 긴 랜덤 문자열> (Edge Function 의 PUSH_DISPATCH_SECRET 시크릿과 같은 값)
-- secret 미설정 시 트리거는 조용히 no-op (send-push 호출 없이 in-app 알림만 그대로 동작).
-- ════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public._push_get_vault(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v TEXT;
BEGIN
  SELECT decrypted_secret INTO v
  FROM vault.decrypted_secrets
  WHERE name = p_name
  LIMIT 1;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_notifications_dispatch_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fn_url TEXT;
  secret TEXT;
BEGIN
  fn_url := public._push_get_vault('push_function_url');
  IF fn_url IS NULL OR fn_url = '' THEN
    RETURN NEW;
  END IF;
  secret := COALESCE(public._push_get_vault('push_dispatch_secret'), '');

  PERFORM net.http_post(
    url := fn_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-dispatch-secret', secret
    ),
    body := jsonb_build_object(
      'user_id', NEW.user_id,
      'title', NEW.title,
      'body', NEW.body,
      'link', NEW.link
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_notifications_dispatch_push ON public.user_notifications;
CREATE TRIGGER user_notifications_dispatch_push
  AFTER INSERT ON public.user_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.user_notifications_dispatch_push();

REVOKE ALL ON FUNCTION public._push_get_vault(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.user_notifications_dispatch_push() FROM PUBLIC, anon, authenticated;
