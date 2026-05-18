-- ──────────────────────────────────────────────────────────────
-- page_views — 자가호스트 페이지뷰 로그
--   anon 도 INSERT 만 가능. SELECT 는 SECURITY DEFINER RPC 로만 허용.
--   각 RPC 는 caller 의 profiles.is_editor 검사 → 편집부만 통계 열람.
-- ──────────────────────────────────────────────────────────────

create table if not exists public.page_views (
  id          bigserial primary key,
  path        text not null,
  ts          timestamptz not null default now(),
  session_id  text,
  referrer    text,
  ua_family   text
);

create index if not exists page_views_ts_idx        on public.page_views (ts desc);
create index if not exists page_views_path_ts_idx   on public.page_views (path, ts desc);
create index if not exists page_views_session_idx   on public.page_views (session_id, ts);

alter table public.page_views enable row level security;

drop policy if exists "anon_insert_page_views" on public.page_views;
drop policy if exists "no_select_page_views"   on public.page_views;

-- 익명/로그인 사용자 모두 자기 페이지뷰 한 줄 INSERT 가능
-- with check 로 컬럼 길이 상한 — 악성 trash 차단
create policy "anon_insert_page_views"
  on public.page_views
  for insert
  to anon, authenticated
  with check (
        path is not null
    and char_length(path)       <=  500
    and (referrer  is null or char_length(referrer)  <= 1000)
    and (ua_family is null or char_length(ua_family) <=   32)
    and (session_id is null or char_length(session_id) <= 64)
  );

-- 누구도 직접 SELECT 못함 (정책 없음 → 기본 거부)

-- ──────────────────────────────────────────────────────────────
-- editor 가드 — 모든 통계 RPC 의 첫 줄에서 호출
-- ──────────────────────────────────────────────────────────────
create or replace function public._analytics_assert_editor()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where user_id = auth.uid() and is_editor = true
  ) then
    raise exception 'editor only' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public._analytics_assert_editor() from public;
grant execute on function public._analytics_assert_editor() to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 1) 전체 요약 (오늘 / 어제 / 7일 / 30일 / 전체)
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_summary()
returns table (
  total_views      bigint,
  total_sessions   bigint,
  views_today      bigint,
  views_yesterday  bigint,
  views_last_7d    bigint,
  views_last_30d   bigint,
  sessions_last_30d bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._analytics_assert_editor();
  return query
    select
      count(*)::bigint,
      count(distinct session_id)::bigint,
      count(*) filter (where ts::date = current_date)::bigint,
      count(*) filter (where ts::date = current_date - 1)::bigint,
      count(*) filter (where ts >= now() - interval '7 days')::bigint,
      count(*) filter (where ts >= now() - interval '30 days')::bigint,
      count(distinct session_id) filter (where ts >= now() - interval '30 days')::bigint
    from public.page_views;
end;
$$;

revoke all on function public.admin_analytics_summary() from public;
grant execute on function public.admin_analytics_summary() to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 2) 일별 (지난 N일치 — 빈 날도 0 으로 채움)
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_daily(p_days int default 30)
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
  days_n int := greatest(coalesce(p_days, 30), 1);
begin
  perform public._analytics_assert_editor();
  return query
    with d as (
      select generate_series(current_date - (days_n - 1), current_date, interval '1 day')::date as day
    ),
    v as (
      select ts::date as day,
             count(*)::bigint as views,
             count(distinct session_id)::bigint as sessions
      from public.page_views
      where ts >= current_date - (days_n - 1)
      group by ts::date
    )
    select d.day,
           coalesce(v.views, 0)::bigint,
           coalesce(v.sessions, 0)::bigint
    from d
    left join v using (day)
    order by d.day;
end;
$$;

revoke all on function public.admin_analytics_daily(int) from public;
grant execute on function public.admin_analytics_daily(int) to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 3) 상위 경로
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_top_paths(p_days int default 7, p_limit int default 20)
returns table (
  path     text,
  views    bigint,
  sessions bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  days_n  int := greatest(coalesce(p_days,  7), 1);
  limit_n int := greatest(coalesce(p_limit, 20), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select pv.path,
           count(*)::bigint,
           count(distinct pv.session_id)::bigint
    from public.page_views pv
    where pv.ts >= now() - (days_n::text || ' days')::interval
    group by pv.path
    order by 2 desc
    limit limit_n;
end;
$$;

revoke all on function public.admin_analytics_top_paths(int, int) from public;
grant execute on function public.admin_analytics_top_paths(int, int) to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 4) 유입 도메인 (referrer 호스트만)
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_referrers(p_days int default 7, p_limit int default 20)
returns table (
  referrer_domain text,
  views           bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  days_n  int := greatest(coalesce(p_days,  7), 1);
  limit_n int := greatest(coalesce(p_limit, 20), 1);
begin
  perform public._analytics_assert_editor();
  return query
    select
      case
        when pv.referrer is null or pv.referrer = '' then '(direct)'
        when pv.referrer ~ '^https?://' then
          regexp_replace(pv.referrer, '^https?://([^/?#]+).*$', '\1')
        else pv.referrer
      end as referrer_domain,
      count(*)::bigint
    from public.page_views pv
    where pv.ts >= now() - (days_n::text || ' days')::interval
    group by referrer_domain
    order by 2 desc
    limit limit_n;
end;
$$;

revoke all on function public.admin_analytics_referrers(int, int) from public;
grant execute on function public.admin_analytics_referrers(int, int) to authenticated;

-- ──────────────────────────────────────────────────────────────
-- (편의) 90일 지나면 자동 정리 — 운영 부담 줄이려면 cron 으로 호출
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_purge(p_keep_days int default 365)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  keep_n int := greatest(coalesce(p_keep_days, 365), 30);
  removed bigint;
begin
  perform public._analytics_assert_editor();
  delete from public.page_views
   where ts < now() - (keep_n::text || ' days')::interval;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.admin_analytics_purge(int) from public;
grant execute on function public.admin_analytics_purge(int) to authenticated;
