-- 영화용 / 일본·동남아 신생 라인업 8 종 추가 (Reflx Lab 3 + Wolfen NC400 + Zombie 400 + Yashica 3)

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'reflxlab800t',
  'library',
  'REFLX LAB',
  '800T',
  'Reflx Lab 800T',
  '["Reflx Lab 800T","Reflx 800T","Reflxlab 800T","Vision3 5219 remjet","Kodak 5219 800T","5219 800T","리플렉스랩 800T","리플렉스 800T","레플렉스랩 800T","reflxlab800t"]'::jsonb,
  'Shenzhen Reflx Lab 이 Kodak Vision3 5219(500T) 의 remjet 을 벗기고 ISO 800 으로 푸시해 다시 감은 한 롤. 야간 거리와 텅스텐 광원에서 시네마톤을 가장 저렴하게 만나는 길로 자주 호명됩니다. C-41.',
  '800',
  'Tungsten',
  '35mm, 120',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'reflxlab400d',
  'library',
  'REFLX LAB',
  '400D',
  'Reflx Lab 400D',
  '["Reflx Lab 400D","Reflx 400D","Reflxlab 400D","Vision3 5207 remjet","Kodak 5207 400D","5207 400D","리플렉스랩 400D","reflxlab400d"]'::jsonb,
  'Vision3 5207(250D) 의 remjet 을 벗기고 한 스탑 푸시해 ISO 400 데일라이트로 재포장한 한 롤. 잔여 halation 이 빛 새는 한낮을 부드럽게 감쌉니다. C-41.',
  '400',
  'Color Negative',
  '35mm, 120',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'reflxlab320d',
  'library',
  'REFLX LAB',
  '320D',
  'Reflx Lab 320D',
  '["Reflx Lab 320D","Reflx 320D","Reflxlab 320D","Vision3 5207 AHU","Kodak 5207 AHU 320D","리플렉스랩 320D","reflxlab320d"]'::jsonb,
  'Kodak 이 새로 출시한 AHU(anti-halation undercoat) 처리된 5207 을 ISO 320 으로 재포장. remjet 도 halation 도 없이 Portra 400 비슷한 결을 C-41 으로 받아낼 수 있는 한 롤입니다.',
  '320',
  'Color Negative',
  '35mm, 120',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'wolfennc400',
  'library',
  'ORWO',
  'Wolfen NC400',
  'ORWO Wolfen NC400',
  '["Wolfen NC400","ORWO Wolfen NC400","ORWO NC400","NC400","울펜 NC400","오르보 울펜 NC400","orwowolfennc400","wolfennc400"]'::jsonb,
  'NC500 의 자매 — 같은 동독 영화 emulsion 계보에서 한 스탑 낮춘 ISO 400 의 컬러 네거티브. 거친 입자와 풍부한 톤이 자연광 거리 사진에 자주 호명됩니다.',
  '400',
  'Color Negative',
  '35mm, 120',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'zombie400',
  'library',
  'FILMNEVERDIE',
  'Zombie 400',
  'FilmNeverDie × Mr. Negative Zombie 400',
  '["Zombie 400","FilmNeverDie Zombie 400","Mr Negative Zombie 400","Mr. Negative Zombie 400","좀비 400","좀비필름 400","필름네버다이 좀비 400","zombie400","mrnegativezombie400"]'::jsonb,
  '말레이시아 FilmNeverDie 가 사진가 Mr. Negative 와 협업한 ISO 400 컬러 네거티브. 채도를 빼고 입자를 또렷하게 살린 "바랜 호러" 룩이 일본·동남아 컬렉터에서 인기 있는 한 롤. C-41.',
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
  'yashicacolor400',
  'library',
  'YASHICA',
  'Color 400',
  'Yashica Color 400',
  '["Yashica Color 400","Yashica 400","Yashica 400 Color","야시카 컬러 400","야시카 400 컬러","yashicacolor400"]'::jsonb,
  'Yashica 가 MF-1 카메라와 함께 다시 풀어놓은 ISO 400 컬러 네거티브. 따뜻하게 기우는 톤과 부드러운 입자가 인물·일상 스냅에 어울리는 한 롤. C-41.',
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
  'yashicabw400',
  'library',
  'YASHICA',
  'Black & White 400',
  'Yashica Black & White 400',
  '["Yashica Black White 400","Yashica B&W 400","Yashica BW 400","Yashica 400 BW","야시카 흑백 400","야시카 400 흑백","yashicabw400"]'::jsonb,
  'Yashica MF-1 라인의 흑백 ISO 400. 강한 콘트라스트로 거리 스냅에 어울린다는 평이 있는 한 롤입니다.',
  '400',
  'Black & White',
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
  'yashicagolden80s',
  'library',
  'YASHICA',
  'Golden 80s',
  'Yashica Golden 80s',
  '["Yashica Golden 80s","Yashica Golden 80","Yashica Golden","Golden 80s","야시카 골든 80s","야시카 골든","yashicagolden80s"]'::jsonb,
  'Yashica 한정판 컬러 ISO 400. 80년대 분위기를 노려 채도를 크게 끌어올린 톤과 강한 입자로 자연광 데일리 스냅에 자주 호명됩니다. C-41.',
  '400',
  'Color Negative',
  '35mm',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

