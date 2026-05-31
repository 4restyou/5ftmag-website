-- 답글 알림 인프라
-- 1) user_notifications.type CHECK 에 'comment_reply' 추가
-- 2) comments AFTER INSERT 트리거 — parent_id 가 있고 부모 작성자 ≠ 답글 작성자면
--    부모 작성자의 user_notifications 에 한 건 인서트.
-- 부모 댓글이 soft-delete 됐어도 알림은 보낸다(작성자는 자기 댓글 흔적을 추적해야 한다).

alter table public.user_notifications
  drop constraint if exists user_notifications_type_check;

alter table public.user_notifications
  add constraint user_notifications_type_check
  check (type in (
    'submission_approved',
    'submission_rejected',
    'submission_deleted',
    'listing_hidden',
    'listing_restored',
    'comment_reply'
  ));

create or replace function public.comments_notify_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_uid uuid;
  preview text;
begin
  if new.parent_id is null then
    return new;
  end if;

  select user_id into parent_uid
    from public.comments
   where id = new.parent_id;

  -- 부모가 없거나(이론상) 자기 자신 답글이면 알림 생략
  if parent_uid is null or parent_uid = new.user_id then
    return new;
  end if;

  preview := btrim(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g'));
  if char_length(preview) > 80 then
    preview := substring(preview from 1 for 78) || '…';
  end if;

  insert into public.user_notifications (user_id, type, related_id, title, body, link)
  values (
    parent_uid,
    'comment_reply',
    new.id,
    '내 댓글에 답글이 달렸어요',
    preview,
    '/' || new.page_id || '.html#comments'
  );

  return new;
end;
$$;

drop trigger if exists comments_notify_reply on public.comments;
create trigger comments_notify_reply
  after insert on public.comments
  for each row
  execute function public.comments_notify_reply();
