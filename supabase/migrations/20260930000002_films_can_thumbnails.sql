-- 캔 썸네일이 비어 있던 필름 8종에 캔 일러스트를 연결한다 (운영자 제공, 2026-09-30).
-- 파일은 img/films/ 아래 webp 로 사이트와 함께 배포된다. 경로만 적으므로 재적용해도 같다.
UPDATE public.films
   SET can_thumbnail = 'img/films/' || slug || '-can.webp',
       can_thumbnail_status = 'set'
 WHERE slug IN ('agfascala200x', 'tudorxlx100', 'tudorxlx200', 'opticolour200', 'ilfocolor400plus');

-- 아래 세 필름은 관리 화면에서 등록돼 저장소의 films.json 사본에 없어 slug 를 모른다.
-- 그래서 이름으로 찾고, 파일명은 slug 와 무관하게 고정한다. 캔이 이미 지정된 행은 건드리지 않는다.
UPDATE public.films
   SET can_thumbnail = 'img/films/kodak-gt800-can.webp', can_thumbnail_status = 'set'
 WHERE brand ILIKE 'kodak' AND name ILIKE '%GT%800%'
   AND (can_thumbnail IS NULL OR can_thumbnail_status IS DISTINCT FROM 'set');

UPDATE public.films
   SET can_thumbnail = 'img/films/kodak-vision-2242-can.webp', can_thumbnail_status = 'set'
 WHERE brand ILIKE 'kodak' AND name ILIKE '%2242%'
   AND (can_thumbnail IS NULL OR can_thumbnail_status IS DISTINCT FROM 'set');

UPDATE public.films
   SET can_thumbnail = 'img/films/lucky-color400-can.webp', can_thumbnail_status = 'set'
 WHERE brand ILIKE 'lucky' AND name ILIKE '%color%400%'
   AND (can_thumbnail IS NULL OR can_thumbnail_status IS DISTINCT FROM 'set');
