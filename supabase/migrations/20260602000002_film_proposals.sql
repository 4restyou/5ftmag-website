-- 구독자 필름 신청 + 관리자 승인 워크플로우
-- 1) film_proposals 테이블 (신청 큐)
-- 2) RLS: 본인만 자기 신청 SELECT/INSERT, 편집부는 전체 SELECT/UPDATE/DELETE
-- 3) user_notifications.type 에 'proposal_approved', 'proposal_rejected' 추가
-- 4) 편집부에게도 신규 신청을 알리는 트리거(승인 큐를 빨리 보게)

create table if not exists public.film_proposals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  brand           text not null check (char_length(brand) between 1 and 60),
  name            text not null check (char_length(name) between 1 and 80),
  display_name    text check (display_name is null or char_length(display_name) <= 140),
  iso             text check (iso is null or char_length(iso) <= 20),
  type            text check (type is null or char_length(type) <= 40),
  format          text check (format is null or char_length(format) <= 40),
  description     text check (description is null or char_length(description) <= 1000),
  aliases         jsonb not null default '[]'::jsonb,
  status          text not null default 'pending'
                  check (status in ('pending','approved','rejected')),
  reviewer_notes  text check (reviewer_notes is null or char_length(reviewer_notes) <= 500),
  approved_slug   text,
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz
);

create index if not exists idx_film_proposals_status
  on public.film_proposals(status, created_at desc);
create index if not exists idx_film_proposals_user
  on public.film_proposals(user_id, created_at desc);

alter table public.film_proposals enable row level security;

-- 본인 SELECT
drop policy if exists "proposals_own_read" on public.film_proposals;
create policy "proposals_own_read" on public.film_proposals
  for select to authenticated
  using (user_id = auth.uid());

-- 본인 INSERT (status='pending' 강제, user_id=auth.uid())
drop policy if exists "proposals_self_insert" on public.film_proposals;
create policy "proposals_self_insert" on public.film_proposals
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

-- 편집부 전체 권한
drop policy if exists "proposals_editor_all" on public.film_proposals;
create policy "proposals_editor_all" on public.film_proposals
  for all to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.is_editor = true)
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.is_editor = true)
  );

-- ── user_notifications.type 에 신청 결과 통지 두 종 추가 ──
alter table public.user_notifications
  drop constraint if exists user_notifications_type_check;

alter table public.user_notifications
  add constraint user_notifications_type_check
  check (type in (
    'submission_approved',
    'submission_rejected',
    'submission_deleted',
    'submission_pending_editor',
    'listing_hidden',
    'listing_restored',
    'comment_reply',
    'proposal_approved',
    'proposal_rejected'
  ));
