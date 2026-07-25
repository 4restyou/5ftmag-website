-- ════════════════════════════════════════════════════════════════════
-- 회원 본인 프로필 편집 (표시 이름 · 아바타 · 자기소개)
--
-- 배경: profiles 는 이미 "본인 행만 UPDATE" 정책(profiles_update_own)이 있고,
--   is_editor·user_id 변경은 profiles_privilege_guard 트리거가 막는다.
--   즉 백엔드 권한은 열려 있고 UI/클라이언트만 없었다. 이 마이그레이션은
--   자기소개(bio) 컬럼과 아바타 업로드 버킷을 추가하고, 로그인마다 이름을
--   구글 값으로 되돌리던 트리거를 "기존 값 보존" 으로 바로잡는다.
-- replay-safe.
-- ════════════════════════════════════════════════════════════════════

-- 1) bio 컬럼 + 길이 가드(공개 노출되는 자유 입력이라 서버에서도 상한)
alter table public.profiles
  add column if not exists bio text;

alter table public.profiles drop constraint if exists profiles_bio_len;
alter table public.profiles
  add constraint profiles_bio_len check (bio is null or char_length(bio) <= 500);

-- 2) 공개 프로필 뷰에 bio 노출 (정의자 권한 유지 = 베이스 RLS 우회, 안전 컬럼만)
create or replace view public.profiles_public as
select user_id, display_name, avatar_url, is_editor, bio
from public.profiles;

alter view public.profiles_public set (security_invoker = false);
grant select on public.profiles_public to anon, authenticated;

-- 3) 가입/로그인 트리거: 로그인마다 이름을 구글 값으로 덮어쓰던 동작을 보정.
--    신규(INSERT)는 구글 메타로 채우고, 재로그인(ON CONFLICT)에서는 이미
--    들어있는 값을 보존한다(사용자가 바꾼 이름/아바타가 유지되도록).
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'nickname',
      new.raw_user_meta_data->>'full_name',
      split_part(new.email, '@', 1)
    ),
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture',
      new.raw_user_meta_data->>'profile_image'
    )
  )
  on conflict (user_id) do update
    set display_name = coalesce(public.profiles.display_name, excluded.display_name),
        avatar_url   = coalesce(public.profiles.avatar_url, excluded.avatar_url),
        updated_at   = now();
  return new;
end;
$$ language plpgsql security definer;

-- 4) 아바타 스토리지 버킷 (public read, 본인 폴더에만 업로드/삭제)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-avatars',
  'user-avatars',
  true,
  2 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatar upload own folder" on storage.objects;
create policy "avatar upload own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      lower(name) like '%.jpg'
      or lower(name) like '%.jpeg'
      or lower(name) like '%.png'
      or lower(name) like '%.webp'
    )
  );

drop policy if exists "avatar delete own folder" on storage.objects;
create policy "avatar delete own folder" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "public read avatars" on storage.objects;
create policy "public read avatars" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'user-avatars');
