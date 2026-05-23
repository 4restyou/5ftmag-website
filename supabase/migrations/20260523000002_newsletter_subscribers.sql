-- 뉴스레터 구독자 — 이메일만 수집 (발송 서비스 연동은 추후)
create table if not exists public.newsletter_subscribers (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  source     text not null default 'home',
  created_at timestamptz not null default now(),
  constraint newsletter_email_len check (char_length(email) <= 200)
);

alter table public.newsletter_subscribers enable row level security;

-- 구독(insert)은 익명 포함 누구나 가능.
-- select/update/delete 정책은 두지 않음 → service_role(운영자) 만 열람·관리.
drop policy if exists "newsletter_anyone_subscribe" on public.newsletter_subscribers;
create policy "newsletter_anyone_subscribe"
  on public.newsletter_subscribers
  for insert
  to anon, authenticated
  with check (true);
