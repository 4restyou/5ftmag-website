-- 캔 썸네일이 비어 있던 필름 5종에 캔 일러스트를 연결한다 (운영자 제공, 2026-09-30).
-- 파일은 img/films/<slug>-can.webp 로 사이트와 함께 배포된다. 경로만 적으므로 재적용해도 같다.
UPDATE public.films
   SET can_thumbnail = 'img/films/' || slug || '-can.webp',
       can_thumbnail_status = 'set'
 WHERE slug IN ('agfascala200x', 'tudorxlx100', 'tudorxlx200', 'opticolour200', 'ilfocolor400plus');
