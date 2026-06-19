-- Messages 수정·삭제 기능
-- 수정: 본인 메시지만 (회원은 자기 메시지, 편집부는 편집부 발신 메시지)
-- 삭제: 편집부만 (모더레이션). soft delete (deleted_at 표시).

alter table public.messages
  add column edited_at timestamptz,
  add column deleted_at timestamptz;

-- 본인 메시지 수정 RPC
create or replace function public.edit_message(p_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.messages%rowtype;
  v_clean text := trim(coalesce(p_body, ''));
  v_is_editor boolean;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  if char_length(v_clean) < 1 or char_length(v_clean) > 2000 then
    raise exception 'invalid body';
  end if;
  select * into v_row from public.messages where id = p_id;
  if not found then raise exception 'not found'; end if;
  if v_row.deleted_at is not null then raise exception 'deleted'; end if;

  -- 회원이 보낸 메시지: 보낸 user_id = caller
  -- 편집부가 보낸 메시지: caller 가 편집부
  if v_row.from_editor = false then
    if v_row.user_id <> v_uid then raise exception 'not allowed'; end if;
  else
    select coalesce(is_editor, false) into v_is_editor from public.profiles where user_id = v_uid;
    if not v_is_editor then raise exception 'not allowed'; end if;
  end if;

  update public.messages set body = v_clean, edited_at = now() where id = p_id;
end $$;

grant execute on function public.edit_message(uuid, text) to authenticated;

-- 편집부 전용 soft delete RPC
create or replace function public.delete_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_editor boolean;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select coalesce(is_editor, false) into v_is_editor from public.profiles where user_id = v_uid;
  if not v_is_editor then raise exception 'editor only'; end if;
  update public.messages set deleted_at = now() where id = p_id and deleted_at is null;
end $$;

grant execute on function public.delete_message(uuid) to authenticated;

-- message_threads view 재생성 — 삭제된 메시지는 last_body / last_at 계산에서 제외하면
-- 인박스가 깔끔. 대신 unread 카운트는 그대로 (이미 안 읽은 건 그대로 표기).
create or replace view public.message_threads
with (security_invoker = true)
as
select
  m.user_id,
  p.display_name,
  p.avatar_url,
  max(m.created_at) as last_at,
  (
    select body from public.messages
    where user_id = m.user_id and deleted_at is null
    order by created_at desc limit 1
  ) as last_body,
  (
    select from_editor from public.messages
    where user_id = m.user_id and deleted_at is null
    order by created_at desc limit 1
  ) as last_from_editor,
  count(*) filter (where m.from_editor = false and m.read_at is null and m.deleted_at is null) as unread_for_admin,
  count(*) filter (where m.from_editor = true and m.read_at is null and m.deleted_at is null) as unread_for_user
from public.messages m
left join public.profiles_public p on p.user_id = m.user_id
group by m.user_id, p.display_name, p.avatar_url;

grant select on public.message_threads to authenticated;
