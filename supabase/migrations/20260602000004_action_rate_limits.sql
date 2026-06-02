-- 사용자 액션 rate-limit (BEFORE INSERT 트리거)
-- 댓글 anti-spam 트리거(20260529000002) 와 동일 패턴을 다음 액션에도 적용한다:
--   - likes:             댓글 좋아요 (남발 차단)
--   - user_favorites:    필름 / 글 즐겨찾기 (UPSERT 멱등이지만 다른 target 폭탄 차단)
--   - reader_submissions: 사진 투고 (대량 업로드 차단)
--
-- 공통 규칙:
--   1) 미로그인(auth.uid IS NULL) 은 RLS 가 이미 막지만 안전을 위해 거부.
--   2) 편집부(profiles.is_editor) 는 모더레이션 / 운영을 위해 면제.
--   3) 동일 사용자가 정해진 윈도우 내 임계치 초과 시 거부.
--
-- newsletter_subscribers 는 익명 INSERT 가 허용돼 IP 기반 rate-limit 이 필요한데
-- PostgreSQL 트리거에서 IP 추적이 어려워(요청 헤더 비노출) 본 PR 에선 제외한다.

-- ── 1) likes (댓글 좋아요) ──
create or replace function public.likes_rate_limit()
returns trigger
language plpgsql
security invoker
as $$
declare
  uid uuid := auth.uid();
  is_editor boolean := false;
  recent_count int;
begin
  if uid is null then
    raise exception 'login required' using errcode = '28000';
  end if;

  select coalesce(p.is_editor, false) into is_editor
    from public.profiles p
   where p.user_id = uid;

  if coalesce(is_editor, false) then
    return new;
  end if;

  -- user_id 위조 차단
  new.user_id := uid;

  -- 10초 윈도우에 20건 초과
  select count(*) into recent_count
    from public.likes
   where user_id = uid
     and created_at > now() - interval '10 seconds';
  if recent_count >= 20 then
    raise exception '잠시 후 다시 시도해 주세요 (10초에 20건 초과)' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists likes_rate_limit_before_insert on public.likes;
create trigger likes_rate_limit_before_insert
  before insert on public.likes
  for each row
  execute function public.likes_rate_limit();

-- ── 2) user_favorites (필름 / 글 즐겨찾기) ──
create or replace function public.user_favorites_rate_limit()
returns trigger
language plpgsql
security invoker
as $$
declare
  uid uuid := auth.uid();
  is_editor boolean := false;
  recent_count int;
begin
  if uid is null then
    raise exception 'login required' using errcode = '28000';
  end if;

  select coalesce(p.is_editor, false) into is_editor
    from public.profiles p
   where p.user_id = uid;

  if coalesce(is_editor, false) then
    return new;
  end if;

  -- user_id 위조 차단
  new.user_id := uid;

  -- 10초 윈도우에 30건 초과 (필름/글 빠르게 둘러보며 누를 수 있어 likes 보다 여유)
  select count(*) into recent_count
    from public.user_favorites
   where user_id = uid
     and created_at > now() - interval '10 seconds';
  if recent_count >= 30 then
    raise exception '잠시 후 다시 시도해 주세요 (10초에 30건 초과)' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists user_favorites_rate_limit_before_insert on public.user_favorites;
create trigger user_favorites_rate_limit_before_insert
  before insert on public.user_favorites
  for each row
  execute function public.user_favorites_rate_limit();

-- ── 3) reader_submissions (독자 사진 투고) ──
create or replace function public.reader_submissions_rate_limit()
returns trigger
language plpgsql
security invoker
as $$
declare
  uid uuid := auth.uid();
  is_editor boolean := false;
  recent_count int;
begin
  if uid is null then
    raise exception 'login required' using errcode = '28000';
  end if;

  select coalesce(p.is_editor, false) into is_editor
    from public.profiles p
   where p.user_id = uid;

  if coalesce(is_editor, false) then
    return new;
  end if;

  -- user_id 위조 차단
  new.user_id := uid;

  -- 1시간 윈도우에 10건 초과 (사진 업로드는 정상 사용자도 한 번에 여러 장 가능,
  -- 하지만 한 시간에 10장 이상은 비정상으로 본다)
  select count(*) into recent_count
    from public.reader_submissions
   where user_id = uid
     and created_at > now() - interval '1 hour';
  if recent_count >= 10 then
    raise exception '잠시 후 다시 시도해 주세요 (1시간에 10건 초과)' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists reader_submissions_rate_limit_before_insert on public.reader_submissions;
create trigger reader_submissions_rate_limit_before_insert
  before insert on public.reader_submissions
  for each row
  execute function public.reader_submissions_rate_limit();
