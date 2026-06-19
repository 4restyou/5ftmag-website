-- Messages: 회원 ↔ 편집부 양방향 메시지
-- 논리 모델: 회원 1명 ↔ 편집부 (집단) = 1 스레드.
-- 편집부 어느 누구든 같은 user_id 의 스레드에 글을 쓸 수 있고, 회원은 자기 스레드만 본다.

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  from_editor boolean not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index messages_user_created_idx on public.messages (user_id, created_at desc);
create index messages_unread_user_idx on public.messages (user_id) where read_at is null and from_editor = true;
create index messages_unread_admin_idx on public.messages (user_id) where read_at is null and from_editor = false;

alter table public.messages enable row level security;

-- 회원: 자기 user_id row 만 select
create policy "messages_select_self" on public.messages
  for select using (auth.uid() = user_id);

-- 편집부: 모든 row select.
-- profiles 의 PK 가 user_id 이므로 (id 아님) where user_id = auth.uid() 패턴 사용.
create policy "messages_select_editor" on public.messages
  for select using (
    exists (select 1 from public.profiles where user_id = auth.uid() and is_editor = true)
  );

-- 회원: 자기 메시지만 insert (from_editor=false 강제)
create policy "messages_insert_self" on public.messages
  for insert with check (
    auth.uid() = user_id and from_editor = false
  );

-- 편집부: 누구든 user 에게 insert (from_editor=true 강제)
create policy "messages_insert_editor" on public.messages
  for insert with check (
    from_editor = true
    and exists (select 1 from public.profiles where user_id = auth.uid() and is_editor = true)
  );

-- read_at 업데이트는 RPC 로만 (column-level RLS 회피).
create or replace function public.mark_messages_read(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_editor boolean;
  v_count integer;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select coalesce(is_editor, false) into v_is_editor from public.profiles where user_id = v_uid;
  if v_uid = p_user_id then
    -- 회원이 자기 받은 메시지 (편집부가 보낸 것) 읽음 처리
    update public.messages set read_at = now()
      where user_id = p_user_id and from_editor = true and read_at is null;
    get diagnostics v_count = row_count;
    return v_count;
  elsif v_is_editor then
    -- 편집부가 회원이 보낸 메시지 읽음 처리
    update public.messages set read_at = now()
      where user_id = p_user_id and from_editor = false and read_at is null;
    get diagnostics v_count = row_count;
    return v_count;
  else
    raise exception 'not allowed';
  end if;
end $$;

grant execute on function public.mark_messages_read(uuid) to authenticated;

-- 편집부 인박스용 스레드 목록 (회원별 마지막 메시지 + 안읽음 카운트).
-- security_invoker 로 RLS 그대로 적용 → 편집부만 전체 보임.
create or replace view public.message_threads
with (security_invoker = true)
as
select
  m.user_id,
  p.display_name,
  p.avatar_url,
  max(m.created_at) as last_at,
  (select body from public.messages where user_id = m.user_id order by created_at desc limit 1) as last_body,
  (select from_editor from public.messages where user_id = m.user_id order by created_at desc limit 1) as last_from_editor,
  count(*) filter (where m.from_editor = false and m.read_at is null) as unread_for_admin,
  count(*) filter (where m.from_editor = true and m.read_at is null) as unread_for_user
from public.messages m
left join public.profiles_public p on p.user_id = m.user_id
group by m.user_id, p.display_name, p.avatar_url;

grant select on public.message_threads to authenticated;
