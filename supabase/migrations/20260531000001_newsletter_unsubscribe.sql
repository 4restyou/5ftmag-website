-- 뉴스레터 구독 해지 인프라
-- 1) unsubscribe_token 컬럼(UUID, 행마다 자동 생성, 유니크)
-- 2) 익명이 토큰만 알면 자기 row 를 지울 수 있는 RPC (SECURITY DEFINER)
-- 운영자가 새 이슈 발송 시 메일 본문에 https://5ftmag.com/unsubscribe.html?token=<unsubscribe_token>
-- 형태의 해지 링크를 박을 수 있게 한다.

alter table public.newsletter_subscribers
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

create unique index if not exists newsletter_subscribers_token_uniq
  on public.newsletter_subscribers(unsubscribe_token);

-- 익명 호출 가능한 해지 RPC.
-- RLS 가 SELECT 를 막고 있어 토큰을 안다고 해서 다른 사용자 이메일을 알 수 없다.
-- 정확히 일치하는 토큰의 row 하나만 지우고, 결과(true/false) 만 반환한다.
create or replace function public.newsletter_unsubscribe(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null then
    return false;
  end if;
  delete from public.newsletter_subscribers
   where unsubscribe_token = p_token;
  return found;
end;
$$;

revoke all on function public.newsletter_unsubscribe(uuid) from public;
grant execute on function public.newsletter_unsubscribe(uuid) to anon, authenticated;
