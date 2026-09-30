-- 필름 추가: Ilford Ilfocolor 400 Plus (구독자 제안, 2026-09-28 접수).
--
-- 확인한 사실 (판매처 상품 정보)
--   - 지금 팔리는 이름은 Ilfocolor Vintage Tone 400 Plus 다
--   - C-41 컬러 네거티브, ISO 400, 데일라이트 밸런스, 35mm 24컷 · 36컷
--   - 시안 쪽으로 기울어 녹색과 파랑이 가라앉고 빨강과 노랑이 도드라진다는 설명이 붙는다
--
-- 같은 이름을 쓰던 예전 제품(페라니아 제조로 알려진 Ilfocolor 400 Plus)과 지금 제품의
-- 제조처가 같은지는 확인하지 못해 설명에 넣지 않는다.
-- 캔 썸네일은 아직 없어 pending 으로 둔다. slug 중복은 ON CONFLICT 로 막아 replay-safe.

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'ilfocolor400plus',
  'library',
  'ILFORD',
  'Ilfocolor 400 Plus',
  'Ilford Ilfocolor 400 Plus',
  '["Ilfocolor 400 Plus","Ilfocolor 400","Ilford Ilfocolor 400","Ilford Ilfocolor 400 Plus","Ilfocolor Vintage Tone 400 Plus","Ilford Ilfocolor Vintage Tone 400","Ilfocolour 400","일포컬러 400","일포컬러400","일포드 일포컬러 400","ilfocolor400plus","ilfocolor400"]'::jsonb,
  '흑백으로 익숙한 일포드 이름을 단 컬러 네거티브예요. 지금은 Ilfocolor Vintage Tone 400 Plus 라는 이름으로 팔립니다. 색이 시안 쪽으로 살짝 기울어 녹색과 파랑은 가라앉고 빨강과 노랑이 도드라져, 이름대로 오래된 사진 같은 색이 나온다는 설명이 붙어요. C-41 현상, 데일라이트 밸런스, 35mm 24컷 · 36컷.',
  '400',
  'Color Negative',
  '35mm',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

-- 이 필름을 제안한 대기 중 신청을 승인 처리하고, 신청자에게 관리 화면과 같은 알림을 보낸다.
-- 대기(pending) 상태인 것만 바꾸므로 다시 적용해도 알림이 두 번 가지 않는다.
WITH approved AS (
  UPDATE public.film_proposals
     SET status = 'approved', approved_slug = 'ilfocolor400plus', reviewed_at = now()
   WHERE status = 'pending'
     AND lower(regexp_replace(coalesce(brand, '') || ' ' || coalesce(name, ''), '\s+', '', 'g')) LIKE '%ilfocolor400%'
  RETURNING id, user_id, brand, name
)
INSERT INTO public.user_notifications (user_id, type, related_id, title, body, link)
SELECT user_id, 'proposal_approved', id, '신청하신 필름이 등록됐어요',
       left(brand || ' ' || name, 500), '/films.html#film-ilfocolor400plus'
  FROM approved;
