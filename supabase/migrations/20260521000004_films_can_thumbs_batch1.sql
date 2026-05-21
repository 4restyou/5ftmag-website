-- 13개 라인의 캔(캐니스터) 썸네일 일괄 등록.
-- 매칭 전략: slug 추측이 정확하면 그대로, 아니면 brand+name 폴백 (이미 set 된
-- 행은 두 번째 분기에서 제외해 오작동 방지).

-- ── ADOX ─────────────────────────────────────────────
UPDATE public.films
SET can_thumbnail = 'img/films/adoxcms20ii-can.webp', can_thumbnail_status = 'set'
WHERE slug = 'adoxcms20ii'
   OR (can_thumbnail IS NULL AND brand ILIKE 'ADOX' AND name ILIKE '%CMS 20%');

UPDATE public.films
SET can_thumbnail = 'img/films/adoxscala50-can.webp', can_thumbnail_status = 'set'
WHERE slug = 'adoxscala50'
   OR (can_thumbnail IS NULL AND brand ILIKE 'ADOX' AND name ILIKE 'Scala 50%');

UPDATE public.films
SET can_thumbnail = 'img/films/adoxscala160-can.webp', can_thumbnail_status = 'set'
WHERE slug = 'adoxscala160'
   OR (can_thumbnail IS NULL AND brand ILIKE 'ADOX' AND name ILIKE 'Scala 160%');

UPDATE public.films
SET can_thumbnail = 'img/films/adoxsilvermax100-can.webp', can_thumbnail_status = 'set'
WHERE slug = 'adoxsilvermax100'
   OR (can_thumbnail IS NULL AND brand ILIKE 'ADOX' AND name ILIKE '%Silvermax%');

-- ── FOMA ─────────────────────────────────────────────
UPDATE public.films
SET can_thumbnail = 'img/films/fomapanr100-can.webp', can_thumbnail_status = 'set'
WHERE slug = 'fomapanr100'
   OR (can_thumbnail IS NULL AND brand ILIKE 'FOMA' AND name ILIKE '%Fomapan R%');

-- ── FUJIFILM ────────────────────────────────────────
UPDATE public.films
SET can_thumbnail = 'img/films/fujiototo200-can.webp', can_thumbnail_status = 'set'
WHERE slug = 'fujiototo200'
   OR (can_thumbnail IS NULL AND brand ILIKE 'FUJIFILM' AND name ILIKE '%오토오토%');

UPDATE public.films
SET can_thumbnail = 'img/films/sensia100-can.webp', can_thumbnail_status = 'set'
WHERE slug = 'sensia100'
   OR (can_thumbnail IS NULL AND brand ILIKE 'FUJIFILM' AND name ILIKE 'Sensia 100%');

UPDATE public.films
SET can_thumbnail = 'img/films/sensia200-can.webp', can_thumbnail_status = 'set'
WHERE slug = 'sensia200'
   OR (can_thumbnail IS NULL AND brand ILIKE 'FUJIFILM' AND name ILIKE 'Sensia 200%');

UPDATE public.films
SET can_thumbnail = 'img/films/sensia400-can.webp', can_thumbnail_status = 'set'
WHERE slug = 'sensia400'
   OR (can_thumbnail IS NULL AND brand ILIKE 'FUJIFILM' AND name ILIKE 'Sensia 400%');

-- ── KODAK ───────────────────────────────────────────
UPDATE public.films
SET can_thumbnail = 'img/films/kodakgold100-can.webp', can_thumbnail_status = 'set'
WHERE slug = 'kodakgold100'
   OR (can_thumbnail IS NULL AND brand ILIKE 'KODAK' AND name ILIKE 'Gold 100%');

-- ── MARIX ───────────────────────────────────────────
UPDATE public.films
SET can_thumbnail = 'img/films/marix100d-can.webp', can_thumbnail_status = 'set'
WHERE slug = 'marix100d'
   OR (can_thumbnail IS NULL AND brand ILIKE 'MARIX' AND name ILIKE '100D%');

UPDATE public.films
SET can_thumbnail = 'img/films/marix400d-can.webp', can_thumbnail_status = 'set'
WHERE slug = 'marix400d'
   OR (can_thumbnail IS NULL AND brand ILIKE 'MARIX' AND name ILIKE '400D%');

UPDATE public.films
SET can_thumbnail = 'img/films/marix800t-can.webp', can_thumbnail_status = 'set'
WHERE slug = 'marix800t'
   OR (can_thumbnail IS NULL AND brand ILIKE 'MARIX' AND name ILIKE '800T%');
