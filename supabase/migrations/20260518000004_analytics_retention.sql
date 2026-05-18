-- ──────────────────────────────────────────────────────────────
-- Analytics retention cleanup
--   page_views 와 page_dwells 를 같은 보존 기간으로 정리.
--   기존 admin_analytics_purge 이름은 유지해서 운영 자동화가 생겨도 깨지지 않게 한다.
-- ──────────────────────────────────────────────────────────────

create or replace function public.admin_analytics_purge(p_keep_days int default 365)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  keep_n int := greatest(coalesce(p_keep_days, 365), 30);
  removed_views bigint := 0;
  removed_dwells bigint := 0;
begin
  perform public._analytics_assert_editor();

  delete from public.page_views
   where ts < now() - (keep_n::text || ' days')::interval;
  get diagnostics removed_views = row_count;

  delete from public.page_dwells
   where ts < now() - (keep_n::text || ' days')::interval;
  get diagnostics removed_dwells = row_count;

  return coalesce(removed_views, 0) + coalesce(removed_dwells, 0);
end;
$$;

revoke all on function public.admin_analytics_purge(int) from public;
grant execute on function public.admin_analytics_purge(int) to authenticated;

notify pgrst, 'reload schema';
