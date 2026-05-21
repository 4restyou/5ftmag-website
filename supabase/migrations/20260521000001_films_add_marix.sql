-- MARIX Color movie NegaFilm 시리즈 3종 추가
-- 일본 MARIX (2021 가을 출시) 가 풀고 있는 시네 필름 리패키지 라인.
-- Kodak Vision3 시네 필름의 remjet(rem-jet) 카본 백코트를 제거해 C-41 일반
-- 현상이 가능하게 만든 게 정체성. 라인업은 100D / 400D / 800T 3종이며 모두
-- 35mm 24 컷 또는 36 컷 두 포맷으로 판매. 시네 필름 분류이므로 filterCategory
-- 가 cinema 그룹으로 묶이도록 type 을 Daylight / Tungsten 으로 명시.

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'marix100d',
  'library',
  'MARIX',
  '100D',
  'MARIX 100D',
  '["MARIX 100D","Marix 100D","마릭스 100D","마리쿠스 100D","MARIX Color movie NegaFilm 100D","Marix Color Negative 100D","Vision3 5203","5203 50D","marix100d"]'::jsonb,
  '일본 MARIX 가 2021 년부터 풀고 있는 시네 필름 리패키지. Kodak Vision3 50D(5203) 의 remjet 백코트를 걷어내 C-41 일반 현상이 가능한 한 롤로 만들었습니다. 베이스가 ISO 50 영화 필름이지만 remjet 을 떼면서 권장 감도는 ISO 100. 한낮 햇살에 시네마 톤을 가장 얕게 가져오는 입문 라인입니다.',
  '100',
  'Daylight',
  '35mm',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'marix400d',
  'library',
  'MARIX',
  '400D',
  'MARIX 400D',
  '["MARIX 400D","Marix 400D","마릭스 400D","마리쿠스 400D","MARIX Color movie NegaFilm 400D","Marix Color Negative 400D","Vision3 5207","5207 250D","marix400d"]'::jsonb,
  'Kodak Vision3 250D(5207) 의 remjet 을 걷어낸 한 롤. C-41 현상이 가능해 동네 사진관에서도 받아주는 시네 필름이며, remjet 제거로 권장 감도가 베이스보다 한 스톱 위인 ISO 400 으로 잡혀 있습니다. 한낮 야외에서 채도가 정돈된 시네마 톤을 가져오는 데 자주 거론되는 라인.',
  '400',
  'Daylight',
  '35mm',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'marix800t',
  'library',
  'MARIX',
  '800T',
  'MARIX 800T',
  '["MARIX 800T","Marix 800T","마릭스 800T","마리쿠스 800T","MARIX Color movie NegaFilm 800T","Marix Color Negative 800T","Vision3 5219","5219 500T","marix800t"]'::jsonb,
  'Kodak Vision3 500T(5219) 베이스, remjet 제거로 C-41 호환. 텅스텐 광원(3200K) 에 맞춰진 한 롤로, 데일라이트 광원 아래에서는 푸르스름하게 떨어지는 톤이 그대로 트레이드마크가 됩니다. 야간 도시 풍경과 인공조명 실내 reportage 에서 가장 많이 호명되는 라인.',
  '800',
  'Tungsten',
  '35mm',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;
