-- ──────────────────────────────────────────────────────────────
-- 독자 사진 업로드 통계 RPC (편집부 전용)
--   reader_submissions 테이블을 _analytics_assert_editor() 가드 뒤에서만 집계.
--   기존 page_views 통계 RPC 와 동일한 패턴.
-- ──────────────────────────────────────────────────────────────

-- 요약 — 오늘 / 7일 / 30일 / 누적 + 상태 분포 + 활동 작가 수
create or replace function public.admin_uploads_summary()
returns table (
  total_uploads          bigint,
  total_approved         bigint,
  total_pending          bigint,
  total_rejected         bigint,
  uploads_today          bigint,
  uploads_last_7d        bigint,
  uploads_last_30d       bigint,
  active_contributors_30d bigint,
  unique_contributors    bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._analytics_assert_editor();
  return query
    select
      count(*)::bigint,
      count(*) filter (where status = 'approved')::bigint,
      count(*) filter (where status = 'pending')::bigint,
      count(*) filter (where status = 'rejected')::bigint,
      count(*) filter (where created_at::date = current_date)::bigint,
      count(*) filter (where created_at >= now() - interval '7 days')::bigint,
      count(*) filter (where created_at >= now() - interval '30 days')::bigint,
      count(distinct coalesce(nullif(instagram, ''), submitter_name))
        filter (where created_at >= now() - interval '30 days')::bigint,
      count(distinct coalesce(nullif(instagram, ''), submitter_name))::bigint
    from public.reader_submissions;
end;
$$;

revoke all on function public.admin_uploads_summary() from public;
grant execute on function public.admin_uploads_summary() to authenticated;

-- 일별 업로드 (페이지뷰 차트와 같은 형태 — 빈 날은 0)
create or replace function public.admin_uploads_daily(p_days int default 30)
returns table (
  day      date,
  uploads  bigint,
  approved bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  days_n int := greatest(coalesce(p_days, 30), 1);
begin
  perform public._analytics_assert_editor();
  return query
    with d as (
      select generate_series(current_date - (days_n - 1), current_date, interval '1 day')::date as day
    ),
    v as (
      select created_at::date as day,
             count(*)::bigint as uploads,
             count(*) filter (where status = 'approved')::bigint as approved
      from public.reader_submissions
      where created_at >= current_date - (days_n - 1)
      group by created_at::date
    )
    select d.day,
           coalesce(v.uploads, 0)::bigint,
           coalesce(v.approved, 0)::bigint
    from d
    left join v using (day)
    order by d.day;
end;
$$;

revoke all on function public.admin_uploads_daily(int) from public;
grant execute on function public.admin_uploads_daily(int) to authenticated;

-- 상위 작가 — 인스타 핸들 우선, 없으면 submitter_name
create or replace function public.admin_uploads_top_contributors(p_days int default 30, p_limit int default 10)
returns table (
  contributor text,
  uploads     bigint,
  approved    bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  days_n  int := greatest(coalesce(p_days,  30), 1);
  limit_n int := greatest(coalesce(p_limit, 10), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select
      coalesce(nullif(trim(both '@' from instagram), ''), nullif(submitter_name, ''), '익명') as contributor,
      count(*)::bigint,
      count(*) filter (where status = 'approved')::bigint
    from public.reader_submissions
    where created_at >= now() - (days_n::text || ' days')::interval
    group by 1
    order by 2 desc
    limit limit_n;
end;
$$;

revoke all on function public.admin_uploads_top_contributors(int, int) from public;
grant execute on function public.admin_uploads_top_contributors(int, int) to authenticated;

-- 상위 필름
create or replace function public.admin_uploads_top_films(p_days int default 30, p_limit int default 10)
returns table (
  film     text,
  uploads  bigint,
  approved bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  days_n  int := greatest(coalesce(p_days,  30), 1);
  limit_n int := greatest(coalesce(p_limit, 10), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select
      film,
      count(*)::bigint,
      count(*) filter (where status = 'approved')::bigint
    from public.reader_submissions
    where created_at >= now() - (days_n::text || ' days')::interval
      and film is not null
      and film <> ''
    group by film
    order by 2 desc
    limit limit_n;
end;
$$;

revoke all on function public.admin_uploads_top_films(int, int) from public;
grant execute on function public.admin_uploads_top_films(int, int) to authenticated;

-- 상위 카메라
create or replace function public.admin_uploads_top_cameras(p_days int default 30, p_limit int default 10)
returns table (
  camera   text,
  uploads  bigint,
  approved bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  days_n  int := greatest(coalesce(p_days,  30), 1);
  limit_n int := greatest(coalesce(p_limit, 10), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select
      camera,
      count(*)::bigint,
      count(*) filter (where status = 'approved')::bigint
    from public.reader_submissions
    where created_at >= now() - (days_n::text || ' days')::interval
      and camera is not null
      and camera <> ''
    group by camera
    order by 2 desc
    limit limit_n;
end;
$$;

revoke all on function public.admin_uploads_top_cameras(int, int) from public;
grant execute on function public.admin_uploads_top_cameras(int, int) to authenticated;

-- 테마 응모 vs 일반 응모 비율
create or replace function public.admin_uploads_theme_ratio(p_days int default 30)
returns table (
  theme_count   bigint,
  general_count bigint,
  total         bigint,
  theme_ratio   numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  days_n int := greatest(coalesce(p_days, 30), 1);
begin
  perform public._analytics_assert_editor();
  return query
    with s as (
      select
        count(*) filter (where theme_month is not null)::bigint as theme_count,
        count(*) filter (where theme_month is null)::bigint     as general_count,
        count(*)::bigint                                         as total
      from public.reader_submissions
      where created_at >= now() - (days_n::text || ' days')::interval
    )
    select
      theme_count,
      general_count,
      total,
      case
        when total = 0 then 0::numeric
        else round((theme_count::numeric / total), 4)
      end as theme_ratio
    from s;
end;
$$;

revoke all on function public.admin_uploads_theme_ratio(int) from public;
grant execute on function public.admin_uploads_theme_ratio(int) to authenticated;
