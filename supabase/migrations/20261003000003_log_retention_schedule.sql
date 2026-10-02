-- Fixed operational retention only. No photos, messages, orders or Storage objects.
CREATE SCHEMA IF NOT EXISTS ops_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA ops_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA ops_private TO service_role, postgres;

CREATE OR REPLACE FUNCTION ops_private.purge_operational_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $purge$
BEGIN
  -- A concurrent manual service invocation must not overlap the daily job.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(20261003, 3) THEN
    RAISE EXCEPTION 'Operational retention purge already running'
      USING ERRCODE = '55P03';
  END IF;

  DELETE FROM public.page_views
    WHERE ts < pg_catalog.now() - INTERVAL '365 days';
  DELETE FROM public.page_dwells
    WHERE ts < pg_catalog.now() - INTERVAL '365 days';
  DELETE FROM public.app_events
    WHERE ts < pg_catalog.now() - INTERVAL '90 days';
  DELETE FROM public.client_error_logs
    WHERE ts < pg_catalog.now() - INTERVAL '30 days';
  DELETE FROM public.push_subscriptions
    WHERE last_seen_at < pg_catalog.now() - INTERVAL '30 days';
END;
$purge$;

ALTER FUNCTION ops_private.purge_operational_logs() OWNER TO postgres;
REVOKE ALL ON FUNCTION ops_private.purge_operational_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops_private.purge_operational_logs() TO service_role, postgres;

-- Supabase hosts pg_cron. Minimal local Postgres builds may not ship its files.
-- Installation/preload/permission errors where it IS available must fail, not hide.
DO $install_cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;
END;
$install_cron$;

DO $schedule_retention$
DECLARE
  stale_job bigint;
BEGIN
  IF pg_catalog.to_regclass('cron.job') IS NULL THEN
    RAISE WARNING 'R12 RETENTION NOT SCHEDULED: pg_cron unavailable. Enable Supabase Cron and replay 20261003000003_log_retention_schedule.sql; run scripts/ops-health.mjs to verify.';
    RETURN;
  END IF;

  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'R12 retention schedule must be installed as postgres';
  END IF;

  -- Named schedules upsert per owner. Remove only same-name jobs of other owners.
  FOR stale_job IN
    SELECT jobid FROM cron.job
    WHERE jobname = '5ftmag-operational-retention-daily' AND username <> 'postgres'
  LOOP
    PERFORM cron.unschedule(stale_job);
  END LOOP;

  PERFORM cron.schedule(
    '5ftmag-operational-retention-daily',
    '17 3 * * *',
    'SET statement_timeout = ''5min''; SET lock_timeout = ''5s''; SELECT ops_private.purge_operational_logs();'
  );
END;
$schedule_retention$;
