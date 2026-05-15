-- 5ft.mag 운영 알림 — DB 이벤트가 발생하면 외부 webhook (Slack/Discord) 으로 POST.
-- pg_net (Supabase 내장) 사용. webhook URL 은 Vault Secret 으로 보관.
--
-- ════════════════════════════════════════════════════════════
-- 사전 설정 (Supabase Dashboard 에서 1회):
-- ════════════════════════════════════════════════════════════
--   1) Extensions → pg_net 활성화
--   2) Vault → 새 secret 추가:
--        이름:  notification_webhook_url
--        값:   https://hooks.slack.com/services/XXX/YYY/ZZZ  (또는 Discord webhook URL)
--   3) 본 마이그레이션이 자동으로 trigger 를 붙임:
--        - 신규 reader_submissions (status='pending') 들어올 때
--        - 신규 market_reports 들어올 때
--   4) 알림이 더 필요하면 NEW 의 컬럼들 다듬어 다른 이벤트(승인/반려 등) 도 같은 패턴으로 추가.

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ────────────────────────────────────────────────────────────
-- Vault 에서 webhook URL 가져오는 헬퍼 (없으면 NULL 반환 → 알림 skip)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._notify_webhook_url()
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
  WHERE name = 'notification_webhook_url'
  LIMIT 1;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 공통 POST 함수 — 본문은 JSON ('text' 필드는 Slack/Discord 둘 다 통용)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._notify_send(p_text TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
BEGIN
  v_url := public._notify_webhook_url();
  IF v_url IS NULL OR v_url = '' THEN
    RETURN;  -- secret 미설정 → silent skip
  END IF;
  PERFORM net.http_post(
    url     := v_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object('text', p_text, 'content', p_text)
  );
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 1) 신규 사진 투고 → 알림
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._notify_new_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_text TEXT;
BEGIN
  IF NEW.status = 'pending' THEN
    v_text := format(
      '📷 새 사진 투고가 들어왔어요.%s%s필름: %s · 카메라: %s%s검토하러 가기: https://www.5ftmag.com/admin/submissions.html',
      E'\n', E'\n',
      COALESCE(NEW.film, '(미입력)'),
      COALESCE(NEW.camera, '(미입력)'),
      E'\n\n'
    );
    PERFORM public._notify_send(v_text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_new_submission ON public.reader_submissions;
CREATE TRIGGER notify_new_submission
  AFTER INSERT ON public.reader_submissions
  FOR EACH ROW EXECUTE FUNCTION public._notify_new_submission();

-- ────────────────────────────────────────────────────────────
-- 2) 신규 매물 신고 → 알림
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._notify_new_market_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_text TEXT;
  v_title TEXT;
BEGIN
  SELECT title INTO v_title FROM public.market_listings WHERE id = NEW.listing_id;
  v_text := format(
    '🚨 새 매물 신고가 들어왔어요.%s%s매물: %s%s사유: %s%s검토하러 가기: https://www.5ftmag.com/admin/market-reports.html',
    E'\n', E'\n',
    COALESCE(v_title, '(매물 정보 없음)'),
    E'\n',
    LEFT(NEW.reason, 200),
    E'\n\n'
  );
  PERFORM public._notify_send(v_text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_new_market_report ON public.market_reports;
CREATE TRIGGER notify_new_market_report
  AFTER INSERT ON public.market_reports
  FOR EACH ROW EXECUTE FUNCTION public._notify_new_market_report();

-- ════════════════════════════════════════════════════════════
-- 끄고 싶을 때: vault secret 을 비우거나 trigger 만 DROP
--   DROP TRIGGER notify_new_submission ON public.reader_submissions;
--   DROP TRIGGER notify_new_market_report ON public.market_reports;
-- ════════════════════════════════════════════════════════════
