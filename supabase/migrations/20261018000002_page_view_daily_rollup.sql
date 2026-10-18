-- 페이지뷰 날짜별 합계 — 영구 보관.
--   page_views 원본은 개인정보처리방침대로 365일 뒤 지운다(ops_private.purge_operational_logs).
--   여기에는 경로·날짜·숫자만 남기므로 개인을 알아볼 정보가 없고, 지우지 않는다.
--   매일 최근 7일을 다시 합산한다(같은 날을 다시 계산해도 결과가 같다). 하루이틀 작업이 빠져도
--   원본이 지워지기 전(365일)에 메워진다.
--   날짜는 다른 통계 RPC 와 같이 ts::date(UTC) 로 나눈다.
create table if not exists public.page_view_daily (
  path      text   not null,
  day       date   not null,
  views     bigint not null default 0,
  sessions  bigint not null default 0,
  primary key (path, day)
);

alter table public.page_view_daily enable row level security;
-- 정책 없음 → 직접 읽기·쓰기 모두 거부. 편집부는 SECURITY DEFINER RPC 로만 읽는다.

create schema if not exists ops_private authorization postgres;

create or replace function ops_private.rollup_page_views(p_from date, p_to date)
returns void
language plpgsql
security definer
set search_path = ''
as $rollup$
begin
  insert into public.page_view_daily (path, day, views, sessions)
  select pv.path, pv.ts::date, count(*)::bigint, count(distinct pv.session_id)::bigint
    from public.page_views pv
   where pv.ts::date between p_from and p_to
   group by pv.path, pv.ts::date
  on conflict (path, day) do update
    set views = excluded.views, sessions = excluded.sessions;
end;
$rollup$;

alter function ops_private.rollup_page_views(date, date) owner to postgres;
revoke all on function ops_private.rollup_page_views(date, date) from public, anon, authenticated;
grant execute on function ops_private.rollup_page_views(date, date) to service_role, postgres;

-- 지금 남아 있는 원본(최대 1년 치)을 한 번에 옮겨 담는다. 오늘은 아직 쌓이는 중이라 뺀다.
do $backfill$
declare
  d_from date;
begin
  select min(ts)::date into d_from from public.page_views;
  if d_from is not null and d_from < current_date then
    perform ops_private.rollup_page_views(d_from, current_date - 1);
  end if;
end;
$backfill$;

-- 기사 조회 수: 어제까지는 합계표, 오늘은 원본에서 센다.
create or replace function public.admin_story_views(p_slug text)
returns table (views bigint, sessions bigint, first_day date)
language plpgsql
security definer
set search_path = public
as $$
declare
  paths text[];
begin
  perform public._analytics_assert_editor();
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9_-]{0,99}$' then
    raise exception 'invalid slug' using errcode = '22023';
  end if;
  select array_agg(pre || 'stories/' || p_slug || suf)
    into paths
    from unnest(array['/', '/en/', '/ja/']) as pre,
         unnest(array['.html', '']) as suf;
  return query
    with t as (
      select d.views, d.sessions, d.day
        from public.page_view_daily d
       where d.path = any (paths) and d.day < current_date
      union all
      select count(*)::bigint, count(distinct pv.session_id)::bigint, min(pv.ts)::date
        from public.page_views pv
       where pv.path = any (paths) and pv.ts::date >= current_date
    )
    select coalesce(sum(t.views), 0)::bigint, coalesce(sum(t.sessions), 0)::bigint, min(t.day)
      from t;
end;
$$;

revoke all on function public.admin_story_views(text) from public;
grant execute on function public.admin_story_views(text) to authenticated;

-- 매일 02:47(UTC) 최근 7일을 다시 합산한다. 원본 정리(03:17)보다 앞선다.
do $schedule_rollup$
declare
  stale_job bigint;
begin
  if pg_catalog.to_regclass('cron.job') is null then
    raise warning 'PAGE VIEW ROLLUP NOT SCHEDULED: pg_cron unavailable. Enable Supabase Cron and replay 20261018000002_page_view_daily_rollup.sql.';
    return;
  end if;
  if current_user <> 'postgres' then
    raise exception 'page view rollup schedule must be installed as postgres';
  end if;
  for stale_job in
    select jobid from cron.job
    where jobname = '5ftmag-page-view-rollup-daily' and username <> 'postgres'
  loop
    perform cron.unschedule(stale_job);
  end loop;
  perform cron.schedule(
    '5ftmag-page-view-rollup-daily',
    '47 2 * * *',
    'SET statement_timeout = ''5min''; SELECT ops_private.rollup_page_views(current_date - 7, current_date - 1);'
  );
end;
$schedule_rollup$;
