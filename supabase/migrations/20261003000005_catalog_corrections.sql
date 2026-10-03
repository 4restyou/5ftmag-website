-- 확인된 공개 카탈로그 오기만 교정한다. 운영자가 이미 수정한 값은 덮어쓰지 않는다.
UPDATE public.webzine_issues
SET title = 'Kodak Ektachrome E100', updated_at = now()
WHERE slug = 'vol-6' AND title = 'Kodak Ektarchrome E100';

UPDATE public.webzine_issues
SET title = 'Lomography Color Negative Series', updated_at = now()
WHERE slug = 'vol-05' AND title = 'Lomography Color Nagative Series';

UPDATE public.webzine_issues
SET title = 'Ilford Delta Series', updated_at = now()
WHERE slug = 'vol-04' AND title = 'Illford Delta Series';

-- 기존 출판 표지와 PDF는 원본 기록으로 보존한다.
UPDATE public.repair_shops
SET url = 'https://polazone.com/'
WHERE name = '폴라존' AND url = '홈페이지 http://www.polazone.com/';
