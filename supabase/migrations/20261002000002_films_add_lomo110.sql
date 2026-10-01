-- 필름 추가: Lomography 110 포켓 필름 4종 (운영자 요청, 2026-10-01). 캔 그림은 운영자가 준 것.
--
-- 확인한 사실 (Lomography 제품 표기·캔 그림)
--   - 모두 110 포맷 24컷
--   - B&W Orca 110: ISO 100 흑백 네거티브
--   - Color Tiger 110: ISO 200 컬러 네거티브(C-41)
--   - Lobster Redscale 110: ISO 200 레드스케일(C-41)
--   - X-Pro Peacock 110: ISO 200 컬러 슬라이드, 교차 현상(C-41)용으로 나온 필름
-- slug 중복은 ON CONFLICT 로 막아 replay-safe. 한·영·일 소개글을 함께 넣는다.

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, description_en, description_ja, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'lomoorca110', 'library', 'LOMOGRAPHY', $f$B&W Orca 110$f$, $f$Lomography B&W Orca 110$f$,
  $f$["Orca 110", "Lomography Orca", "Lomography Orca 110", "Lomography B&W Orca", "Black & White Orca 110", "Orca B&W 110", "로모 오르카", "로모그래피 오르카", "오르카 110", "lomoorca110"]$f$::jsonb,
  $f$Lomography 의 110 포켓 필름 흑백. ISO 100 이라 해가 좋은 날 작은 110 카메라로 쓰기 좋고, 작은 프레임에서도 입자가 고운 편이에요. 일반 흑백 현상, 24컷.$f$,
  $f$Lomography's black-and-white 110 pocket film. At ISO 100 it suits small 110 cameras on sunny days, and the grain stays fairly fine even on the tiny frame. Standard black-and-white processing, 24 exposures.$f$,
  $f$Lomographyの110ポケットフィルムのモノクロ。ISO 100なので晴れた日に小さな110カメラで使いやすく、小さなコマでも粒子は比較的細かい。一般的なモノクロ現像、24枚撮り。$f$,
  '100', $f$Black & White$f$, '110',
  '[]'::jsonb, '[]'::jsonb, 'img/films/lomoorca110-can.webp', 'set'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, description_en, description_ja, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'lomotiger110', 'library', 'LOMOGRAPHY', $f$Color Tiger 110$f$, $f$Lomography Color Tiger 110$f$,
  $f$["Tiger 110", "Lomography Tiger", "Lomography Tiger 110", "Lomography Color Tiger", "Color Tiger 110", "로모 타이거", "로모그래피 타이거", "타이거 110", "lomotiger110"]$f$::jsonb,
  $f$Lomography 의 110 포켓 필름 컬러 네거티브. ISO 200 이라 야외와 밝은 실내를 두루 다루고, 장난감 같은 110 카메라에 넣고 가볍게 찍기 좋아요. C-41 현상, 24컷.$f$,
  $f$Lomography's color negative 110 pocket film. At ISO 200 it covers outdoors and bright interiors, and it's an easy roll to drop into a toy-like 110 camera. C-41 processing, 24 exposures.$f$,
  $f$Lomographyの110ポケットフィルムのカラーネガ。ISO 200で屋外から明るい室内まで幅広く使え、おもちゃのような110カメラに入れて気軽に撮るのに向く。C-41現像、24枚撮り。$f$,
  '200', $f$Color Negative$f$, '110',
  '[]'::jsonb, '[]'::jsonb, 'img/films/lomotiger110-can.webp', 'set'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, description_en, description_ja, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'lomolobster110', 'library', 'LOMOGRAPHY', $f$Lobster Redscale 110$f$, $f$Lomography Lobster Redscale 110$f$,
  $f$["Lobster 110", "Lobster Redscale", "Lomography Lobster", "Lomography Lobster Redscale 110", "Redscale 110", "로모 랍스터", "로모그래피 랍스터", "랍스터 레드스케일", "레드스케일 110", "lomolobster110"]$f$::jsonb,
  $f$Lomography 의 110 레드스케일 필름. 컬러 네거티브를 뒤집어 감아 베이스 쪽으로 빛을 받게 해, 빨강·주황·노랑이 짙게 깔린 사진이 나와요. ISO 200, C-41 현상, 24컷.$f$,
  $f$Lomography's redscale 110 film. A color negative is wound backwards so light hits it through the base, giving pictures soaked in red, orange and yellow. ISO 200, C-41 processing, 24 exposures.$f$,
  $f$Lomographyの110レッドスケールフィルム。カラーネガを裏返しに巻いてベース側から光を受けるため、赤・オレンジ・黄色が濃くのった写真になる。ISO 200、C-41現像、24枚撮り。$f$,
  '200', $f$Color Negative$f$, '110',
  '[]'::jsonb, '[]'::jsonb, 'img/films/lomolobster110-can.webp', 'set'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, description_en, description_ja, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'lomopeacock110', 'library', 'LOMOGRAPHY', $f$X-Pro Peacock 110$f$, $f$Lomography X-Pro Peacock 110$f$,
  $f$["Peacock 110", "X-Pro Peacock", "Lomography Peacock", "Lomography X-Pro Peacock 110", "Peacock X-Pro 110", "로모 피콕", "로모그래피 피콕", "피콕 110", "lomopeacock110"]$f$::jsonb,
  $f$Lomography 의 110 컬러 슬라이드 필름. 이름의 X-Pro 처럼 C-41 로 교차 현상하면 채도가 세고 색이 틀어진 사진이 나와요. ISO 200, 24컷.$f$,
  $f$Lomography's color slide 110 film. As the X-Pro in the name suggests, cross-processing it in C-41 gives strong saturation and shifted colors. ISO 200, 24 exposures.$f$,
  $f$Lomographyの110カラースライドフィルム。名前のX-Proのとおり、C-41でクロス現像すると彩度が強く色がずれた写真になる。ISO 200、24枚撮り。$f$,
  '200', $f$Slide (E-6)$f$, '110',
  '[]'::jsonb, '[]'::jsonb, 'img/films/lomopeacock110-can.webp', 'set'
) ON CONFLICT (slug) DO NOTHING;
