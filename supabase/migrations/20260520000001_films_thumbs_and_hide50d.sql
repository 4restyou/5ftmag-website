-- 캐니스터 썸네일 17 종 등록 + Reflx Lab 50D 숨김
-- films 테이블에 is_hidden 컬럼 추가 (soft hide, 나중에 admin/films 에서 복원 가능).
-- 공개 page (films / home / me / admin-analytics) 는 is_hidden = false 만 노출.
-- admin/films 페이지는 listAll() 로 전부 보고 토글.

ALTER TABLE public.films
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS films_is_hidden_idx ON public.films (is_hidden);

-- 썸네일 일괄 등록
UPDATE public.films SET can_thumbnail = 'img/films/wolfennc400-can.webp',     can_thumbnail_status = 'set' WHERE slug = 'wolfennc400';
UPDATE public.films SET can_thumbnail = 'img/films/yashicabw400-can.webp',     can_thumbnail_status = 'set' WHERE slug = 'yashicabw400';
UPDATE public.films SET can_thumbnail = 'img/films/yashicacolor400-can.webp',  can_thumbnail_status = 'set' WHERE slug = 'yashicacolor400';
UPDATE public.films SET can_thumbnail = 'img/films/yashicagolden80s-can.webp', can_thumbnail_status = 'set' WHERE slug = 'yashicagolden80s';
UPDATE public.films SET can_thumbnail = 'img/films/retoaqua400-can.webp',      can_thumbnail_status = 'set' WHERE slug = 'retoaqua400';
UPDATE public.films SET can_thumbnail = 'img/films/retoglow400-can.webp',      can_thumbnail_status = 'set' WHERE slug = 'retoglow400';
UPDATE public.films SET can_thumbnail = 'img/films/retoprism400-can.webp',     can_thumbnail_status = 'set' WHERE slug = 'retoprism400';
UPDATE public.films SET can_thumbnail = 'img/films/reflxlab250d-can.webp',     can_thumbnail_status = 'set' WHERE slug = 'reflxlab250d';
UPDATE public.films SET can_thumbnail = 'img/films/reflxlab320d-can.webp',     can_thumbnail_status = 'set' WHERE slug = 'reflxlab320d';
UPDATE public.films SET can_thumbnail = 'img/films/reflxlab400d-can.webp',     can_thumbnail_status = 'set' WHERE slug = 'reflxlab400d';
UPDATE public.films SET can_thumbnail = 'img/films/reflxlab800t-can.webp',     can_thumbnail_status = 'set' WHERE slug = 'reflxlab800t';
UPDATE public.films SET can_thumbnail = 'img/films/fndsora200-can.webp',       can_thumbnail_status = 'set' WHERE slug = 'fndsora200';
UPDATE public.films SET can_thumbnail = 'img/films/fndumi800-can.webp',        can_thumbnail_status = 'set' WHERE slug = 'fndumi800';
UPDATE public.films SET can_thumbnail = 'img/films/fndkumo250d-can.webp',      can_thumbnail_status = 'set' WHERE slug = 'fndkumo250d';
UPDATE public.films SET can_thumbnail = 'img/films/zombie400-can.webp',        can_thumbnail_status = 'set' WHERE slug = 'zombie400';
UPDATE public.films SET can_thumbnail = 'img/films/fndiro400-can.webp',        can_thumbnail_status = 'set' WHERE slug = 'fndiro400';
UPDATE public.films SET can_thumbnail = 'img/films/fndkiro400-can.webp',       can_thumbnail_status = 'set' WHERE slug = 'fndkiro400';

-- Reflx Lab 50D 숨김
UPDATE public.films SET is_hidden = true WHERE slug = 'reflxlab50d';
