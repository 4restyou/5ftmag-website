-- 클라이언트 JS 에러 로그
-- Sentry DSN 이 없어도 운영자가 최근 브라우저 오류를 확인할 수 있게 최소 정보만 저장한다.

create table if not exists public.client_error_logs (
  id          bigserial primary key,
  ts          timestamptz not null default now(),
  path        text not null,
  message     text not null,
  source      text,
  lineno      int,
  colno       int,
  stack       text,
  ua_family   text,
  session_id  text
);

create index if not exists client_error_logs_ts_idx on public.client_error_logs (ts desc);
create index if not exists client_error_logs_path_ts_idx on public.client_error_logs (path, ts desc);

alter table public.client_error_logs enable row level security;

drop policy if exists "anon_insert_client_error_logs" on public.client_error_logs;

create policy "anon_insert_client_error_logs"
  on public.client_error_logs
  for insert
  to anon, authenticated
  with check (
        path is not null
    and message is not null
    and char_length(path) <= 500
    and char_length(message) <= 1000
    and (source is null or char_length(source) <= 500)
    and (stack is null or char_length(stack) <= 4000)
    and (ua_family is null or char_length(ua_family) <= 32)
    and (session_id is null or char_length(session_id) <= 64)
  );

create or replace function public.admin_client_errors_recent(p_hours int default 24, p_limit int default 20)
returns table (
  ts         timestamptz,
  path       text,
  message    text,
  source     text,
  lineno     int,
  colno      int,
  ua_family  text,
  occurrences bigint
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
    select
      max(c.ts) as ts,
      c.path,
      c.message,
      c.source,
      c.lineno,
      c.colno,
      c.ua_family,
      count(*)::bigint as occurrences
    from public.client_error_logs c
    where c.ts >= now() - (hours_n::text || ' hours')::interval
    group by c.path, c.message, c.source, c.lineno, c.colno, c.ua_family
    order by max(c.ts) desc
    limit limit_n;
end;
$$;

revoke all on function public.admin_client_errors_recent(int, int) from public;
grant execute on function public.admin_client_errors_recent(int, int) to authenticated;

create or replace function public.admin_client_errors_purge(p_keep_days int default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  perform public._analytics_assert_editor();
  delete from public.client_error_logs
  where ts < now() - (greatest(coalesce(p_keep_days, 30), 1)::text || ' days')::interval;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.admin_client_errors_purge(int) from public;
grant execute on function public.admin_client_errors_purge(int) to authenticated;
