-- ──────────────────────────────────────────────────────────────
-- page_views 에 지역 단서 (tz, lang) 추가
--   tz   : IANA timezone 식별자 (예: Asia/Seoul, America/Los_Angeles)
--   lang : navigator.language (예: ko-KR, en-US)
--   IP 수집 없이도 timezone 으로 대략적 지역, lang 으로 사용자 환경 파악.
-- ──────────────────────────────────────────────────────────────

alter table public.page_views
  add column if not exists tz   text,
  add column if not exists lang text;

-- INSERT 정책 갱신 — 새 컬럼 길이 상한 포함
drop policy if exists "anon_insert_page_views" on public.page_views;

create policy "anon_insert_page_views"
  on public.page_views
  for insert
  to anon, authenticated
  with check (
        path is not null
    and char_length(path)       <=  500
    and (referrer   is null or char_length(referrer)   <= 1000)
    and (ua_family  is null or char_length(ua_family)  <=   32)
    and (session_id is null or char_length(session_id) <=   64)
    and (tz         is null or char_length(tz)         <=   64)
    and (lang       is null or char_length(lang)       <=   32)
  );

create index if not exists page_views_tz_idx   on public.page_views (tz);
create index if not exists page_views_lang_idx on public.page_views (lang);

-- ──────────────────────────────────────────────────────────────
-- 지역 집계 — timezone 별
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_regions(p_days int default 7, p_limit int default 20)
returns table (
  tz       text,
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
    select
      coalesce(nullif(pv.tz, ''), '(unknown)') as tz,
      count(*)::bigint,
      count(distinct pv.session_id)::bigint
    from public.page_views pv
    where pv.ts >= now() - (days_n::text || ' days')::interval
    group by 1
    order by 2 desc
    limit limit_n;
end;
$$;

revoke all on function public.admin_analytics_regions(int, int) from public;
grant execute on function public.admin_analytics_regions(int, int) to authenticated;

-- ──────────────────────────────────────────────────────────────
-- 언어 집계 — navigator.language 별
-- ──────────────────────────────────────────────────────────────
create or replace function public.admin_analytics_languages(p_days int default 7, p_limit int default 20)
returns table (
  lang     text,
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
    select
      coalesce(nullif(pv.lang, ''), '(unknown)') as lang,
      count(*)::bigint,
      count(distinct pv.session_id)::bigint
    from public.page_views pv
    where pv.ts >= now() - (days_n::text || ' days')::interval
    group by 1
    order by 2 desc
    limit limit_n;
end;
$$;

revoke all on function public.admin_analytics_languages(int, int) from public;
grant execute on function public.admin_analytics_languages(int, int) to authenticated;
