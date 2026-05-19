-- FilmNeverDie 라인업 6종 추가 (IRO 200/400, KIRO 400, SORA 200, UMI 800, KUMO 250D)

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'fndiro200',
  'library',
  'FILMNEVERDIE',
  'IRO 200',
  'FilmNeverDie IRO 200',
  '["IRO 200","FilmNeverDie IRO 200","FND IRO 200","이로 200","필름네버다이 이로 200","fndiro200"]'::jsonb,
  '말레이시아 FilmNeverDie 가 2018년 처음 내놓은 컬러 네거티브. "색(이로)" 이라는 이름대로 호주·아시아 시장에서 한 번 빠르게 매진되었던 한 롤로, 현재는 단종이지만 IRO 라인의 정체성을 만든 시작점입니다.',
  '200',
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
  'fndiro400',
  'library',
  'FILMNEVERDIE',
  'IRO 400',
  'FilmNeverDie IRO 400',
  '["IRO 400","FilmNeverDie IRO 400","FND IRO 400","이로 400","필름네버다이 이로 400","fndiro400"]'::jsonb,
  'IRO 시리즈의 두 번째 에디션. 39 컷 한 롤에 채도가 살아 있는 또렷한 색과 부드러운 입자로, 자연광 스냅과 거리 사진에 자주 호명됩니다. C-41.',
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
  'fndkiro400',
  'library',
  'FILMNEVERDIE',
  'KIRO 400',
  'FilmNeverDie KIRO 400',
  '["KIRO 400","FilmNeverDie KIRO 400","FND KIRO 400","키로 400","필름네버다이 키로 400","fndkiro400"]'::jsonb,
  '"키로(노랑)" 라는 이름대로 톤이 따뜻한 쪽으로 기운 27 컷 한 롤. IRO 의 자매 라인으로 한낮의 햇살을 한층 더 노랗게 옮기는 데일라이트 필름입니다. C-41.',
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
  'fndsora200',
  'library',
  'FILMNEVERDIE',
  'SORA 200',
  'FilmNeverDie SORA 200',
  '["SORA 200","FilmNeverDie SORA 200","FND SORA 200","소라 200","하늘 200","필름네버다이 소라 200","fndsora200"]'::jsonb,
  '"소라(하늘)" 라는 이름대로 데일라이트 광원을 잘 받는 ISO 200, 36 컷의 컬러 네거티브. 청량한 청량톤과 가지런한 입자가 풍경·여행 사진에 어울리는 한 롤입니다. C-41.',
  '200',
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
  'fndumi800',
  'library',
  'FILMNEVERDIE',
  'UMI 800',
  'FilmNeverDie UMI 800',
  '["UMI 800","FilmNeverDie UMI 800","FND UMI 800","우미 800","바다 800","필름네버다이 우미 800","fndumi800"]'::jsonb,
  '"우미(바다)" 라는 이름의 ISO 800, 36 컷. 야간과 저조도에 맞춰 푸르스름한 톤과 풍부한 그림자를 한 롤에 담아내, 도시 야경 reportage 에 자주 거론됩니다. C-41.',
  '800',
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
  'fndkumo250d',
  'library',
  'FILMNEVERDIE',
  'KUMO 250D',
  'FilmNeverDie KUMO 250D',
  '["KUMO 250D","FilmNeverDie KUMO 250D","FND KUMO 250D","쿠모 250D","구름 250D","필름네버다이 쿠모 250D","Vision3 5207","5207 250D","fndkumo250d"]'::jsonb,
  '"쿠모(구름)" — Kodak Vision3 5207(250D) 영화 필름의 원본을 그대로 다시 감은 ECN-2 데일라이트 한 롤. remjet 그대로라 ECN-2 현상이 정공법이며, 한낮의 시네마 톤을 가장 가까이 가져오는 길입니다.',
  '250',
  'Color Negative',
  '35mm',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

