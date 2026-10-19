-- 기사별 성과와 요일·시간대 조회 — 편집부 통계 화면용.
--   1) page_dwells 에 depth(기사 본문을 스크롤해 본 최대 %, 0~100)를 더한다.
--      기사 페이지에서만 보내고 나머지 페이지는 NULL 이다. 옛 클라이언트도 NULL 로 그대로 쌓인다.
--   2) admin_story_performance: 기간 안의 기사별 조회·본 사람·언어별 조회·평균 체류·도달 표본.
--      조회는 admin_story_views_all 과 같은 기준(어제까지 page_view_daily, 오늘 page_views 원본),
--      날짜도 같이 ts::date(UTC) 로 나눈다. 체류·도달은 page_dwells 원본(365일 보관)에서 센다.
--   3) admin_analytics_heatmap: page_views 원본의 한국 시간 요일(0=일)·시간별 조회 수.
--      기간도 한국 날짜로 자른다.
-- 재실행해도 결과가 같다(add column if not exists, drop policy if exists, create or replace).

alter table public.page_dwells add column if not exists depth smallint;

-- 기존 조건(20260518000003)은 그대로 두고 depth 범위만 더한다.
drop policy if exists "anon_insert_page_dwells" on public.page_dwells;
create policy "anon_insert_page_dwells"
  on public.page_dwells
  for insert
  to anon, authenticated
  with check (
        path is not null
    and char_length(path) <= 500
    and (session_id is null or char_length(session_id) <= 64)
    and dwell_ms >= 0
    and dwell_ms <= 14400000   -- 4시간 상한 (탭 방치 cap)
    and (depth is null or depth between 0 and 100)
  );

create or replace function public.admin_story_performance(
  p_from date default null,
  p_to   date default null
)
returns table (
  slug          text,
  views         bigint,
  sessions      bigint,
  views_ko      bigint,
  views_en      bigint,
  views_ja      bigint,
  avg_dwell_ms  bigint,
  dwell_samples bigint,
  depth_samples bigint,
  reach_25      bigint,
  reach_50      bigint,
  reach_75      bigint,
  reach_100     bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  d_to date := coalesce(p_to, current_date);
begin
  perform public._analytics_assert_editor();
  return query
    with v as (
      select d.path, d.views, d.sessions
        from public.page_view_daily d
       where d.day < current_date
         and (p_from is null or d.day >= p_from)
         and d.day <= d_to
         and d.path ~ '^/(en/|ja/)?stories/[a-z0-9][a-z0-9_-]*(\.html)?$'
      union all
      select pv.path, count(*)::bigint, count(distinct pv.session_id)::bigint
        from public.page_views pv
       where pv.ts::date >= current_date
         and (p_from is null or pv.ts::date >= p_from)
         and pv.ts::date <= d_to
         and pv.path ~ '^/(en/|ja/)?stories/[a-z0-9][a-z0-9_-]*(\.html)?$'
       group by pv.path
    ),
    vs as (
      select regexp_replace(regexp_replace(v.path, '^/(en/|ja/)?stories/', ''), '\.html$', '') as s,
             sum(v.views)::bigint as views,
             sum(v.sessions)::bigint as sessions,
             coalesce(sum(v.views) filter (where v.path !~ '^/(en|ja)/'), 0)::bigint as views_ko,
             coalesce(sum(v.views) filter (where v.path like '/en/%'), 0)::bigint as views_en,
             coalesce(sum(v.views) filter (where v.path like '/ja/%'), 0)::bigint as views_ja
        from v
       group by 1
    ),
    ds as (
      select regexp_replace(regexp_replace(pd.path, '^/(en/|ja/)?stories/', ''), '\.html$', '') as s,
             round(avg(pd.dwell_ms))::bigint as avg_dwell_ms,
             count(*)::bigint as dwell_samples,
             count(pd.depth)::bigint as depth_samples,
             count(*) filter (where pd.depth >= 25)::bigint as reach_25,
             count(*) filter (where pd.depth >= 50)::bigint as reach_50,
             count(*) filter (where pd.depth >= 75)::bigint as reach_75,
             count(*) filter (where pd.depth >= 100)::bigint as reach_100
        from public.page_dwells pd
       where (p_from is null or pd.ts::date >= p_from)
         and pd.ts::date <= d_to
         and pd.path ~ '^/(en/|ja/)?stories/[a-z0-9][a-z0-9_-]*(\.html)?$'
       group by 1
    )
    select coalesce(vs.s, ds.s),
           coalesce(vs.views, 0)::bigint,
           coalesce(vs.sessions, 0)::bigint,
           coalesce(vs.views_ko, 0)::bigint,
           coalesce(vs.views_en, 0)::bigint,
           coalesce(vs.views_ja, 0)::bigint,
           coalesce(ds.avg_dwell_ms, 0)::bigint,
           coalesce(ds.dwell_samples, 0)::bigint,
           coalesce(ds.depth_samples, 0)::bigint,
           coalesce(ds.reach_25, 0)::bigint,
           coalesce(ds.reach_50, 0)::bigint,
           coalesce(ds.reach_75, 0)::bigint,
           coalesce(ds.reach_100, 0)::bigint
      from vs
      full outer join ds on ds.s = vs.s;
end;
$$;

revoke all on function public.admin_story_performance(date, date) from public;
grant execute on function public.admin_story_performance(date, date) to authenticated;

create or replace function public.admin_analytics_heatmap(
  p_from date default null,
  p_to   date default null
)
returns table (dow int, hour int, views bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  d_to date := coalesce(p_to, (now() at time zone 'Asia/Seoul')::date);
begin
  perform public._analytics_assert_editor();
  return query
    select extract(dow  from k.local_ts)::int,
           extract(hour from k.local_ts)::int,
           count(*)::bigint
      from (
        -- 한국 날짜 경계를 timestamptz 로 바꿔 ts 인덱스로 자른다.
        select pv.ts at time zone 'Asia/Seoul' as local_ts
          from public.page_views pv
         where (p_from is null or pv.ts >= (p_from::timestamp at time zone 'Asia/Seoul'))
           and pv.ts < ((d_to + 1)::timestamp at time zone 'Asia/Seoul')
      ) k
     group by 1, 2;
end;
$$;

revoke all on function public.admin_analytics_heatmap(date, date) from public;
grant execute on function public.admin_analytics_heatmap(date, date) to authenticated;
