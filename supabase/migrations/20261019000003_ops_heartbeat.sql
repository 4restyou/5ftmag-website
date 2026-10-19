-- 매일 도는 감시(.github/workflows/health.yml)가 부르는 상태 확인.
--   예약 작업(pg_cron)이 마지막으로 성공한 때와, 기한이 30분 넘게 지났는데 처리되지 않은 자동 승인 예약 수만 돌려준다.
--   숫자·시각뿐이라 anon 에 열어도 개인정보가 없다. pg_cron 이 없으면 각 값은 NULL.
-- 재실행 안전.
CREATE OR REPLACE FUNCTION public.ops_heartbeat()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  job text;
  last_ok timestamptz;
BEGIN
  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    FOREACH job IN ARRAY ARRAY['5ftmag-reader-auto-approve', '5ftmag-page-view-rollup-daily', '5ftmag-operational-retention-daily'] LOOP
      EXECUTE $q$
        SELECT max(d.end_time) FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
        WHERE j.jobname = $1 AND d.status = 'succeeded'
      $q$ INTO last_ok USING job;
      result := result || jsonb_build_object(job, last_ok);
    END LOOP;
  END IF;
  result := result || jsonb_build_object(
    'overdue_auto_approvals',
    (SELECT count(*) FROM public.reader_auto_approvals
      WHERE approved_at IS NULL AND skipped_at IS NULL AND due_at < now() - interval '30 minutes'),
    'checked_at', now()
  );
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_heartbeat() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ops_heartbeat() TO anon, authenticated;
