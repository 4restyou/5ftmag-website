-- 캐니스터 썸네일 등록: Kodak Vision3 200T / Shanghai GP3 100 / GP3 400

UPDATE public.films
   SET can_thumbnail = 'img/films/vision3200t-can.webp',
       can_thumbnail_status = 'set'
 WHERE slug = 'vision3200t';

UPDATE public.films
   SET can_thumbnail = 'img/films/gp3100-can.webp',
       can_thumbnail_status = 'set'
 WHERE slug = 'gp3100';

UPDATE public.films
   SET can_thumbnail = 'img/films/gp3400-can.webp',
       can_thumbnail_status = 'set'
 WHERE slug = 'gp3400';
