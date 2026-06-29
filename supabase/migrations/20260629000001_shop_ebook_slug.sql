-- ════════════════════════════════════════════════════════════════════
-- shop_products.ebook_slug — 품절 실물 상품을 동일 이북으로 연결
--
-- 실물이 완판(available=false)되면 카드/모달에서 "이북으로 보기" 링크로
-- 해당 이북(ebook_products.slug)을 열게 한다. SPC 사진첩처럼 100권 완판 후
-- 저가 이북으로 전환되는 흐름을 자연스럽게 잇기 위함.
-- 비어 있으면(기존 동작) 그냥 "품절" 표시.
-- replay-safe.
-- ════════════════════════════════════════════════════════════════════

alter table public.shop_products
  add column if not exists ebook_slug text;
