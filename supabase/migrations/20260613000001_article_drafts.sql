-- Article drafts table — 편집부 글 작성 에디터 저장소.
-- 발행은 GitHub PR 로 정적 파일 생성하는 별도 흐름이라 이 테이블은 초안 + 자동저장만 담당.

create table if not exists article_drafts (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (char_length(slug) between 1 and 80 and slug ~ '^[a-z0-9-]+$'),
  title text not null default '',
  subtitle text not null default '',
  category text not null default 'essay',
  category_label text not null default 'ESSAY',
  byline text not null default '5ft.mag 편집부',
  date_iso date not null default current_date,
  hero_image text not null default '',
  hero_alt text not null default '',
  hero_caption text not null default '',
  excerpt text not null default '',
  body_json jsonb not null default '{}'::jsonb,   -- Tiptap document JSON
  body_html text not null default '',             -- 빌드 시 변환된 HTML (PR 미리보기용)
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists article_drafts_slug_idx on article_drafts(slug);
create index if not exists article_drafts_updated_idx on article_drafts(updated_at desc);

-- updated_at 자동 갱신
create or replace function article_drafts_touch_updated() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

drop trigger if exists article_drafts_touch on article_drafts;
create trigger article_drafts_touch before update on article_drafts
  for each row execute function article_drafts_touch_updated();

-- RLS: 편집부 (is_editor) 만 read/write
alter table article_drafts enable row level security;

drop policy if exists article_drafts_editor_select on article_drafts;
create policy article_drafts_editor_select on article_drafts for select to authenticated
  using (exists (select 1 from profiles where profiles.user_id = auth.uid() and profiles.is_editor = true));

drop policy if exists article_drafts_editor_insert on article_drafts;
create policy article_drafts_editor_insert on article_drafts for insert to authenticated
  with check (exists (select 1 from profiles where profiles.user_id = auth.uid() and profiles.is_editor = true));

drop policy if exists article_drafts_editor_update on article_drafts;
create policy article_drafts_editor_update on article_drafts for update to authenticated
  using (exists (select 1 from profiles where profiles.user_id = auth.uid() and profiles.is_editor = true))
  with check (exists (select 1 from profiles where profiles.user_id = auth.uid() and profiles.is_editor = true));

drop policy if exists article_drafts_editor_delete on article_drafts;
create policy article_drafts_editor_delete on article_drafts for delete to authenticated
  using (exists (select 1 from profiles where profiles.user_id = auth.uid() and profiles.is_editor = true));

-- Storage bucket for article media (편집부 업로드)
insert into storage.buckets (id, name, public)
  values ('article-media', 'article-media', true)
  on conflict (id) do nothing;

drop policy if exists article_media_public_read on storage.objects;
create policy article_media_public_read on storage.objects for select to public
  using (bucket_id = 'article-media');

drop policy if exists article_media_editor_insert on storage.objects;
create policy article_media_editor_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'article-media'
              and exists (select 1 from profiles where profiles.user_id = auth.uid() and profiles.is_editor = true));

drop policy if exists article_media_editor_update on storage.objects;
create policy article_media_editor_update on storage.objects for update to authenticated
  using (bucket_id = 'article-media'
         and exists (select 1 from profiles where profiles.user_id = auth.uid() and profiles.is_editor = true));

drop policy if exists article_media_editor_delete on storage.objects;
create policy article_media_editor_delete on storage.objects for delete to authenticated
  using (bucket_id = 'article-media'
         and exists (select 1 from profiles where profiles.user_id = auth.uid() and profiles.is_editor = true));
