-- 글 목록에서 편집부에게 기사별 조회 수를 한 번에 보여 준다.
--   admin_story_views(slug) 와 같은 기준: 어제까지는 page_view_daily, 오늘은 page_views 원본.
--   한국어·영어·일본어판 경로(.html 유무 모두)를 slug 하나로 묶는다.
create or replace function public.admin_story_views_all()
returns table (slug text, views bigint, sessions bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._analytics_assert_editor();
  return query
    with t as (
      select d.path, d.views, d.sessions
        from public.page_view_daily d
       where d.day < current_date
         and d.path ~ '^/(en/|ja/)?stories/[a-z0-9][a-z0-9_-]*(\.html)?$'
      union all
      select pv.path, count(*)::bigint, count(distinct pv.session_id)::bigint
        from public.page_views pv
       where pv.ts::date >= current_date
         and pv.path ~ '^/(en/|ja/)?stories/[a-z0-9][a-z0-9_-]*(\.html)?$'
       group by pv.path
    )
    select regexp_replace(regexp_replace(t.path, '^/(en/|ja/)?stories/', ''), '\.html$', '') as s,
           sum(t.views)::bigint, sum(t.sessions)::bigint
      from t
     group by 1;
end;
$$;

revoke all on function public.admin_story_views_all() from public;
grant execute on function public.admin_story_views_all() to authenticated;
