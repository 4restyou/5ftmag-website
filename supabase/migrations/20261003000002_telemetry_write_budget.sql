-- 세션 값 변경으로 수집량 제한을 우회하지 못하도록 테이블 전체 예산을 함께 적용한다.
CREATE TABLE IF NOT EXISTS public.telemetry_write_budgets (
  scope TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  used INTEGER NOT NULL CHECK (used >= 0)
);
ALTER TABLE public.telemetry_write_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telemetry_write_budgets FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.telemetry_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
  session_cap INTEGER := TG_ARGV[0]::INTEGER;
  total_cap INTEGER := TG_ARGV[1]::INTEGER;
  minute_start TIMESTAMPTZ := date_trunc('minute', clock_timestamp());
  accepted INTEGER;
  recent INTEGER;
BEGIN
  IF NEW.session_id IS NULL OR btrim(NEW.session_id) = '' OR length(NEW.session_id) > 64 THEN
    RETURN NULL;
  END IF;
  NEW.ts := clock_timestamp();

  -- 한 행을 갱신해 동시 요청도 같은 예산을 공유한다. 세션마다 새 행을 만들지 않는다.
  INSERT INTO public.telemetry_write_budgets AS budget (scope, window_start, used)
  VALUES (TG_TABLE_NAME, minute_start, 1)
  ON CONFLICT (scope) DO UPDATE
    SET window_start = EXCLUDED.window_start,
        used = CASE WHEN budget.window_start = EXCLUDED.window_start THEN budget.used + 1 ELSE 1 END
    WHERE budget.window_start <> EXCLUDED.window_start OR budget.used < total_cap
  RETURNING used INTO accepted;
  IF accepted IS NULL THEN RETURN NULL; END IF;

  EXECUTE format(
    'SELECT count(*) FROM (SELECT 1 FROM public.%I WHERE session_id = $1 AND ts > $2 LIMIT %s) s',
    TG_TABLE_NAME, session_cap + 1)
  INTO recent USING NEW.session_id, NEW.ts - interval '1 minute';
  IF recent >= session_cap THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.telemetry_rate_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS page_views_rate_limit ON public.page_views;
CREATE TRIGGER page_views_rate_limit BEFORE INSERT ON public.page_views
  FOR EACH ROW EXECUTE FUNCTION public.telemetry_rate_limit('120', '6000');
DROP TRIGGER IF EXISTS page_dwells_rate_limit ON public.page_dwells;
CREATE TRIGGER page_dwells_rate_limit BEFORE INSERT ON public.page_dwells
  FOR EACH ROW EXECUTE FUNCTION public.telemetry_rate_limit('120', '6000');
DROP TRIGGER IF EXISTS app_events_rate_limit ON public.app_events;
CREATE TRIGGER app_events_rate_limit BEFORE INSERT ON public.app_events
  FOR EACH ROW EXECUTE FUNCTION public.telemetry_rate_limit('60', '3000');
