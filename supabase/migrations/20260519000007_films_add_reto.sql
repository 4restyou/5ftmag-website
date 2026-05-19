-- Reto Project 3 종 추가
-- Retocolor Glow 400 / Aqua 400 / Prism 400

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'retoglow400',
  'library',
  'RETO',
  'Retocolor Glow 400',
  'Reto Retocolor Glow 400',
  '["Retocolor Glow 400","Reto Glow 400","Reto Color Glow 400","Reto Glow","Glow 400","Retcolor Glow 400","레토 글로우 400","레토컬러 글로우 400","글로우 400","retoglow400"]'::jsonb,
  '홍콩 Reto 가 2023년 내놓은 ISO 400 컬러 네거티브. 27 컷 한 롤에 바랜 따뜻한 톤과 낮은 콘트라스트로 도시의 오후를 시네마톤으로 옮기는 한 롤입니다. C-41.',
  '400',
  'Color Negative',
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
  'retoaqua400',
  'library',
  'RETO',
  'Retocolor Aqua 400',
  'Reto Retocolor Aqua 400',
  '["Retocolor Aqua 400","Reto Aqua 400","Reto Color Aqua 400","Reto Aqua","Aqua 400","레토 아쿠아 400","레토컬러 아쿠아 400","아쿠아 400","retoaqua400"]'::jsonb,
  'Glow 의 자매. 같은 27 컷 한 롤에 푸르스름하게 식은 톤과 거친 그레인으로 빛이 강한 한낮을 차갑게 옮깁니다. C-41.',
  '400',
  'Color Negative',
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
  'retoprism400',
  'library',
  'RETO',
  'Retocolor Prism 400',
  'Reto Retocolor Prism 400',
  '["Retocolor Prism 400","Reto Prism 400","Reto Color Prism 400","Reto Prism","Prism 400","레토 프리즘 400","레토컬러 프리즘 400","프리즘 400","retoprism400"]'::jsonb,
  'Reto 라인업 중 가장 또렷한 한 롤. 36 컷, 미세한 입자에 중간에서 높은 콘트라스트, 채도가 살아있어 vintage 라기보다는 또렷한 데일리 색감을 줍니다. C-41.',
  '400',
  'Color Negative',
  '35mm',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;
