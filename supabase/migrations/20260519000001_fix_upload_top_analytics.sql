-- 상위 필름/카메라 업로드 통계 RPC 컬럼명 충돌 수정
-- returns table 의 film/camera 출력 컬럼명과 reader_submissions 의 실제 컬럼명이
-- plpgsql 내부에서 모호해질 수 있어 테이블 alias 로 명확히 지정한다.

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
      rs.film,
      count(*)::bigint,
      count(*) filter (where rs.status = 'approved')::bigint
    from public.reader_submissions rs
    where rs.created_at >= now() - (days_n::text || ' days')::interval
      and rs.film is not null
      and rs.film <> ''
    group by rs.film
    order by 2 desc
    limit limit_n;
end;
$$;

revoke all on function public.admin_uploads_top_films(int, int) from public;
grant execute on function public.admin_uploads_top_films(int, int) to authenticated;

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
      rs.camera,
      count(*)::bigint,
      count(*) filter (where rs.status = 'approved')::bigint
    from public.reader_submissions rs
    where rs.created_at >= now() - (days_n::text || ' days')::interval
      and rs.camera is not null
      and rs.camera <> ''
    group by rs.camera
    order by 2 desc
    limit limit_n;
end;
$$;

revoke all on function public.admin_uploads_top_cameras(int, int) from public;
grant execute on function public.admin_uploads_top_cameras(int, int) to authenticated;

create or replace function public.admin_uploads_top_films_all(p_limit int default 10)
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
  limit_n int := greatest(coalesce(p_limit, 10), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select
      rs.film,
      count(*)::bigint,
      count(*) filter (where rs.status = 'approved')::bigint
    from public.reader_submissions rs
    where rs.film is not null
      and rs.film <> ''
    group by rs.film
    order by 2 desc
    limit limit_n;
end;
$$;

revoke all on function public.admin_uploads_top_films_all(int) from public;
grant execute on function public.admin_uploads_top_films_all(int) to authenticated;

create or replace function public.admin_uploads_top_cameras_all(p_limit int default 10)
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
  limit_n int := greatest(coalesce(p_limit, 10), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select
      rs.camera,
      count(*)::bigint,
      count(*) filter (where rs.status = 'approved')::bigint
    from public.reader_submissions rs
    where rs.camera is not null
      and rs.camera <> ''
    group by rs.camera
    order by 2 desc
    limit limit_n;
end;
$$;

revoke all on function public.admin_uploads_top_cameras_all(int) from public;
grant execute on function public.admin_uploads_top_cameras_all(int) to authenticated;
