-- 금칙어 관리 테이블 + 금칙어 포함 댓글 능동 알림
-- ════════════════════════════════════════════════════════════
-- 1) 편집부가 관리하는 금칙어 목록
-- ════════════════════════════════════════════════════════════
create table if not exists public.comment_filter_terms (
  id          uuid primary key default gen_random_uuid(),
  term        text not null unique check (char_length(term) >= 1),
  created_by  uuid,
  created_at  timestamptz not null default now()
);

alter table public.comment_filter_terms enable row level security;

-- 편집부만 조회/등록/삭제 (금칙어 노출로 우회 시도 방지)
drop policy if exists comment_filter_terms_editor on public.comment_filter_terms;
create policy comment_filter_terms_editor on public.comment_filter_terms
  for all
  using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_editor = true)
  )
  with check (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_editor = true)
  );

-- 초기 목록 시드 (기존 클라이언트 하드코딩 목록)
insert into public.comment_filter_terms (term) values
  ('시발'),('씨발'),('씨바'),('병신'),('지랄'),('새끼'),('개새'),('좆'),
  ('보지'),('자지'),('니미'),('애미'),('엠창'),('꺼져'),('죽어버려')
on conflict (term) do nothing;

-- ════════════════════════════════════════════════════════════
-- 2) 알림 type CHECK 에 comment_flagged_editor 추가 (멱등 재정의)
-- ════════════════════════════════════════════════════════════
alter table public.user_notifications
  drop constraint if exists user_notifications_type_check;
alter table public.user_notifications
  add  constraint user_notifications_type_check
       check (type in (
         'submission_approved',
         'submission_rejected',
         'submission_deleted',
         'listing_hidden',
         'listing_restored',
         'submission_pending_editor',
         'market_report_editor',
         'comment_flagged_editor',
         'debug_test'
       ));

-- ════════════════════════════════════════════════════════════
-- 3) 금칙어 포함 댓글 → 편집부 전원 알림
--    AFTER INSERT 트리거. 알림 처리 실패가 댓글 작성을 막지 않도록
--    전체를 예외로 감싸고 항상 NEW 를 반환한다.
-- ════════════════════════════════════════════════════════════
create or replace function public.notify_editors_flagged_comment()
returns trigger as $$
declare
  ed RECORD;
  matched boolean;
begin
  begin
    if NEW.deleted_at is not null then
      return NEW;
    end if;
    select exists (
      select 1 from public.comment_filter_terms t
      where t.term <> ''
        and position(lower(t.term) in lower(coalesce(NEW.body, ''))) > 0
    ) into matched;

    if matched then
      for ed in select user_id from public.profiles where is_editor = true loop
        insert into public.user_notifications(user_id, type, related_id, title, body, link)
        values (
          ed.user_id,
          'comment_flagged_editor',
          NEW.id,
          '금칙어 댓글 감지',
          '등록된 금칙어가 포함된 댓글이 올라왔어요. 확인해 주세요.',
          '/admin/comments.html'
        );
      end loop;
    end if;
  exception when others then
    return NEW;
  end;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists notify_editors_flagged_comment on public.comments;
create trigger notify_editors_flagged_comment
  after insert on public.comments
  for each row execute function public.notify_editors_flagged_comment();

revoke all on function public.notify_editors_flagged_comment() from PUBLIC, anon, authenticated;
