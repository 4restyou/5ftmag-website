-- 운영 화면에서 업로드 실패를 실제로 진단할 수 있도록 최신 상세 로그를 함께 돌려준다.
-- 기존 admin_client_errors_recent 는 유지하고, 새 클라이언트는 v2 를 우선 호출한다.

create or replace function public.admin_client_errors_recent_v2(p_hours int default 24, p_limit int default 20)
returns table (
  ts            timestamptz,
  first_ts      timestamptz,
  path          text,
  message       text,
  source        text,
  lineno        int,
  colno         int,
  details       text,
  ua_family     text,
  session_count bigint,
  occurrences   bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  hours_n int := greatest(coalesce(p_hours, 24), 1);
  limit_n int := greatest(coalesce(p_limit, 20), 1);
begin
  perform public._analytics_assert_editor();
  return query
    with recent as (
      select c.*
      from public.client_error_logs c
      where c.ts >= now() - (hours_n::text || ' hours')::interval
    ),
    grouped as (
      select
        max(r.ts) as ts,
        min(r.ts) as first_ts,
        r.path,
        r.message,
        r.source,
        r.lineno,
        r.colno,
        r.ua_family,
        count(distinct r.session_id)::bigint as session_count,
        count(*)::bigint as occurrences
      from recent r
      group by r.path, r.message, r.source, r.lineno, r.colno, r.ua_family
    ),
    latest as (
      select distinct on (r.path, r.message, r.source, r.lineno, r.colno, r.ua_family)
        r.path,
        r.message,
        r.source,
        r.lineno,
        r.colno,
        r.ua_family,
        r.stack as details
      from recent r
      order by r.path, r.message, r.source, r.lineno, r.colno, r.ua_family, r.ts desc, r.id desc
    )
    select
      g.ts,
      g.first_ts,
      g.path,
      g.message,
      g.source,
      g.lineno,
      g.colno,
      l.details,
      g.ua_family,
      g.session_count,
      g.occurrences
    from grouped g
    left join latest l
      on l.path = g.path
     and l.message = g.message
     and l.source is not distinct from g.source
     and l.lineno is not distinct from g.lineno
     and l.colno is not distinct from g.colno
     and l.ua_family is not distinct from g.ua_family
    order by g.ts desc
    limit limit_n;
end;
$$;

revoke all on function public.admin_client_errors_recent_v2(int, int) from public;
grant execute on function public.admin_client_errors_recent_v2(int, int) to authenticated;
