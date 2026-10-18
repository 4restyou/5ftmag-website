-- 기사 페이지에서 편집부에게만 보여 주는 조회 수.
--   한 기사의 한국어·영어·일본어판 경로(.html 유무 모두)를 합쳐 센다.
--   page_views 는 365일만 보관하므로 숫자도 최근 1년 기준이다.
--   다른 통계 RPC 와 같이 _analytics_assert_editor() 로 편집부만 통과시킨다.
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
    select count(*)::bigint,
           count(distinct pv.session_id)::bigint,
           min(pv.ts)::date
      from public.page_views pv
     where pv.path = any (paths);
end;
$$;

revoke all on function public.admin_story_views(text) from public;
grant execute on function public.admin_story_views(text) to authenticated;
