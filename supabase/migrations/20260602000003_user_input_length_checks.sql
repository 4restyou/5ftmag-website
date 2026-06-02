-- 사용자 입력 필드 길이 제약 (DB-level CHECK)
-- 클라이언트의 maxlength 는 DevTools 로 우회 가능. DB CHECK 가 최종 가드.
-- 제한값은 각 폼의 클라 maxlength 와 동일 (서로 일치하도록 운영).
--
-- 기존 row 영향 방지를 위해 NOT VALID 로 추가 — 새 INSERT/UPDATE 만 검증한다.
-- 기존 데이터가 제약을 위배할 가능성은 낮으나 안전을 위해 NOT VALID.

-- ── 댓글 ──
alter table public.comments
  add constraint comments_body_length
  check (body is null or char_length(body) <= 2000)
  not valid;

-- ── 마켓 등록 ──
alter table public.market_listings
  add constraint market_listings_title_length
  check (title is null or char_length(title) <= 60)
  not valid;

alter table public.market_listings
  add constraint market_listings_description_length
  check (description is null or char_length(description) <= 1000)
  not valid;

alter table public.market_listings
  add constraint market_listings_price_length
  check (price is null or char_length(price) <= 40)
  not valid;

alter table public.market_listings
  add constraint market_listings_location_length
  check (location is null or char_length(location) <= 60)
  not valid;

alter table public.market_listings
  add constraint market_listings_seller_name_length
  check (seller_name is null or char_length(seller_name) <= 60)
  not valid;

alter table public.market_listings
  add constraint market_listings_phone_length
  check (phone is null or char_length(phone) <= 20)
  not valid;

alter table public.market_listings
  add constraint market_listings_contact_length
  check (contact is null or char_length(contact) <= 100)
  not valid;

-- ── 필름 제안 ──
alter table public.film_proposals
  add constraint film_proposals_brand_length
  check (brand is null or char_length(brand) <= 60)
  not valid;

alter table public.film_proposals
  add constraint film_proposals_name_length
  check (name is null or char_length(name) <= 80)
  not valid;

alter table public.film_proposals
  add constraint film_proposals_display_name_length
  check (display_name is null or char_length(display_name) <= 140)
  not valid;

alter table public.film_proposals
  add constraint film_proposals_iso_length
  check (iso is null or char_length(iso) <= 20)
  not valid;

alter table public.film_proposals
  add constraint film_proposals_type_length
  check (type is null or char_length(type) <= 40)
  not valid;

alter table public.film_proposals
  add constraint film_proposals_format_length
  check (format is null or char_length(format) <= 40)
  not valid;

alter table public.film_proposals
  add constraint film_proposals_description_length
  check (description is null or char_length(description) <= 1000)
  not valid;

-- ── 독자 사진 투고 ──
alter table public.reader_submissions
  add constraint reader_submissions_submitter_name_length
  check (submitter_name is null or char_length(submitter_name) <= 40)
  not valid;

alter table public.reader_submissions
  add constraint reader_submissions_instagram_length
  check (instagram is null or char_length(instagram) <= 80)
  not valid;

alter table public.reader_submissions
  add constraint reader_submissions_film_length
  check (film is null or char_length(film) <= 100)
  not valid;

alter table public.reader_submissions
  add constraint reader_submissions_camera_length
  check (camera is null or char_length(camera) <= 60)
  not valid;

alter table public.reader_submissions
  add constraint reader_submissions_caption_length
  check (caption is null or char_length(caption) <= 200)
  not valid;
