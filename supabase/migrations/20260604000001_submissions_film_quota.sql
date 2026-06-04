-- reader_submissions rate-limit 재정의:
--   기존: 1시간 윈도우, 전체 카운트 ≥ 10 차단 (모든 사용자에 너무 빡빡)
--   신규: 24시간 윈도우, 같은 film 카운트 ≥ 30 차단 (봇 도배만 차단,
--          정상 사용자는 한 롤 36컷도 통과)
-- film 정규화: NULL / 빈 문자열 / 공백만 입력은 같은 그룹으로 묶어 카운트
-- (필름 정보 안 적고 도배하는 회피 차단). 함수만 교체, 트리거는 기존 유지.

create or replace function public.reader_submissions_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  recent_count int;
  film_key text;
begin
  if uid is null then
    return new;
  end if;
  -- 편집부는 우회
  if exists (select 1 from public.profiles where user_id = uid and is_editor = true) then
    return new;
  end if;

  -- user_id 위조 차단
  new.user_id := uid;

  -- film 정규화 (NULL / 공백만 → NULL 키로 동일 그룹)
  film_key := nullif(btrim(coalesce(new.film, '')), '');

  -- 24시간 같은 film 30건 초과 차단.
  -- 봇 도배 방지가 목적. 정상 사용자는 한 롤(36컷) 같은 film 이라도 30장 통과,
  -- 나머지는 다른 film 입력 또는 24시간 후.
  select count(*) into recent_count
    from public.reader_submissions
   where user_id = uid
     and created_at > now() - interval '24 hours'
     and (
       (film_key is null and nullif(btrim(coalesce(film, '')), '') is null)
       or (film_key is not null and btrim(film) = film_key)
     );
  if recent_count >= 30 then
    raise exception '같은 필름으로 24시간에 30장까지 올릴 수 있어요. 다른 필름을 업로드 하거나 24시간 후 다시 시도해 주세요.' using errcode = '22023';
  end if;

  return new;
end;
$$;

NOTIFY pgrst, 'reload schema';
