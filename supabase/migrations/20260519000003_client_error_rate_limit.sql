-- 클라이언트 에러 로그 하드닝
-- 1) 분당 session 당 5건 초과 INSERT 는 BEFORE INSERT trigger 가 silently drop.
--    클라이언트는 이미 페이지당 5건 가드가 있지만, anon 키로 직접 REST 를 두드리는
--    봇/스크립트 대비 서버측 가드를 한 겹 더 둔다.
-- 2) pg_cron 이 없는 환경을 가정해 자동 정리는 다음 단계로 미루고, admin UI 에서
--    수동 호출하는 admin_client_errors_purge 만 유지한다.

create or replace function public._client_error_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bucket text := coalesce(new.session_id, '__none__');
  recent_count int;
begin
  select count(*) into recent_count
    from public.client_error_logs
    where coalesce(session_id, '__none__') = bucket
      and ts > now() - interval '1 minute';

  if recent_count >= 5 then
    -- silently drop. 클라이언트에는 에러를 던지지 않는다.
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists client_error_rate_limit on public.client_error_logs;
create trigger client_error_rate_limit
  before insert on public.client_error_logs
  for each row
  execute function public._client_error_rate_limit();

revoke all on function public._client_error_rate_limit() from public;
