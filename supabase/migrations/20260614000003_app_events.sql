-- 이벤트 로깅 — 페이지뷰 외 사용자 액션 측정 (sheet_opened, lightbox_opened, push_subscribed 등)
-- ════════════════════════════════════════════════════════════
-- 정책: page_views 와 동일 — anon INSERT 만 허용, SELECT 는 editor RPC 로만.
-- 페이로드: event_name + 선택적 properties(jsonb, 짧은 키-값) + 세션 + 경로.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.app_events (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_name  TEXT NOT NULL,
  path        TEXT,
  session_id  TEXT,
  ua_family   TEXT,
  properties  JSONB
);

CREATE INDEX IF NOT EXISTS app_events_ts_idx           ON public.app_events (ts DESC);
CREATE INDEX IF NOT EXISTS app_events_name_ts_idx      ON public.app_events (event_name, ts DESC);
CREATE INDEX IF NOT EXISTS app_events_session_idx      ON public.app_events (session_id, ts);

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_insert_app_events" ON public.app_events;
CREATE POLICY "anon_insert_app_events"
  ON public.app_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
        event_name IS NOT NULL
    AND char_length(event_name) BETWEEN 1 AND 64
    AND event_name ~ '^[a-z][a-z0-9_]*$'
    AND (path       IS NULL OR char_length(path)       <=  500)
    AND (session_id IS NULL OR char_length(session_id) <=   64)
    AND (ua_family  IS NULL OR char_length(ua_family)  <=   32)
    AND (properties IS NULL OR pg_column_size(properties) <= 2048)
  );

-- ════════════════════════════════════════════════════════════
-- 통계 RPC — editor 만 열람
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_events_summary(p_days INT DEFAULT 7, p_limit INT DEFAULT 50)
RETURNS TABLE (
  event_name TEXT,
  total      BIGINT,
  unique_sessions BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  days_n  INT := GREATEST(COALESCE(p_days,  7),  1);
  limit_n INT := GREATEST(COALESCE(p_limit, 50), 1);
BEGIN
  PERFORM public._analytics_assert_editor();
  RETURN QUERY
    SELECT e.event_name,
           COUNT(*)::BIGINT,
           COUNT(DISTINCT e.session_id)::BIGINT
    FROM public.app_events e
    WHERE e.ts >= NOW() - (days_n::TEXT || ' days')::INTERVAL
    GROUP BY e.event_name
    ORDER BY 2 DESC
    LIMIT limit_n;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_events_summary(INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_events_summary(INT, INT) TO authenticated;

-- 90일 이상은 자동 정리 RPC (cron 또는 수동)
CREATE OR REPLACE FUNCTION public.admin_events_purge(p_keep_days INT DEFAULT 90)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  keep_n INT := GREATEST(COALESCE(p_keep_days, 90), 7);
  removed BIGINT;
BEGIN
  PERFORM public._analytics_assert_editor();
  DELETE FROM public.app_events
    WHERE ts < NOW() - (keep_n::TEXT || ' days')::INTERVAL;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_events_purge(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_events_purge(INT) TO authenticated;
