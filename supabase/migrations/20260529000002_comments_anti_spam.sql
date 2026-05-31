-- 댓글 도배 방지 (BEFORE INSERT 트리거)
-- 1) user_id 위조 차단: 클라가 어떤 user_id 를 보내든 auth.uid() 로 강제 덮어쓰기
-- 2) rate-limit: 동일 user 가 10초 안에 5건 초과 인서트 시 거부
-- 3) duplicate: 동일 user 가 1분 안에 같은 본문(공백 정규화 후) 재인서트 시 거부
-- 편집부(profiles.is_editor)는 모더레이션을 위해 면제.
-- 미로그인(auth.uid() IS NULL) 은 거부.

create or replace function public.comments_anti_spam()
returns trigger
language plpgsql
security invoker
as $$
declare
  uid uuid := auth.uid();
  is_editor boolean := false;
  recent_count int;
  norm_body text;
begin
  if uid is null then
    raise exception 'login required'
      using errcode = '28000';
  end if;

  -- 편집부면 모든 검사 면제 + user_id 위조도 허용(공식 모더레이션 도구가 다른 user_id 로 쓸 일은 없으나 안전망)
  select coalesce(p.is_editor, false) into is_editor
    from public.profiles p
   where p.user_id = uid;

  if coalesce(is_editor, false) then
    return new;
  end if;

  -- user_id 위조 차단
  new.user_id := uid;

  -- 본문 공백 정규화(중복 비교용 — 저장 값은 트리거 호출자가 trim 한 그대로)
  norm_body := regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g');
  norm_body := btrim(norm_body);

  -- rate-limit: 10초 윈도우에 5건 초과
  select count(*) into recent_count
    from public.comments
   where user_id = uid
     and created_at > now() - interval '10 seconds';
  if recent_count >= 5 then
    raise exception '잠시 후 다시 시도해 주세요 (10초에 5건 초과)'
      using errcode = '22023';
  end if;

  -- duplicate: 같은 user 가 같은 본문(정규화) 을 1분 안에 재인서트
  if norm_body <> '' and exists (
    select 1 from public.comments
     where user_id = uid
       and deleted_at is null
       and created_at > now() - interval '1 minute'
       and btrim(regexp_replace(coalesce(body,''),'\s+',' ','g')) = norm_body
  ) then
    raise exception '같은 내용을 연속으로 올릴 수 없어요'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists comments_anti_spam_before_insert on public.comments;
create trigger comments_anti_spam_before_insert
  before insert on public.comments
  for each row
  execute function public.comments_anti_spam();
