-- 상위 필름 · 카메라 전체 누적 집계
-- 기존 admin_uploads_top_films / admin_uploads_top_cameras 는 created_at 기준
-- 기간 필터(7/30/90일)를 사용. 누적(전체 기간) 집계도 함께 노출하기 위한
-- 별도 함수 추가.

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
      film,
      count(*)::bigint,
      count(*) filter (where status = 'approved')::bigint
    from public.reader_submissions
    where film is not null
      and film <> ''
    group by film
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
      camera,
      count(*)::bigint,
      count(*) filter (where status = 'approved')::bigint
    from public.reader_submissions
    where camera is not null
      and camera <> ''
    group by camera
    order by 2 desc
    limit limit_n;
end;
$$;

revoke all on function public.admin_uploads_top_cameras_all(int) from public;
grant execute on function public.admin_uploads_top_cameras_all(int) to authenticated;
