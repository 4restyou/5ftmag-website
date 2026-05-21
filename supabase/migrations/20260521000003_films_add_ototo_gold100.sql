-- Fujicolor 오토오토 200 (한국 시장 한정 컨슈머 라인) + Kodak Gold 100 (1986-2000s 컨슈머).
-- 사실 확인 출처: Fujifilm Korea 빈티지 박스 / Kodacolor Wikipedia / Kodak 공식 카탈로그 (단종).

-- ── Fujicolor 오토오토 200 ──
INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'fujiototo200',
  'library',
  'FUJIFILM',
  '오토오토 200',
  'Fujicolor 오토오토 200',
  '["Fujicolor 오토오토 200","후지칼라 오토오토 200","오토오토 200","Fujifilm Auto Auto 200","Fujicolor Auto Auto 200","오토오토","fujiototo200"]'::jsonb,
  '후지필름이 1990 년대 한국 시장에 자동카메라(point-and-shoot)용으로 풀었던 ISO 200 컬러 네거티브. 박스에 한글로만 표기되어 있어 한국 한정 라인으로 정착했고 현재는 단종된 한 롤입니다.',
  '200',
  'Color Negative',
  '35mm',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

-- ── Kodak Gold 100 ──
INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'kodakgold100',
  'library',
  'KODAK',
  'Gold 100',
  'Kodak Gold 100',
  '["Kodak Gold 100","Kodacolor Gold 100","Kodacolor VR-G 100","Gold 100","코닥 골드 100","kodakgold100"]'::jsonb,
  'Kodacolor VR-G 100 으로 1986 년 출시되어 1989 년 Kodacolor Gold 100, 1997 년 Kodak Gold 100 으로 이름이 바뀌면서 컨슈머 컬러 라인을 지탱했습니다. 2000 년대 초 단종되어 현재는 냉동 재고로만 만나는 한 롤이며, 35mm 와 120 두 포맷으로 풀렸습니다.',
  '100',
  'Color Negative',
  '35mm, 120',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;
