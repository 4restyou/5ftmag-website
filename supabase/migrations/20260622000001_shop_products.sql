-- ════════════════════════════════════════════════════════════════════
-- shop_products — 5ftmag.com 자체 상품 카탈로그 (Smart Store deep link)
--
-- 결제·정산·세무·재고는 Smart Store 가 처리. 이 테이블은 매거진 톤으로
-- 사진·카피·가격을 보여주고, "구매하기" 버튼이 Smart Store 의 해당 상품
-- 페이지로 deep link 시켜주는 역할만 한다.
--
-- 가격·재고는 admin 에서 수동 동기화 (Smart Store 측 변경 시).
-- 마이그레이션 폴더에 정의가 없어도 운영에 적용된 다른 테이블 (comments,
-- likes 등) 패턴 따라 replay-safe 하게 작성.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.shop_products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  category text not null default 'goods',  -- film / camera / goods / book / etc
  price integer not null default 0,        -- KRW 단위 정수
  original_price integer,                  -- 정가 (할인 표시용, null 이면 미사용)
  excerpt text not null default '',        -- 카드 한 줄 설명
  description text not null default '',    -- 상세 본문 (Markdown 또는 plain text)
  images jsonb not null default '[]'::jsonb, -- 사진 URL 배열 ["...", "..."]
  smart_store_url text not null default '', -- 구매 deep link (Smart Store)
  available boolean not null default true, -- 품절·단종 시 false
  sort_order integer not null default 0,   -- 작을수록 위
  published boolean not null default false,-- false 면 공개 안 함
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shop_products_slug on public.shop_products(slug);
create index if not exists idx_shop_products_published_sort
  on public.shop_products(published, sort_order, created_at desc)
  where published = true;
create index if not exists idx_shop_products_category on public.shop_products(category);

alter table public.shop_products enable row level security;

-- 공개 조회 — 발행된 상품만 누구나 읽기
drop policy if exists "shop_products_select_public" on public.shop_products;
create policy "shop_products_select_public" on public.shop_products
  for select using (published = true);

-- 편집부 전체 조회 (미발행 상품도 admin 에서 보려면 필요) + 쓰기.
-- 다른 마이그레이션과 동일한 패턴: profiles.user_id + is_editor.
-- (이전 시도에서 profiles.id 로 잘못 썼다가 prod 의 컬럼명 불일치로 실패)
drop policy if exists "shop_products_select_editor" on public.shop_products;
create policy "shop_products_select_editor" on public.shop_products
  for select using (
    exists (select 1 from public.profiles
            where profiles.user_id = auth.uid() and profiles.is_editor = true)
  );

drop policy if exists "shop_products_write_editor" on public.shop_products;
create policy "shop_products_write_editor" on public.shop_products
  for all using (
    exists (select 1 from public.profiles
            where profiles.user_id = auth.uid() and profiles.is_editor = true)
  )
  with check (
    exists (select 1 from public.profiles
            where profiles.user_id = auth.uid() and profiles.is_editor = true)
  );

-- updated_at 자동 갱신
create or replace function public.shop_products_set_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shop_products_updated_at on public.shop_products;
create trigger shop_products_updated_at
  before update on public.shop_products
  for each row execute function public.shop_products_set_updated_at();
