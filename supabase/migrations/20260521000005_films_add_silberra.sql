-- Silberra 라인 일괄 추가 (러시아 신규 필름 브랜드, 2017~).
-- B&W (PAN/Ultima 동일 substrate 의 두 패키지), U (가성비 라인),
-- Orta (오르토크로마틱), Color (C-41) 총 11종.
-- 출처: silberra.com 제품 페이지, PetaPixel 2021-05 컬러 라인 발표 기사 등.

-- ── B&W Panchromatic (PAN / Ultima 형제 패키지) ──
INSERT INTO public.films (slug, tier, brand, name, display_name, aliases, description, iso, type, format, photographers, photos, can_thumbnail, can_thumbnail_status)
VALUES (
  'silberrapan50', 'library', 'SILBERRA', 'PAN 50', 'Silberra PAN 50',
  '["Silberra PAN 50","Silberra Ultima 50","PAN50","Ultima 50","silberrapan50"]'::jsonb,
  '러시아 브랜드 Silberra 의 판크로마틱 흑백 네거티브 ISO 50. 미세 입자와 높은 해상력이 특징이며 동일 emulsion 이 프리미엄 패키지인 Ultima 50 으로도 풀립니다.',
  '50', 'Black and White Negative', '35mm', '[]'::jsonb, '[]'::jsonb, NULL, 'pending'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (slug, tier, brand, name, display_name, aliases, description, iso, type, format, photographers, photos, can_thumbnail, can_thumbnail_status)
VALUES (
  'silberrapan100', 'library', 'SILBERRA', 'PAN 100', 'Silberra PAN 100',
  '["Silberra PAN 100","Silberra Ultima 100","PAN100","Ultima 100","silberrapan100"]'::jsonb,
  'Silberra 의 판크로마틱 흑백 네거티브 ISO 100. PAN 시리즈의 표준 감도이며 동일 emulsion 이 Ultima 100 으로도 출시됩니다.',
  '100', 'Black and White Negative', '35mm', '[]'::jsonb, '[]'::jsonb, NULL, 'pending'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (slug, tier, brand, name, display_name, aliases, description, iso, type, format, photographers, photos, can_thumbnail, can_thumbnail_status)
VALUES (
  'silberrapan160', 'library', 'SILBERRA', 'PAN 160', 'Silberra PAN 160',
  '["Silberra PAN 160","Silberra Ultima 160","PAN160","Ultima 160","silberrapan160"]'::jsonb,
  'Silberra 의 판크로마틱 흑백 네거티브 ISO 160. Ultima 160 명칭으로도 풀리며 거친 듯 차분한 입자 톤이 특징입니다.',
  '160', 'Black and White Negative', '35mm', '[]'::jsonb, '[]'::jsonb, NULL, 'pending'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (slug, tier, brand, name, display_name, aliases, description, iso, type, format, photographers, photos, can_thumbnail, can_thumbnail_status)
VALUES (
  'silberrapan200', 'library', 'SILBERRA', 'PAN 200', 'Silberra PAN 200',
  '["Silberra PAN 200","Silberra Ultima 200","PAN200","Ultima 200","silberrapan200"]'::jsonb,
  'Silberra 의 한정판 판크로마틱 흑백 네거티브 ISO 200. Ultima 200 명칭으로도 풀립니다.',
  '200', 'Black and White Negative', '35mm', '[]'::jsonb, '[]'::jsonb, NULL, 'pending'
) ON CONFLICT (slug) DO NOTHING;

-- ── B&W U 시리즈 (Ultima 베이스의 가성비 라인) ──
INSERT INTO public.films (slug, tier, brand, name, display_name, aliases, description, iso, type, format, photographers, photos, can_thumbnail, can_thumbnail_status)
VALUES (
  'silberrau200', 'library', 'SILBERRA', 'U200', 'Silberra U200',
  '["Silberra U200","U200","silberrau200"]'::jsonb,
  'Ultima 와 같은 베이스에서 출발한 Silberra 의 가성비 흑백 네거티브. ISO 200 표준 노출 외 100·400 푸시·풀에서도 안정적입니다.',
  '200', 'Black and White Negative', '35mm', '[]'::jsonb, '[]'::jsonb, NULL, 'pending'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (slug, tier, brand, name, display_name, aliases, description, iso, type, format, photographers, photos, can_thumbnail, can_thumbnail_status)
VALUES (
  'silberrau400', 'library', 'SILBERRA', 'U400', 'Silberra U400',
  '["Silberra U400","U400","silberrau400"]'::jsonb,
  'Silberra U 시리즈의 ISO 400 흑백 네거티브. 동일 베이스로 푸시 여유가 있는 가성비 라인입니다.',
  '400', 'Black and White Negative', '35mm', '[]'::jsonb, '[]'::jsonb, NULL, 'pending'
) ON CONFLICT (slug) DO NOTHING;

-- ── B&W Orthochromatic (Orta) ──
INSERT INTO public.films (slug, tier, brand, name, display_name, aliases, description, iso, type, format, photographers, photos, can_thumbnail, can_thumbnail_status)
VALUES (
  'silberraorta50', 'library', 'SILBERRA', 'Orta 50', 'Silberra Orta 50',
  '["Silberra Orta 50","Orta 50","silberraorta50"]'::jsonb,
  'Silberra 의 오르토크로마틱 흑백 네거티브 ISO 50. 적색 비감광 특성으로 피부와 입술이 진해지는 클래식한 그레이 스케일을 만듭니다.',
  '50', 'Black and White Negative', '35mm', '[]'::jsonb, '[]'::jsonb, NULL, 'pending'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (slug, tier, brand, name, display_name, aliases, description, iso, type, format, photographers, photos, can_thumbnail, can_thumbnail_status)
VALUES (
  'silberraorta80', 'library', 'SILBERRA', 'Orta 80', 'Silberra Orta 80',
  '["Silberra Orta 80","Orta 80","silberraorta80"]'::jsonb,
  'Silberra 의 오르토크로마틱 흑백 네거티브 ISO 80. 그레이 스케일이 한 단계 부드럽고 라티튜드가 살짝 더 넓습니다.',
  '80', 'Black and White Negative', '35mm', '[]'::jsonb, '[]'::jsonb, NULL, 'pending'
) ON CONFLICT (slug) DO NOTHING;

-- ── Color (C-41) ──
INSERT INTO public.films (slug, tier, brand, name, display_name, aliases, description, iso, type, format, photographers, photos, can_thumbnail, can_thumbnail_status)
VALUES (
  'silberracolor50', 'library', 'SILBERRA', 'Color 50', 'Silberra Color 50',
  '["Silberra Color 50","Color 50","silberracolor50"]'::jsonb,
  '2021 년 발표된 Silberra 의 컨슈머 컬러 네거티브 한정판 ISO 50. C-41 현상이며 따뜻한 톤이 특징입니다.',
  '50', 'Color Negative', '35mm', '[]'::jsonb, '[]'::jsonb, NULL, 'pending'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (slug, tier, brand, name, display_name, aliases, description, iso, type, format, photographers, photos, can_thumbnail, can_thumbnail_status)
VALUES (
  'silberracolor100', 'library', 'SILBERRA', 'Color 100', 'Silberra Color 100',
  '["Silberra Color 100","Color 100","silberracolor100"]'::jsonb,
  'Silberra 의 컨슈머 컬러 네거티브 한정판 ISO 100. C-41 현상.',
  '100', 'Color Negative', '35mm', '[]'::jsonb, '[]'::jsonb, NULL, 'pending'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (slug, tier, brand, name, display_name, aliases, description, iso, type, format, photographers, photos, can_thumbnail, can_thumbnail_status)
VALUES (
  'silberracolor160', 'library', 'SILBERRA', 'Color 160', 'Silberra Color 160',
  '["Silberra Color 160","Color 160","silberracolor160"]'::jsonb,
  'Silberra 가 2021 년 풀어낸 컨슈머 컬러 네거티브 ISO 160. C-41 현상이며 따뜻한 톤이 특징입니다.',
  '160', 'Color Negative', '35mm', '[]'::jsonb, '[]'::jsonb, NULL, 'pending'
) ON CONFLICT (slug) DO NOTHING;
