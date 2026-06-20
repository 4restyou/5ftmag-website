-- Web Push dispatch 는 함수 URL 과 공유 시크릿이 모두 있을 때만 실행한다.
-- Edge Function 도 동일하게 시크릿 미설정 시 503 fail-closed 한다.

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
  secret := public._push_get_vault('push_dispatch_secret');
  IF fn_url IS NULL OR fn_url = '' OR secret IS NULL OR secret = '' THEN
    RETURN NEW;
  END IF;

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

REVOKE ALL ON FUNCTION public.user_notifications_dispatch_push() FROM PUBLIC, anon, authenticated;
