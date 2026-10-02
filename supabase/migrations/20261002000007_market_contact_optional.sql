-- 장터 연락처: 핸드폰·기타 중 하나만 있으면 되게 한다 (정비 F2, 2026-10-02).
--
-- C3(#790)에서 등록 폼은 둘 중 하나만 받게 했지만, 두 칸이 NOT NULL 이라 비운 칸을
-- 옛 backfill 값 '미입력'(20260516000001)으로 채워 넣고 화면에서 가렸다. 이제 NULL 을
-- 허용하고 "둘 중 하나는 있어야 한다" 를 제약으로 둔다. 기존 '미입력' 은 다른 칸에
-- 실제 값이 있을 때만 NULL 로 바꾼다(둘 다 '미입력' 인 옛 행은 그대로 두고, 제약은
-- NOT VALID 로 새 저장에만 건다. 그 행의 주인이 다음에 고칠 때 연락처를 하나 적어야 한다).
-- 길이 CHECK(20260602000003)는 이미 NULL 을 허용한다. 재실행 안전.

ALTER TABLE public.market_listings
  ALTER COLUMN phone DROP NOT NULL,
  ALTER COLUMN contact DROP NOT NULL;

UPDATE public.market_listings
   SET phone = NULL
 WHERE phone = '미입력'
   AND NULLIF(contact, '') IS NOT NULL AND contact <> '미입력';

UPDATE public.market_listings
   SET contact = NULL
 WHERE contact = '미입력'
   AND NULLIF(phone, '') IS NOT NULL AND phone <> '미입력';

ALTER TABLE public.market_listings
  DROP CONSTRAINT IF EXISTS market_listings_contact_any;
ALTER TABLE public.market_listings
  ADD CONSTRAINT market_listings_contact_any
  CHECK (NULLIF(phone, '') IS NOT NULL OR NULLIF(contact, '') IS NOT NULL) NOT VALID;

NOTIFY pgrst, 'reload schema';
