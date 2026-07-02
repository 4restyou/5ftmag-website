-- ════════════════════════════════════════════════════════════════════
-- 이북 스마트스토어 판매 연동 + 결제 재사용 방지
--
-- 1) ebook_products.store_url — 스마트스토어 상품 페이지 링크.
--    결제창에서 "스마트스토어에서 구매" 버튼이 이 주소를 연다.
--    URL 끝의 /products/{번호} 가 주문 검증 시 상품 대조 기준이 된다.
-- 2) ebook_entitlements.order_ref 부분 유니크 —
--    같은 결제(포트원 paymentId)나 같은 스마트스토어 주문번호로
--    열람권을 두 번 얻는 것을 DB 차원에서 차단.
--    (수동 부여의 빈 문자열 order_ref 는 제외)
-- replay-safe.
-- ════════════════════════════════════════════════════════════════════

alter table public.ebook_products
  add column if not exists store_url text not null default '';

create unique index if not exists idx_ebook_entitlements_order_ref
  on public.ebook_entitlements(order_ref)
  where order_ref <> '';
