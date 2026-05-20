-- IRO 200 캐니스터 썸네일 등록 + IRO 400 일러스트 교체
-- IRO 400 의 경로는 이전과 동일하지만 파일 내용 교체 (정식 일러스트).

UPDATE public.films
   SET can_thumbnail = 'img/films/fndiro200-can.webp',
       can_thumbnail_status = 'set'
 WHERE slug = 'fndiro200';

-- fndiro400 는 PR #166 에서 이미 같은 경로로 set 상태. 멱등.
UPDATE public.films
   SET can_thumbnail = 'img/films/fndiro400-can.webp',
       can_thumbnail_status = 'set'
 WHERE slug = 'fndiro400';
