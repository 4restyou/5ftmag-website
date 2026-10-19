-- 필름 추가: CANDIDO 800, Foma Ortho 400 (구독자 제안, 2026-10-11·12 접수)
-- 그리고 PINCARY SHD400 제안은 새 필름을 만들지 않고 카탈로그의 Lucky SHD 400(luckyshd400)으로 잇는다(운영자 결정).
--
-- 확인한 사실
--   CANDIDO 800 (Blue Moon Camera·Focus Nordic·PetaPixel 2026-02)
--     - 영국 Candido Collective, 코닥 Vision3 500T 영화용 필름에서 렘젯을 벗겨 C-41 일반 현상이 되게 감은 것
--     - 텅스텐 밸런스, ISO 800 으로 매김(원래 500), 렘젯이 없어 강한 빛 둘레에 헐레이션
--   Foma Ortho 400 (Foma 공식·Kosmo Foto)
--     - 체코 Foma 의 ISO 400 정색성(orthochromatic) 흑백 네거티브, 120 은 2023년 6월·35mm 는 2024년 5월
--     - 빨간빛에 거의 반응하지 않고 초록에 민감, 고운 입자·높은 선예도, 585nm 이상 안전광 아래서 잠깐 다룰 수 있음
--     - +1.5EV(ISO 160)~-2EV(ISO 1600)에서도 좋은 결과(제조사 설명)
-- 캔 썸네일은 아직 없어 pending. slug 중복은 ON CONFLICT 로 막아 replay-safe.

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, description_en, description_ja,
  iso, type, format, photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'candido800', 'library', 'CANDIDO', 'CANDIDO 800', 'CANDIDO 800',
  '["candido800","candido 800","Candido 800","CANDIDO800","Candido Candido800","Candido Collective 800","칸디도 800","칸디도800"]'::jsonb,
  $ko$영국 Candido Collective 의 컬러 네거티브예요. 코닥 Vision3 500T 영화용 필름에서 렘젯 층을 벗겨, 일반 C-41 현상소에 맡길 수 있게 감았습니다. 텅스텐 밸런스라 실내 조명과 밤거리에 잘 맞고, 원래 감도 500 보다 높은 ISO 800 으로 매겨져 있어요. 렘젯이 없어 가로등 같은 강한 빛 둘레에 붉은 번짐(헐레이션)이 생깁니다.$ko$,
  $en$A color negative from the UK's Candido Collective. It's Kodak Vision3 500T motion picture film with the remjet layer removed, so any regular C-41 lab can process it. Tungsten balanced, it suits indoor light and night streets, and it's rated at ISO 800, above the stock's native 500. With no remjet, strong lights such as street lamps pick up a red halation glow.$en$,
  $ja$英国Candido Collectiveのカラーネガ。Kodak Vision3 500Tのシネフィルムからリムジェット層を除去しており、一般的なC-41現像に出せる。タングステンバランスで室内照明や夜の街に向き、本来の感度500より高いISO 800に設定されている。リムジェットがないため、街灯のような強い光のまわりに赤いハレーションが出る。$ja$,
  '800', 'Color Negative', '35mm', '[]'::jsonb, '[]'::jsonb, NULL, 'pending'
), (
  'fomaortho400', 'library', 'FOMA', 'Ortho 400', 'Foma Ortho 400',
  '["Foma Ortho 400","Foma ortho 400","Fomapan Ortho 400","Foma Ortho","Ortho 400","FomaOrtho 400","포마 오르토 400","포마 오소 400","포마오르토400","fomaortho400"]'::jsonb,
  $ko$체코 Foma 의 ISO 400 정색성(오르토) 흑백 필름이에요. 빨간빛에 거의 반응하지 않아 빨강이 짙게 가라앉고, 초록에는 민감해 나뭇잎과 풍경이 또렷하게 나옵니다. 입자가 곱고 선예도가 높으며, 585nm 이상의 안전광 아래에서 잠깐 다룰 수 있어요. 제조사는 ISO 160 부터 1600 까지 노출해도 좋은 결과가 나온다고 설명합니다. 120 은 2023년, 35mm 는 2024년에 나왔어요.$ko$,
  $en$An ISO 400 orthochromatic black-and-white film from Czech maker Foma. It barely responds to red light, so reds go deep and dark, while its green sensitivity keeps foliage and landscapes crisp. Grain is fine and sharpness high, and it can be handled briefly under safelight of 585 nm or longer. Foma says it gives good results exposed anywhere from ISO 160 to 1600. The 120 version arrived in 2023 and 35mm in 2024.$en$,
  $ja$チェコFomaのISO 400オルソクロマチック(整色性)モノクロフィルム。赤い光にほとんど感光しないため赤は深く沈み、緑には敏感で木の葉や風景がくっきり写る。粒子は細かくシャープネスが高く、585nm以上のセーフライト下なら短時間扱える。メーカーはISO 160から1600まで露光しても良い結果が得られるとしている。120は2023年、35mmは2024年に登場した。$ja$,
  '400', 'Black & White', '35mm, 120', '[]'::jsonb, '[]'::jsonb, NULL, 'pending'
) ON CONFLICT (slug) DO NOTHING;

-- Pincary SHD400 을 Lucky SHD 400 의 다른 이름으로 더한다(검색·독자 사진 필름 이름 연결). 이미 있으면 그대로.
UPDATE public.films
   SET aliases = aliases || '["Pincary SHD400","PINCARY SHD400","Pincary SHD 400","Pincary 400","핀카리 SHD400","핀카리 SHD 400"]'::jsonb
 WHERE slug = 'luckyshd400' AND NOT aliases ? 'Pincary SHD400';

-- 대기 중 제안을 승인 처리하고 신청자에게 관리 화면과 같은 알림을 보낸다. pending 만 바꾸므로 다시 적용해도 알림이 두 번 가지 않는다.
WITH approved AS (
  UPDATE public.film_proposals p
     SET status = 'approved', reviewed_at = now(),
         approved_slug = m.slug,
         reviewer_notes = m.note
    FROM (VALUES
      ('%candido800%', 'candido800', NULL),
      ('%fomaortho400%', 'fomaortho400', NULL),
      ('%pincaryshd400%', 'luckyshd400', 'Lucky SHD 400 으로 등록돼 있어요')
    ) AS m(pattern, slug, note)
   WHERE p.status = 'pending'
     AND lower(regexp_replace(coalesce(p.brand, '') || ' ' || coalesce(p.name, ''), '\s+', '', 'g')) LIKE m.pattern
  RETURNING p.id, p.user_id, p.brand, p.name, m.slug, m.note
)
INSERT INTO public.user_notifications (user_id, type, related_id, title, body, link)
SELECT user_id, 'proposal_approved', id, '신청하신 필름이 등록됐어요',
       left(brand || ' ' || name || coalesce(' · ' || note, ''), 500), '/films.html#film-' || slug
  FROM approved;
