-- 믿을 수 있는 투고자의 사진 자동 승인 (운영자 결정, 2026-10-12).
--
-- 대상: 승인된 사진이 20장 이상이고, 자동 승인된 사진이 나중에 반려된 적이 없는 사람.
-- 올린 지 3시간이 지나도 편집부가 손대지 않았으면 승인한다. 그 사이 편집부가 승인·반려하면
-- 자동 승인은 일어나지 않는다.
-- 빼는 경우: 중복 의심 표시(dup_of)가 붙은 사진, 필름 표기가 카탈로그(이름·별칭)와 맞지 않는 사진.
--
-- 독자는 자동 승인인지 알 수 없어야 한다(운영자 요청). 그래서 예약·이력은 reader_submissions 가
-- 아니라 편집부만 읽는 별도 표(reader_auto_approvals)에 둔다. 본인은 자기 행의 모든 칸을 읽을 수
-- 있기 때문이다. 승인 알림도 편집부 승인과 똑같이 나간다(notify_reader_submission_status).
--
-- 3시간마다가 아니라 10분마다 도는 pg_cron 작업이 기한이 지난 예약을 처리한다.
-- 재실행 안전.

-- ── 예약·이력 ──
CREATE TABLE IF NOT EXISTS public.reader_auto_approvals (
  submission_id uuid PRIMARY KEY REFERENCES public.reader_submissions(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  due_at        timestamptz NOT NULL,
  approved_at   timestamptz,          -- 자동 승인한 때
  skipped_at    timestamptz,          -- 기한에 조건이 맞지 않아 건너뛴 때
  skip_reason   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auto_approvals_due
  ON public.reader_auto_approvals (due_at)
  WHERE approved_at IS NULL AND skipped_at IS NULL;

-- 자동 승인한 사진을 편집부가 나중에 반려하면 그 사람은 다시 수동 승인으로 돌아간다.
CREATE TABLE IF NOT EXISTS public.reader_auto_approve_revoked (
  user_id      uuid PRIMARY KEY,
  submission_id uuid,
  revoked_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reader_auto_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reader_auto_approve_revoked ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "editors read auto approvals" ON public.reader_auto_approvals;
CREATE POLICY "editors read auto approvals" ON public.reader_auto_approvals
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor));
DROP POLICY IF EXISTS "editors manage auto approve revoked" ON public.reader_auto_approve_revoked;
CREATE POLICY "editors manage auto approve revoked" ON public.reader_auto_approve_revoked
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor));
REVOKE ALL ON public.reader_auto_approvals FROM anon;
REVOKE ALL ON public.reader_auto_approve_revoked FROM anon;

-- ── 기준 ──
CREATE OR REPLACE FUNCTION public.reader_auto_approve_min_approved()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 20 $$;

-- js/util.js 의 normalizeFilmLabel 과 같은 규칙.
CREATE OR REPLACE FUNCTION public.reader_film_key(s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(lower(coalesce(s, '')), '[[:space:]_+()/.-]+', '', 'g')
$$;

-- 필름 표기가 숨기지 않은 카탈로그 필름의 표시 이름·이름·별칭 가운데 하나와 같은가.
CREATE OR REPLACE FUNCTION public.reader_film_in_catalog(p_film text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.reader_film_key(p_film) <> '' AND EXISTS (
    SELECT 1 FROM public.films f
    WHERE NOT f.is_hidden
      AND (public.reader_film_key(f.display_name) = public.reader_film_key(p_film)
        OR public.reader_film_key(f.name) = public.reader_film_key(p_film)
        OR public.reader_film_key(f.brand || ' ' || f.name) = public.reader_film_key(p_film)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(f.aliases) a
                   WHERE public.reader_film_key(a) = public.reader_film_key(p_film)))
  )
$$;

CREATE OR REPLACE FUNCTION public.reader_is_trusted(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.reader_auto_approve_revoked r WHERE r.user_id = p_user)
     AND (SELECT count(*) FROM public.reader_submissions s
          WHERE s.user_id = p_user AND s.status = 'approved')
         >= public.reader_auto_approve_min_approved()
$$;
REVOKE ALL ON FUNCTION public.reader_is_trusted(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reader_film_in_catalog(text) FROM PUBLIC, anon, authenticated;

-- ── 본인 수정 보호 트리거: 자동 승인만 통과시킨다 ──
-- 자동 승인은 로그인 없이(auth.uid() 가 없음) 아래 함수 안에서만 app.auto_approve 를 켜고 돈다.
-- PostgREST 로 들어온 요청은 이 설정을 바꿀 수 없다.
CREATE OR REPLACE FUNCTION public.reader_submissions_owner_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  is_editor_now BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' AND auth.uid() IS NULL
     AND current_setting('app.auto_approve', true) = 'on'
     AND OLD.status = 'pending' AND NEW.status = 'approved'
     AND NEW.user_id = OLD.user_id AND NEW.storage_path = OLD.storage_path
     AND NEW.film IS NOT DISTINCT FROM OLD.film THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(is_editor, FALSE) INTO is_editor_now
  FROM public.profiles WHERE user_id = auth.uid();
  IF COALESCE(is_editor_now, FALSE) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'status 는 본인이 정할 수 없습니다'; END IF;
    IF NEW.rejection_reason IS NOT NULL THEN RAISE EXCEPTION 'rejection_reason 은 본인이 정할 수 없습니다'; END IF;
    IF NEW.reviewed_at IS NOT NULL THEN RAISE EXCEPTION 'reviewed_at 는 본인이 정할 수 없습니다'; END IF;
    IF NEW.reviewed_by IS NOT NULL THEN RAISE EXCEPTION 'reviewed_by 는 본인이 정할 수 없습니다'; END IF;
    IF NEW.featured_at IS NOT NULL THEN RAISE EXCEPTION 'featured_at 는 편집부만 정할 수 있습니다'; END IF;
    IF NEW.featured_note IS NOT NULL THEN RAISE EXCEPTION 'featured_note 는 편집부만 정할 수 있습니다'; END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['submitter_name', 'instagram', 'film', 'camera', 'caption'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['submitter_name', 'instagram', 'film', 'camera', 'caption']) THEN
      RAISE EXCEPTION '이름, SNS, 필름, 카메라, 메모만 수정할 수 있습니다';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 올릴 때 예약 ──
CREATE OR REPLACE FUNCTION public.reader_submissions_schedule_auto_approve()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'pending' AND NEW.dup_of IS NULL
     AND public.reader_is_trusted(NEW.user_id)
     AND public.reader_film_in_catalog(NEW.film) THEN
    INSERT INTO public.reader_auto_approvals(submission_id, user_id, due_at)
    VALUES (NEW.id, NEW.user_id, NEW.created_at + interval '3 hours')
    ON CONFLICT (submission_id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS reader_submissions_schedule_auto_approve ON public.reader_submissions;
CREATE TRIGGER reader_submissions_schedule_auto_approve
  AFTER INSERT ON public.reader_submissions
  FOR EACH ROW EXECUTE FUNCTION public.reader_submissions_schedule_auto_approve();

-- ── 자동 승인한 사진을 반려하면 그 사람은 자동 승인에서 뺀다 (중복 반려는 빼고) ──
CREATE OR REPLACE FUNCTION public.reader_submissions_revoke_auto_approve()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'rejected' AND OLD.status = 'approved'
     AND NOT COALESCE(NEW.duplicate_rejected, false)
     AND EXISTS (SELECT 1 FROM public.reader_auto_approvals a
                 WHERE a.submission_id = NEW.id AND a.approved_at IS NOT NULL) THEN
    INSERT INTO public.reader_auto_approve_revoked(user_id, submission_id)
    VALUES (NEW.user_id, NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    -- 아직 기한 전인 그 사람의 다른 예약도 거둔다.
    UPDATE public.reader_auto_approvals
       SET skipped_at = now(), skip_reason = 'revoked'
     WHERE user_id = NEW.user_id AND approved_at IS NULL AND skipped_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS reader_submissions_revoke_auto_approve ON public.reader_submissions;
CREATE TRIGGER reader_submissions_revoke_auto_approve
  AFTER UPDATE OF status ON public.reader_submissions
  FOR EACH ROW EXECUTE FUNCTION public.reader_submissions_revoke_auto_approve();

-- ── 기한이 지난 예약 처리 (pg_cron 이 부른다) ──
CREATE SCHEMA IF NOT EXISTS ops_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA ops_private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION ops_private.run_reader_auto_approvals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $run$
DECLARE
  rec record;
  done integer := 0;
  reason text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(20261012, 1) THEN
    RETURN 0;
  END IF;
  PERFORM set_config('app.auto_approve', 'on', true);

  FOR rec IN
    SELECT a.submission_id, s.status, s.dup_of, s.film, s.user_id
      FROM public.reader_auto_approvals a
      JOIN public.reader_submissions s ON s.id = a.submission_id
     WHERE a.approved_at IS NULL AND a.skipped_at IS NULL AND a.due_at <= now()
     ORDER BY a.due_at
     LIMIT 200
     FOR UPDATE OF a SKIP LOCKED
  LOOP
    reason := CASE
      WHEN rec.status <> 'pending' THEN 'reviewed'          -- 편집부가 먼저 처리함
      WHEN rec.dup_of IS NOT NULL THEN 'duplicate'
      WHEN NOT public.reader_film_in_catalog(rec.film) THEN 'film'   -- 그 사이 필름 표기를 바꿈
      WHEN NOT public.reader_is_trusted(rec.user_id) THEN 'untrusted'
      ELSE NULL END;
    IF reason IS NOT NULL THEN
      UPDATE public.reader_auto_approvals
         SET skipped_at = now(), skip_reason = reason
       WHERE submission_id = rec.submission_id;
      CONTINUE;
    END IF;

    UPDATE public.reader_submissions
       SET status = 'approved', reviewed_at = now()
     WHERE id = rec.submission_id AND status = 'pending';
    UPDATE public.reader_auto_approvals
       SET approved_at = now()
     WHERE submission_id = rec.submission_id;
    done := done + 1;
  END LOOP;

  PERFORM set_config('app.auto_approve', 'off', true);
  RETURN done;
END;
$run$;
ALTER FUNCTION ops_private.run_reader_auto_approvals() OWNER TO postgres;
REVOKE ALL ON FUNCTION ops_private.run_reader_auto_approvals() FROM PUBLIC, anon, authenticated;

-- ── 지금 대기 중인 사진: 믿을 수 있는 사람의 것은 지금부터 3시간 뒤로 예약한다 ──
-- 올린 시각 기준으로 잡으면 배포 직후 한꺼번에 승인되므로, 편집부가 볼 시간을 둔다.
INSERT INTO public.reader_auto_approvals(submission_id, user_id, due_at)
SELECT s.id, s.user_id, now() + interval '3 hours'
  FROM public.reader_submissions s
 WHERE s.status = 'pending' AND s.dup_of IS NULL
   AND public.reader_is_trusted(s.user_id)
   AND public.reader_film_in_catalog(s.film)
ON CONFLICT (submission_id) DO NOTHING;

-- ── 10분마다 ──
DO $install_cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;
END;
$install_cron$;

DO $schedule_auto_approve$
DECLARE
  stale_job bigint;
BEGIN
  IF pg_catalog.to_regclass('cron.job') IS NULL THEN
    RAISE WARNING 'READER AUTO-APPROVE NOT SCHEDULED: pg_cron unavailable. Enable Supabase Cron and replay 20261012000001_submissions_auto_approve.sql.';
    RETURN;
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'reader auto-approve schedule must be installed as postgres';
  END IF;
  FOR stale_job IN
    SELECT jobid FROM cron.job
    WHERE jobname = '5ftmag-reader-auto-approve' AND username <> 'postgres'
  LOOP
    PERFORM cron.unschedule(stale_job);
  END LOOP;
  PERFORM cron.schedule(
    '5ftmag-reader-auto-approve',
    '*/10 * * * *',
    'SET statement_timeout = ''2min''; SET lock_timeout = ''5s''; SELECT ops_private.run_reader_auto_approvals();'
  );
END;
$schedule_auto_approve$;

NOTIFY pgrst, 'reload schema';
