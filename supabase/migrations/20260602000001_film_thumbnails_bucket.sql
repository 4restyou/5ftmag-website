-- 필름 캔(필름통) 썸네일 업로드용 Storage 버킷 + 정책
-- admin/films 의 썸네일을 git 자산이 아니라 Storage 에 올려 관리한다.
-- 공개 SELECT 라 라이브러리 카드가 그대로 <img src> 로 접근.
-- 쓰기는 편집부(profiles.is_editor = true) 만.

insert into storage.buckets (id, name, public)
values ('film-thumbnails', 'film-thumbnails', true)
on conflict (id) do nothing;

drop policy if exists "film_thumbnails_public_read" on storage.objects;
create policy "film_thumbnails_public_read"
on storage.objects for select to public
using (bucket_id = 'film-thumbnails');

drop policy if exists "film_thumbnails_editor_insert" on storage.objects;
create policy "film_thumbnails_editor_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'film-thumbnails'
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.is_editor = true
  )
);

drop policy if exists "film_thumbnails_editor_update" on storage.objects;
create policy "film_thumbnails_editor_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'film-thumbnails'
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.is_editor = true
  )
);

drop policy if exists "film_thumbnails_editor_delete" on storage.objects;
create policy "film_thumbnails_editor_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'film-thumbnails'
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.is_editor = true
  )
);
