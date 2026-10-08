-- 필름 추가: Fujifilm Fujicolor Superia 100 (독자 제안, 운영자 요청 2026-10-08). 캔 그림은 운영자가 준 것.
--
-- 카탈로그의 Fujicolor 100(fujifilm100)과는 다른 제품이다.
--   - Superia 100: 1998년 무렵 나온 Superia 라인의 ISO 100. 2009년 무렵 단종(해는 자료마다 다르다).
--   - Fujicolor 100: Superia 와 별개인 저가 라인, 옛 설계. 일본 내수용으로 팔린다.
-- 따로 두어야 이 필름으로 찍은 사진이 Fujicolor 100 롤에 섞이지 않는다. "수페리아 100" 같은 별칭은
-- 이쪽에만 둔다. slug 중복은 ON CONFLICT 로 막아 재실행 안전.

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, description_en, description_ja, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'fujisuperia100', 'library', 'FUJIFILM', $f$Fujicolor Superia 100$f$, $f$Fujifilm Fujicolor Superia 100$f$,
  $f$["Superia 100", "Fujicolor Superia 100", "Fuji Superia 100", "Fujifilm Superia 100", "Superia100", "수페리아 100", "수페리아100", "후지 수페리아 100", "후지필름 수페리아 100", "후지컬러 수페리아 100", "fujisuperia100", "superia100"]$f$::jsonb,
  $f$Fujifilm Superia 라인의 ISO 100 컬러 네거티브. 같은 ISO 의 Fujicolor 100 과는 다른 필름으로, 2009년 무렵 단종돼 지금은 유통기한이 지난 재고로만 만날 수 있어요. 오래된 롤은 색이 틀어지거나 감도가 떨어질 수 있어 한 스톱쯤 넉넉히 주는 편이 안전합니다. C-41 현상.$f$,
  $f$An ISO 100 color negative from Fujifilm's Superia line. It is a different film from Fujicolor 100 of the same speed. It was discontinued around 2009, so today it turns up only as expired stock. Old rolls can shift color or lose speed, so giving it about a stop of extra exposure is the safer bet. C-41 processing.$f$,
  $f$FujifilmのSuperiaラインのISO 100カラーネガ。同じISOのFujicolor 100とは別のフィルムで、2009年ごろに生産終了し、いまは期限切れの在庫でしか出会えない。古いロールは色がずれたり感度が落ちたりすることがあるので、1段ほど多めに露光すると安心。C-41現像。$f$,
  '100', $f$Color Negative$f$, '35mm',
  '[]'::jsonb, '[]'::jsonb, 'img/films/fujisuperia100-can.webp', 'set'
) ON CONFLICT (slug) DO NOTHING;

-- 이 필름을 제안한 대기 중 신청을 승인 처리하고, 신청자에게 관리 화면과 같은 알림을 보낸다.
-- 대기(pending) 상태인 것만 바꾸므로 다시 적용해도 알림이 두 번 가지 않는다(20260930000001 과 같다).
WITH approved AS (
  UPDATE public.film_proposals
     SET status = 'approved', approved_slug = 'fujisuperia100', reviewed_at = now()
   WHERE status = 'pending'
     AND lower(regexp_replace(coalesce(brand, '') || ' ' || coalesce(name, ''), '\s+', '', 'g')) LIKE '%superia100%'
  RETURNING id, user_id, brand, name
)
INSERT INTO public.user_notifications (user_id, type, related_id, title, body, link)
SELECT user_id, 'proposal_approved', id, '신청하신 필름이 등록됐어요',
       left(brand || ' ' || name, 500), '/films.html#film-fujisuperia100'
  FROM approved;

NOTIFY pgrst, 'reload schema';
