-- push_subscriptions 보안 + 운영 보강
-- ════════════════════════════════════════════════════════════
-- 1) Ownership guard — endpoint UNIQUE 만으로는 같은 endpoint 를 다른 user_id 로
--    upsert 가능. BEFORE UPDATE 트리거로 user_id 변경을 막아 도용 차단.
-- 2) TTL cleanup RPC — 30일 이상 last_seen_at 미갱신 endpoint 자동 정리.
-- 3) last_seen_at 업데이트 자동화 — send-push 가 410 응답 받을 때 prune 하지만,
--    정상 발송 시에도 주기적으로 last_seen_at 만 갱신해 정상 활성 구독 보존.
-- ════════════════════════════════════════════════════════════

-- ── 1) Ownership guard ──
CREATE OR REPLACE FUNCTION public.push_subscriptions_ownership_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'push_subscriptions.user_id 는 변경할 수 없어요'
      USING ERRCODE = '42501';
  END IF;
  -- endpoint 변경도 금지 (UNIQUE 인덱스로도 충돌하지만 명시적 차단)
  IF NEW.endpoint IS DISTINCT FROM OLD.endpoint THEN
    RAISE EXCEPTION 'push_subscriptions.endpoint 는 변경할 수 없어요'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_subscriptions_ownership_guard ON public.push_subscriptions;
CREATE TRIGGER push_subscriptions_ownership_guard
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.push_subscriptions_ownership_guard();

REVOKE ALL ON FUNCTION public.push_subscriptions_ownership_guard() FROM PUBLIC, anon, authenticated;

-- ── 2) TTL cleanup RPC (편집부만 호출 가능, cron 또는 수동 실행) ──
CREATE OR REPLACE FUNCTION public.admin_push_subscriptions_purge(p_keep_days INT DEFAULT 30)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  keep_n INT := GREATEST(COALESCE(p_keep_days, 30), 7);
  removed BIGINT;
BEGIN
  PERFORM public._analytics_assert_editor();
  DELETE FROM public.push_subscriptions
    WHERE last_seen_at < NOW() - (keep_n::TEXT || ' days')::INTERVAL;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_push_subscriptions_purge(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_push_subscriptions_purge(INT) TO authenticated;

-- ── 3) (선택) last_seen_at 자동 갱신 트리거 ──
-- upsert 의 ON CONFLICT 시 last_seen_at 이 클라이언트값으로 들어오지만,
-- 클라가 보낼 때만 갱신되므로 send-push 의 정상 발송 시에도 갱신할 수 있게
-- send-push edge function 에서 직접 UPDATE 하는 게 깔끔. 이 부분은 함수 코드에서
-- 처리 (별도 트리거 불필요).
