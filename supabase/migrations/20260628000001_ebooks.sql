-- ════════════════════════════════════════════════════════════════════
-- ebooks — 유료 이북(SPC 사진첩 완판분 / 5ft 이월호) 열람권 시스템
--
-- 모델:
--   - ebook_products: 판매하는 이북 카탈로그(표지·가격·페이지 수 등).
--     SPC 사진첩은 실물 100권 완판 후 ebook_on_sale 을 켜서 저가 이북으로 전환.
--   - ebook_entitlements: "누가 어떤 이북을 볼 수 있는가" (구매=열람권).
--     Phase 1 은 편집부 수동 부여(무통장입금 확인 후). Phase 2(자체 결제)에서
--     Edge Function 이 결제 검증 후 source='payment' 로 자동 insert.
--
-- 페이지 이미지 원본은 비공개 Storage 버킷(ebook-pages)에 두고, 권한 있는
-- 사용자에게만 Edge Function 이 짧은 TTL 서명 URL 로 한 장씩 내려준다.
-- (이 마이그레이션은 테이블·RLS·버킷까지. 뷰어/Edge Function 은 별도.)
--
-- 운영 패턴: 다른 마이그레이션과 동일하게 replay-safe + profiles.user_id +
-- is_editor 기반 RLS (shop_products 와 동일).
-- ════════════════════════════════════════════════════════════════════

-- ── 카탈로그 ──────────────────────────────────────────────────────────
create table if not exists public.ebook_products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  kind text not null default 'spc',          -- spc(사진첩) / backissue(이월호)
  price integer not null default 0,          -- 이북 가격 (KRW 정수)
  original_price integer,                     -- 실물 정가 (할인 표시용, null 이면 미사용)
  excerpt text not null default '',           -- 카드 한 줄 설명
  description text not null default '',        -- 상세 본문
  cover_image text not null default '',        -- 표지 URL (공개 가능)
  page_count integer not null default 0,       -- 페이지 수
  pages_path text not null default '',         -- 비공개 버킷 내 폴더 prefix (예: 'spc-issue01/')
  ebook_on_sale boolean not null default false,-- 이북 구매 가능 여부 (완판 전엔 false)
  sort_order integer not null default 0,       -- 작을수록 위
  published boolean not null default false,    -- false 면 Books 에 노출 안 함
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ebook_products_slug on public.ebook_products(slug);
create index if not exists idx_ebook_products_published_sort
  on public.ebook_products(published, sort_order, created_at desc)
  where published = true;

alter table public.ebook_products enable row level security;

-- 공개 조회 — 발행된 것만 누구나 (메타 정보. 페이지 이미지는 별도 보호)
drop policy if exists "ebook_products_select_public" on public.ebook_products;
create policy "ebook_products_select_public" on public.ebook_products
  for select using (published = true);

-- 편집부 — 전체 조회 + 쓰기 (shop_products 와 동일 패턴)
drop policy if exists "ebook_products_select_editor" on public.ebook_products;
create policy "ebook_products_select_editor" on public.ebook_products
  for select using (
    exists (select 1 from public.profiles
            where profiles.user_id = auth.uid() and profiles.is_editor = true)
  );

drop policy if exists "ebook_products_write_editor" on public.ebook_products;
create policy "ebook_products_write_editor" on public.ebook_products
  for all using (
    exists (select 1 from public.profiles
            where profiles.user_id = auth.uid() and profiles.is_editor = true)
  )
  with check (
    exists (select 1 from public.profiles
            where profiles.user_id = auth.uid() and profiles.is_editor = true)
  );

create or replace function public.ebook_products_set_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ebook_products_updated_at on public.ebook_products;
create trigger ebook_products_updated_at
  before update on public.ebook_products
  for each row execute function public.ebook_products_set_updated_at();

-- ── 열람권 ────────────────────────────────────────────────────────────
create table if not exists public.ebook_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.ebook_products(id) on delete cascade,
  source text not null default 'manual',       -- manual(수동 부여) / payment(자동)
  order_ref text not null default '',           -- 입금자명·주문번호 등 메모
  granted_by uuid,                              -- 부여한 편집부 user_id (수동일 때)
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index if not exists idx_ebook_entitlements_user on public.ebook_entitlements(user_id);
create index if not exists idx_ebook_entitlements_product on public.ebook_entitlements(product_id);

alter table public.ebook_entitlements enable row level security;

-- 본인 열람권만 조회 (뷰어가 권한 확인용)
drop policy if exists "ebook_entitlements_select_own" on public.ebook_entitlements;
create policy "ebook_entitlements_select_own" on public.ebook_entitlements
  for select using (user_id = auth.uid());

-- 편집부 — 전체 조회 + 부여/회수(쓰기). 일반 사용자는 직접 insert 불가
-- (Phase 2 자동 결제는 service_role 로 동작해 RLS 우회).
drop policy if exists "ebook_entitlements_select_editor" on public.ebook_entitlements;
create policy "ebook_entitlements_select_editor" on public.ebook_entitlements
  for select using (
    exists (select 1 from public.profiles
            where profiles.user_id = auth.uid() and profiles.is_editor = true)
  );

drop policy if exists "ebook_entitlements_write_editor" on public.ebook_entitlements;
create policy "ebook_entitlements_write_editor" on public.ebook_entitlements
  for all using (
    exists (select 1 from public.profiles
            where profiles.user_id = auth.uid() and profiles.is_editor = true)
  )
  with check (
    exists (select 1 from public.profiles
            where profiles.user_id = auth.uid() and profiles.is_editor = true)
  );

-- ── 비공개 Storage 버킷 (페이지 이미지 원본) ──────────────────────────
-- public=false 이므로 직접 URL 접근 불가. Edge Function 이 service_role 로
-- 짧은 TTL 서명 URL 을 발급해 권한 있는 사용자에게만 한 장씩 전달.
insert into storage.buckets (id, name, public)
values ('ebook-pages', 'ebook-pages', false)
on conflict (id) do nothing;
