-- ════════════════════════════════════════════════════════════════════
-- ebook-pages 버킷 스토리지 RLS
--
-- 페이지 이미지 원본은 비공개. 공개/anon 접근 없음.
--   - 편집부: 업로드/수정/삭제 + 목록·미리보기(select). (admin 관리용)
--   - 일반 사용자: 접근 불가. 열람은 Phase 2 Edge Function(service_role)이
--     권한 확인 후 워터마크를 새겨 전달 (service_role 은 RLS 우회).
--
-- replay-safe.
-- ════════════════════════════════════════════════════════════════════

drop policy if exists "ebook_pages_editor_select" on storage.objects;
create policy "ebook_pages_editor_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ebook-pages'
    and exists (select 1 from public.profiles
                where profiles.user_id = auth.uid() and profiles.is_editor = true)
  );

drop policy if exists "ebook_pages_editor_insert" on storage.objects;
create policy "ebook_pages_editor_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ebook-pages'
    and exists (select 1 from public.profiles
                where profiles.user_id = auth.uid() and profiles.is_editor = true)
  );

drop policy if exists "ebook_pages_editor_update" on storage.objects;
create policy "ebook_pages_editor_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'ebook-pages'
    and exists (select 1 from public.profiles
                where profiles.user_id = auth.uid() and profiles.is_editor = true)
  );

drop policy if exists "ebook_pages_editor_delete" on storage.objects;
create policy "ebook_pages_editor_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ebook-pages'
    and exists (select 1 from public.profiles
                where profiles.user_id = auth.uid() and profiles.is_editor = true)
  );
