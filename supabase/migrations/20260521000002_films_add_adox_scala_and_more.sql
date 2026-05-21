-- Adox Scala 시리즈 + Adox 누락 라인 + B&W 리버설 동반 라인 + Sensia 단종 라인.
-- 사실 확인 출처: Adox / Foma 공식, b&h, macodirect, Cinestill, ePHOTOzine, La Vida Leica.
-- type 표기 원칙
--   - B&W 리버설(슬라이드)는 'Slide (B&W Reversal)' 로 명시 → filterCategory 가
--     slide 그룹으로 묶이도록. E-6 와 같은 카테고리.
--   - Sensia 는 Fujifilm 의 컨슈머 E-6 라인이므로 기존 'Slide (E-6)' 와 동일 표기.

-- ── ADOX Scala 50 ──
INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'adoxscala50',
  'library',
  'ADOX',
  'Scala 50',
  'ADOX Scala 50',
  '["ADOX Scala 50","Adox Scala 50","Scala 50","아독스 스칼라 50","adoxscala50"]'::jsonb,
  'Adox 의 HR-50 베이스를 리버설 공정으로 가공한 B&W 슬라이드 한 롤. 초미세입자와 클리어 베이스, 슈퍼 판크로매틱 감도로 프로젝션 영사에 어울리며 dr5 같은 전용 reversal lab 또는 자가 reversal 키트에서 처리합니다. 35mm 36 컷.',
  '50',
  'Slide (B&W Reversal)',
  '35mm',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

-- ── ADOX Scala 160 ──
INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'adoxscala160',
  'library',
  'ADOX',
  'Scala 160',
  'ADOX Scala 160',
  '["ADOX Scala 160","Adox Scala 160","Scala 160","아독스 스칼라 160","adoxscala160"]'::jsonb,
  'Adox 의 Silvermax 베이스를 리버설 공정으로 가공한 B&W 슬라이드. 데일라이트 광원에서 ISO 160 으로 권장되고 네거티브로 ISO 80~100 노출도 가능합니다. 클리어 트라이아세테이트 베이스 + 안티 헤일레이션 레이어. Silvermax 단종 영향으로 공급은 제한적.',
  '160',
  'Slide (B&W Reversal)',
  '35mm',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

-- ── ADOX Silvermax 100 ──
INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'adoxsilvermax100',
  'library',
  'ADOX',
  'Silvermax 100',
  'ADOX Silvermax 100',
  '["ADOX Silvermax 100","Adox Silvermax 100","Silvermax 100","실버맥스 100","아독스 실버맥스 100","adoxsilvermax100"]'::jsonb,
  '전통적 silver-rich 흑백 네거티브로, 광역 노출 관용도와 풍부한 토널리티가 정체성입니다. Adox Scala 160 의 원본이 되는 베이스이며 현재 단종 또는 한정 공급 상태. 잔여 재고가 보일 때 한 롤씩 등장하는 라인입니다.',
  '100',
  'Black & White',
  '35mm',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

-- ── ADOX CMS 20 II ──
INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'adoxcms20',
  'library',
  'ADOX',
  'CMS 20 II',
  'ADOX CMS 20 II',
  '["ADOX CMS 20 II","Adox CMS 20 II","Adox CMS II 20","CMS 20","CMS 20 II","아독스 CMS 20","adoxcms20"]'::jsonb,
  '마이크로필름 베이스를 사진용으로 가공한 Adox 의 초저감도 B&W. 단립자(monodisperse) 유제로 입자가 사실상 보이지 않는 해상도를 내며 대형 인화나 카피·복사 작업에 자주 호명됩니다. 전용 Adotech II/III 현상액과 짝지어야 사양이 살아납니다.',
  '20',
  'Black & White',
  '35mm, 120, Sheet',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

-- ── Foma Fomapan R 100 ──
INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'fomapanr100',
  'library',
  'FOMA',
  'Fomapan R 100',
  'Foma Fomapan R 100',
  '["Fomapan R 100","Foma Fomapan R 100","Foma R 100","Fomapan R100","포마판 R 100","fomapanr100"]'::jsonb,
  '체코 Foma 의 B&W 리버설 한 롤. 단종된 Agfa Scala 의 가장 가까운 대체로 자주 거론되며 35mm 36 컷 외에 8mm·Super 16mm 시네 포맷으로도 공급됩니다. 전용 R-100 reversal 공정이 필요해 일반 네거 현상으로는 처리할 수 없습니다.',
  '100',
  'Slide (B&W Reversal)',
  '35mm, 16mm, 8mm',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

-- ── Fujifilm Sensia 100 ──
INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'sensia100',
  'library',
  'FUJIFILM',
  'Sensia 100',
  'Fujifilm Sensia 100',
  '["Fujifilm Sensia 100","Fuji Sensia 100","Sensia 100","Fujichrome Sensia 100","센시아 100","후지 센시아 100","sensia100"]'::jsonb,
  'Fujifilm 의 컨슈머 E-6 슬라이드 한 롤. 채도가 정돈된 데일라이트 톤이 특징이었고 2010 년 Sensia 전 라인이 단종되었습니다. 현재는 중고 시장과 냉동 재고로만 만날 수 있는 한 롤.',
  '100',
  'Slide (E-6)',
  '35mm',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

-- ── Fujifilm Sensia 200 ──
INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'sensia200',
  'library',
  'FUJIFILM',
  'Sensia 200',
  'Fujifilm Sensia 200',
  '["Fujifilm Sensia 200","Fuji Sensia 200","Sensia 200","Fujichrome Sensia 200","센시아 200","후지 센시아 200","sensia200"]'::jsonb,
  'Sensia 라인의 중간 감도. 일상 스냅과 여행에 어울리는 균형 잡힌 E-6 슬라이드로 자리 잡았으나 다른 라인과 함께 2010 년 단종됐습니다.',
  '200',
  'Slide (E-6)',
  '35mm',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;

-- ── Fujifilm Sensia 400 ──
INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'sensia400',
  'library',
  'FUJIFILM',
  'Sensia 400',
  'Fujifilm Sensia 400',
  '["Fujifilm Sensia 400","Fuji Sensia 400","Sensia 400","Fujichrome Sensia 400","센시아 400","후지 센시아 400","sensia400"]'::jsonb,
  'Sensia 라인 중 가장 빠른 감도. 실내와 저조도에서도 E-6 슬라이드를 가져갈 수 있게 한 한 롤로 풍경 reportage 에 자주 거론됐고, 다른 라인과 함께 2010 년 단종됐습니다.',
  '400',
  'Slide (E-6)',
  '35mm',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;
