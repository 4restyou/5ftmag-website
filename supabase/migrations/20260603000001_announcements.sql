-- 사이트 상단 공지 배너
-- 헤더 바로 아래 띠로 노출. 클라이언트가 가장 최근 활성(시간 범위 내) 1개만 표시.
-- 사용자가 닫기 누르면 localStorage 에 ID 저장 → 그 사용자 한정 다시 안 뜸.
-- 동시에 여러 공지 등록 가능(예약 포함). 표시는 created_at desc 의 첫 항목.

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(body) between 1 and 500),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null
);

create index if not exists idx_announcements_window
  on public.announcements (starts_at desc)
  where is_active;

alter table public.announcements enable row level security;

-- 익명/로그인 사용자: 활성 + 현재 시간 범위 내 행만 SELECT
drop policy if exists "announcements public read" on public.announcements;
create policy "announcements public read" on public.announcements
  for select
  using (
    is_active
    and (starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );

-- 편집부: 모든 권한
drop policy if exists "announcements editor all" on public.announcements;
create policy "announcements editor all" on public.announcements
  for all
  using (exists (
    select 1 from public.profiles
    where user_id = auth.uid() and is_editor = true
  ))
  with check (exists (
    select 1 from public.profiles
    where user_id = auth.uid() and is_editor = true
  ));

NOTIFY pgrst, 'reload schema';
