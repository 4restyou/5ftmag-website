-- 통계 RPC 를 "지난 N일" 에서 "날짜 구간" 으로 바꾼다.
--
-- 지금까지 열세 개 함수가 p_days 정수 하나만 받아 current_date - N 으로 잘랐다.
-- 그래서 전체 기간을 볼 방법이 없었고(상위 필름·카메라만 _all 변형이 따로 있었다),
-- 원하는 날짜를 지정할 수도 없었다.
--
-- 새 시그니처는 p_from date, p_to date 다.
--   p_from 이 null 이면 하한 없음 = 전체 기간
--   p_to   가 null 이면 오늘까지
-- 7일·30일·90일 버튼은 프런트가 날짜 두 개를 계산해 넘긴다. 함수는 하나면 된다.
--
-- 옛 시그니처(int / int,int)는 지운다. 인자 타입이 달라서 그대로 두면 오버로드로
-- 남고, 프런트가 어느 쪽을 부르는지 헷갈린다.
--
-- 일별 두 함수는 빈 날을 0 으로 채운다. 전체 기간에서 하한이 없으면 시작점을
-- 첫 기록일로 잡는다. 그렇게 하지 않으면 생성 구간이 끝없이 늘어난다.

-- ──────────────────────────────────────────────────────────────
-- 옛 시그니처 제거 (replay-safe)
-- ──────────────────────────────────────────────────────────────
drop function if exists public.admin_analytics_daily(int);
drop function if exists public.admin_analytics_top_paths(int, int);
drop function if exists public.admin_analytics_referrers(int, int);
drop function if exists public.admin_analytics_regions(int, int);
drop function if exists public.admin_analytics_languages(int, int);
drop function if exists public.admin_analytics_dwell_summary(int);
drop function if exists public.admin_analytics_dwell_by_path(int, int);
drop function if exists public.admin_analytics_session_stats(int);
drop function if exists public.admin_uploads_daily(int);
drop function if exists public.admin_uploads_top_contributors(int, int);
drop function if exists public.admin_uploads_top_films(int, int);
drop function if exists public.admin_uploads_top_cameras(int, int);
drop function if exists public.admin_uploads_theme_ratio(int);

-- ──────────────────────────────────────────────────────────────
-- 1) 페이지뷰 일별
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_daily(
  p_from date default null,
  p_to   date default null
)
returns table (
  day      date,
  views    bigint,
  sessions bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  d_to   date := coalesce(p_to, current_date);
  d_from date := p_from;
begin
  perform public._analytics_assert_editor();
  if d_from is null then
    select min(ts)::date into d_from from public.page_views;
    d_from := coalesce(d_from, d_to);
  end if;
  if d_from > d_to then d_from := d_to; end if;
  return query
    with d as (
      select generate_series(d_from, d_to, interval '1 day')::date as day
    ),
    v as (
      select pv.ts::date as day,
             count(*)::bigint as views,
             count(distinct pv.session_id)::bigint as sessions
      from public.page_views pv
      where pv.ts::date between d_from and d_to
      group by pv.ts::date
    )
    select d.day, coalesce(v.views, 0)::bigint, coalesce(v.sessions, 0)::bigint
    from d left join v using (day)
    order by d.day;
end;
$$;
revoke all on function public.admin_analytics_daily(date, date) from public;
grant execute on function public.admin_analytics_daily(date, date) to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 2) 상위 경로
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_top_paths(
  p_from date default null, p_to date default null, p_limit int default 20
)
returns table (path text, views bigint, sessions bigint)
language plpgsql security definer set search_path = public
as $$
declare
  d_to date := coalesce(p_to, current_date);
  limit_n int := greatest(coalesce(p_limit, 20), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select pv.path, count(*)::bigint, count(distinct pv.session_id)::bigint
    from public.page_views pv
    where (p_from is null or pv.ts::date >= p_from) and pv.ts::date <= d_to
    group by pv.path
    order by 2 desc
    limit limit_n;
end;
$$;
revoke all on function public.admin_analytics_top_paths(date, date, int) from public;
grant execute on function public.admin_analytics_top_paths(date, date, int) to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 3) 유입 경로
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_referrers(
  p_from date default null, p_to date default null, p_limit int default 20
)
returns table (referrer_domain text, views bigint)
language plpgsql security definer set search_path = public
as $$
declare
  d_to date := coalesce(p_to, current_date);
  limit_n int := greatest(coalesce(p_limit, 20), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select
      case
        when pv.referrer is null or pv.referrer = '' then '(direct)'
        when pv.referrer ~ '^https?://' then regexp_replace(pv.referrer, '^https?://([^/?#]+).*$', '\1')
        else pv.referrer
      end as referrer_domain,
      count(*)::bigint
    from public.page_views pv
    where (p_from is null or pv.ts::date >= p_from) and pv.ts::date <= d_to
    group by referrer_domain
    order by 2 desc
    limit limit_n;
end;
$$;
revoke all on function public.admin_analytics_referrers(date, date, int) from public;
grant execute on function public.admin_analytics_referrers(date, date, int) to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 4) 지역 / 5) 언어
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_regions(
  p_from date default null, p_to date default null, p_limit int default 20
)
returns table (tz text, views bigint, sessions bigint)
language plpgsql security definer set search_path = public
as $$
declare
  d_to date := coalesce(p_to, current_date);
  limit_n int := greatest(coalesce(p_limit, 20), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select coalesce(nullif(pv.tz, ''), '(unknown)') as tz,
           count(*)::bigint, count(distinct pv.session_id)::bigint
    from public.page_views pv
    where (p_from is null or pv.ts::date >= p_from) and pv.ts::date <= d_to
    group by 1 order by 2 desc limit limit_n;
end;
$$;
revoke all on function public.admin_analytics_regions(date, date, int) from public;
grant execute on function public.admin_analytics_regions(date, date, int) to authenticated;

create or replace function public.admin_analytics_languages(
  p_from date default null, p_to date default null, p_limit int default 20
)
returns table (lang text, views bigint, sessions bigint)
language plpgsql security definer set search_path = public
as $$
declare
  d_to date := coalesce(p_to, current_date);
  limit_n int := greatest(coalesce(p_limit, 20), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select coalesce(nullif(pv.lang, ''), '(unknown)') as lang,
           count(*)::bigint, count(distinct pv.session_id)::bigint
    from public.page_views pv
    where (p_from is null or pv.ts::date >= p_from) and pv.ts::date <= d_to
    group by 1 order by 2 desc limit limit_n;
end;
$$;
revoke all on function public.admin_analytics_languages(date, date, int) from public;
grant execute on function public.admin_analytics_languages(date, date, int) to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 6) 체류시간
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_dwell_summary(
  p_from date default null, p_to date default null
)
returns table (avg_ms bigint, median_ms bigint, samples bigint)
language plpgsql security definer set search_path = public
as $$
declare d_to date := coalesce(p_to, current_date);
begin
  perform public._analytics_assert_editor();
  return query
    select
      coalesce(round(avg(pd.dwell_ms))::bigint, 0),
      coalesce(percentile_cont(0.5) within group (order by pd.dwell_ms)::bigint, 0),
      count(*)::bigint
    from public.page_dwells pd
    where (p_from is null or pd.ts::date >= p_from) and pd.ts::date <= d_to;
end;
$$;
revoke all on function public.admin_analytics_dwell_summary(date, date) from public;
grant execute on function public.admin_analytics_dwell_summary(date, date) to authenticated;

create or replace function public.admin_analytics_dwell_by_path(
  p_from date default null, p_to date default null, p_limit int default 10
)
returns table (path text, avg_ms bigint, samples bigint)
language plpgsql security definer set search_path = public
as $$
declare
  d_to date := coalesce(p_to, current_date);
  limit_n int := greatest(coalesce(p_limit, 10), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select pd.path, coalesce(round(avg(pd.dwell_ms))::bigint, 0), count(*)::bigint
    from public.page_dwells pd
    where (p_from is null or pd.ts::date >= p_from) and pd.ts::date <= d_to
    group by pd.path
    having count(*) >= 3
    order by avg(pd.dwell_ms) desc
    limit limit_n;
end;
$$;
revoke all on function public.admin_analytics_dwell_by_path(date, date, int) from public;
grant execute on function public.admin_analytics_dwell_by_path(date, date, int) to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 7) 세션 통계
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_session_stats(
  p_from date default null, p_to date default null
)
returns table (sessions bigint, avg_pages numeric, avg_duration_ms bigint, bounce_rate numeric)
language plpgsql security definer set search_path = public
as $$
declare d_to date := coalesce(p_to, current_date);
begin
  perform public._analytics_assert_editor();
  return query
    with s as (
      select pv.session_id,
             count(*)::int as pages,
             extract(epoch from (max(pv.ts) - min(pv.ts))) * 1000 as ms
      from public.page_views pv
      where (p_from is null or pv.ts::date >= p_from) and pv.ts::date <= d_to
        and pv.session_id is not null
      group by pv.session_id
    )
    select
      count(*)::bigint,
      coalesce(round(avg(pages)::numeric, 2), 0),
      coalesce(round(avg(ms))::bigint, 0),
      case when count(*) = 0 then 0::numeric
           else round((sum(case when pages = 1 then 1 else 0 end)::numeric / count(*)), 4) end
    from s;
end;
$$;
revoke all on function public.admin_analytics_session_stats(date, date) from public;
grant execute on function public.admin_analytics_session_stats(date, date) to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 8) 투고 일별
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_uploads_daily(
  p_from date default null, p_to date default null
)
returns table (day date, uploads bigint, approved bigint)
language plpgsql security definer set search_path = public
as $$
declare
  d_to   date := coalesce(p_to, current_date);
  d_from date := p_from;
begin
  perform public._analytics_assert_editor();
  if d_from is null then
    select min(created_at)::date into d_from from public.reader_submissions;
    d_from := coalesce(d_from, d_to);
  end if;
  if d_from > d_to then d_from := d_to; end if;
  return query
    with d as (
      select generate_series(d_from, d_to, interval '1 day')::date as day
    ),
    v as (
      select rs.created_at::date as day,
             count(*)::bigint as uploads,
             count(*) filter (where rs.status = 'approved')::bigint as approved
      from public.reader_submissions rs
      where rs.created_at::date between d_from and d_to
      group by rs.created_at::date
    )
    select d.day, coalesce(v.uploads, 0)::bigint, coalesce(v.approved, 0)::bigint
    from d left join v using (day)
    order by d.day;
end;
$$;
revoke all on function public.admin_uploads_daily(date, date) from public;
grant execute on function public.admin_uploads_daily(date, date) to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 9) 상위 기여자 / 10) 상위 필름 / 11) 상위 카메라
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_uploads_top_contributors(
  p_from date default null, p_to date default null, p_limit int default 10
)
returns table (contributor text, uploads bigint, approved bigint)
language plpgsql security definer set search_path = public
as $$
declare
  d_to date := coalesce(p_to, current_date);
  limit_n int := greatest(coalesce(p_limit, 10), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select
      coalesce(nullif(trim(both '@' from rs.instagram), ''), nullif(rs.submitter_name, ''), '익명') as contributor,
      count(*)::bigint,
      count(*) filter (where rs.status = 'approved')::bigint
    from public.reader_submissions rs
    where (p_from is null or rs.created_at::date >= p_from) and rs.created_at::date <= d_to
    group by 1 order by 2 desc limit limit_n;
end;
$$;
revoke all on function public.admin_uploads_top_contributors(date, date, int) from public;
grant execute on function public.admin_uploads_top_contributors(date, date, int) to authenticated;

create or replace function public.admin_uploads_top_films(
  p_from date default null, p_to date default null, p_limit int default 10
)
returns table (film text, uploads bigint, approved bigint)
language plpgsql security definer set search_path = public
as $$
declare
  d_to date := coalesce(p_to, current_date);
  limit_n int := greatest(coalesce(p_limit, 10), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select rs.film, count(*)::bigint, count(*) filter (where rs.status = 'approved')::bigint
    from public.reader_submissions rs
    where (p_from is null or rs.created_at::date >= p_from) and rs.created_at::date <= d_to
      and rs.film is not null and rs.film <> ''
    group by rs.film order by 2 desc limit limit_n;
end;
$$;
revoke all on function public.admin_uploads_top_films(date, date, int) from public;
grant execute on function public.admin_uploads_top_films(date, date, int) to authenticated;

create or replace function public.admin_uploads_top_cameras(
  p_from date default null, p_to date default null, p_limit int default 10
)
returns table (camera text, uploads bigint, approved bigint)
language plpgsql security definer set search_path = public
as $$
declare
  d_to date := coalesce(p_to, current_date);
  limit_n int := greatest(coalesce(p_limit, 10), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select rs.camera, count(*)::bigint, count(*) filter (where rs.status = 'approved')::bigint
    from public.reader_submissions rs
    where (p_from is null or rs.created_at::date >= p_from) and rs.created_at::date <= d_to
      and rs.camera is not null and rs.camera <> ''
    group by rs.camera order by 2 desc limit limit_n;
end;
$$;
revoke all on function public.admin_uploads_top_cameras(date, date, int) from public;
grant execute on function public.admin_uploads_top_cameras(date, date, int) to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 12) 테마 비율
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_uploads_theme_ratio(
  p_from date default null, p_to date default null
)
returns table (theme_count bigint, general_count bigint, total bigint, theme_ratio numeric)
language plpgsql security definer set search_path = public
as $$
declare d_to date := coalesce(p_to, current_date);
begin
  perform public._analytics_assert_editor();
  return query
    with s as (
      select
        count(*) filter (where rs.theme_month is not null)::bigint as theme_count,
        count(*) filter (where rs.theme_month is null)::bigint     as general_count,
        count(*)::bigint                                            as total
      from public.reader_submissions rs
      where (p_from is null or rs.created_at::date >= p_from) and rs.created_at::date <= d_to
    )
    select s.theme_count, s.general_count, s.total,
           case when s.total = 0 then 0::numeric
                else round(s.theme_count::numeric / s.total, 4) end
    from s;
end;
$$;
revoke all on function public.admin_uploads_theme_ratio(date, date) from public;
grant execute on function public.admin_uploads_theme_ratio(date, date) to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 13) 첫 기록일. "전체" 라벨에 실제 시작일을 적기 위해 필요하다.
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_first_day()
returns table (views_from date, uploads_from date)
language plpgsql security definer set search_path = public
as $$
begin
  perform public._analytics_assert_editor();
  return query
    select (select min(ts)::date from public.page_views),
           (select min(created_at)::date from public.reader_submissions);
end;
$$;
revoke all on function public.admin_analytics_first_day() from public;
grant execute on function public.admin_analytics_first_day() to authenticated;
