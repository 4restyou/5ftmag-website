-- 영화 base 필름들의 type 을 'Color Negative' → 'Daylight' 로 정정.
-- films-page.js 의 filterCategoryOf 가 type 에 'daylight'/'tungsten'/'cinema'
-- 키워드가 있을 때 cinema 카테고리로 분류하므로, 같은 카테고리 안에
-- 묶여 보이도록 정렬.

UPDATE public.films SET type = 'Daylight' WHERE slug = 'reflxlab400d';
UPDATE public.films SET type = 'Daylight' WHERE slug = 'reflxlab320d';
UPDATE public.films SET type = 'Daylight' WHERE slug = 'reflxlab250d';
UPDATE public.films SET type = 'Daylight' WHERE slug = 'reflxlab50d';
UPDATE public.films SET type = 'Daylight' WHERE slug = 'wolfennc500';
UPDATE public.films SET type = 'Daylight' WHERE slug = 'wolfennc400';
UPDATE public.films SET type = 'Daylight' WHERE slug = 'fndkumo250d';
