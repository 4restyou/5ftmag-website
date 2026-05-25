-- 편집부(profiles.is_editor)가 모든 댓글을 소프트 삭제/복구(모더레이션) 할 수 있도록 허용.
-- 기존 정책은 보통 작성자 본인(user_id = auth.uid())만 수정 가능해서, 편집부가
-- 남의 댓글을 가릴 수 없었다. 추가 정책이라 기존 권한에는 영향이 없다.
-- (comments 테이블에 RLS 가 꺼져 있으면 이 정책은 휴면 상태일 뿐 무해.)

drop policy if exists comments_editor_moderate on public.comments;

create policy comments_editor_moderate on public.comments
  for update
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.is_editor = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.is_editor = true
    )
  );
