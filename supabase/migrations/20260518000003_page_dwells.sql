-- ──────────────────────────────────────────────────────────────
-- page_dwells — 페이지 체류 시간 (foreground 누적 ms)
--   페이지 떠나는 시점에 클라이언트가 한 번 INSERT.
--   기존 page_views 와 별도 row — UPDATE 없이 RLS anon INSERT only 유지.
-- ──────────────────────────────────────────────────────────────

create table if not exists public.page_dwells (
  id          bigserial primary key,
  path        text not null,
  ts          timestamptz not null default now(),
  session_id  text,
  dwell_ms    integer not null
);

create index if not exists page_dwells_ts_idx        on public.page_dwells (ts desc);
create index if not exists page_dwells_path_ts_idx   on public.page_dwells (path, ts desc);
create index if not exists page_dwells_session_idx   on public.page_dwells (session_id);

alter table public.page_dwells enable row level security;

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
  );

-- ──────────────────────────────────────────────────────────────
-- 사이트 평균 체류 시간 — page_dwells 기반
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_dwell_summary(p_days int default 30)
returns table (
  avg_ms     bigint,
  median_ms  bigint,
  samples    bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  days_n int := greatest(coalesce(p_days, 30), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select
      coalesce(round(avg(dwell_ms))::bigint, 0),
      coalesce(percentile_cont(0.5) within group (order by dwell_ms)::bigint, 0),
      count(*)::bigint
    from public.page_dwells
    where ts >= now() - (days_n::text || ' days')::interval;
end;
$$;

revoke all on function public.admin_analytics_dwell_summary(int) from public;
grant execute on function public.admin_analytics_dwell_summary(int) to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 페이지별 평균 체류 시간
--   표본 3건 이상인 경로만 — 한두 명 데이터로 들쭉날쭉한 평균 가림
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_dwell_by_path(p_days int default 7, p_limit int default 10)
returns table (
  path    text,
  avg_ms  bigint,
  samples bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  days_n  int := greatest(coalesce(p_days,  7), 1);
  limit_n int := greatest(coalesce(p_limit, 10), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select
      pd.path,
      coalesce(round(avg(pd.dwell_ms))::bigint, 0),
      count(*)::bigint
    from public.page_dwells pd
    where pd.ts >= now() - (days_n::text || ' days')::interval
    group by pd.path
    having count(*) >= 3
    order by avg(pd.dwell_ms) desc
    limit limit_n;
end;
$$;

revoke all on function public.admin_analytics_dwell_by_path(int, int) from public;
grant execute on function public.admin_analytics_dwell_by_path(int, int) to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 세션 통계 — 기존 page_views 만으로 즉시 계산
--   같은 session_id 의 첫뷰~마지막뷰 차이가 세션 길이.
--   한 페이지만 본 세션은 길이 0 으로 잡힘 (bounce_rate 별도 노출).
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_session_stats(p_days int default 30)
returns table (
  sessions         bigint,
  avg_pages        numeric,
  avg_duration_ms  bigint,
  bounce_rate      numeric  -- 0..1, 한 페이지만 본 세션 비율
)
language plpgsql
security definer
set search_path = public
as $$
declare
  days_n int := greatest(coalesce(p_days, 30), 1);
begin
  perform public._analytics_assert_editor();
  return query
    with s as (
      select session_id,
             count(*)::int as pages,
             extract(epoch from (max(ts) - min(ts))) * 1000 as ms
      from public.page_views
      where ts >= now() - (days_n::text || ' days')::interval
        and session_id is not null
      group by session_id
    )
    select
      count(*)::bigint,
      coalesce(round(avg(pages)::numeric, 2), 0),
      coalesce(round(avg(ms))::bigint, 0),
      case
        when count(*) = 0 then 0::numeric
        else round((sum(case when pages = 1 then 1 else 0 end)::numeric / count(*)), 4)
      end
    from s;
end;
$$;

revoke all on function public.admin_analytics_session_stats(int) from public;
grant execute on function public.admin_analytics_session_stats(int) to authenticated;
