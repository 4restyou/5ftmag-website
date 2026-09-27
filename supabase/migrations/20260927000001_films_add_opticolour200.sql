-- 필름 추가: Optik Oldschool OptiColour 200.
--
-- 확인한 사실 (판매처 상품 정보와 제조사 공개 설명)
--   - C-41 컬러 네거티브, ISO 200, 35mm 36컷, 데일라이트 밸런스
--   - 독일 InovisCoat 가 코팅한다
--   - Wolfen NC200 유제를 쓴다
--   - 같은 NC 계열인 NC400 · NC500 과 달리 오렌지 베이스다. 그래서 스캔이 수월하다
--   - 자연스러운 색과 또렷한 대비, 녹색과 붉은색, 피부톤이 강점으로 거론된다
--
-- 카탈로그에 ORWO Wolfen NC400 · NC500 이 이미 있다. 그 둘은 시네마 계보라
-- type 이 Daylight 인데, 이쪽은 일반 사진용 C-41 이라 Color Negative 로 넣는다.
--
-- 캔 썸네일은 아직 없어 pending 으로 둔다.
-- slug 중복은 ON CONFLICT 로 막아 재적용(replay)에 안전하다.

INSERT INTO public.films (
  slug, tier, brand, name, display_name, aliases, description, iso, type, format,
  photographers, photos, can_thumbnail, can_thumbnail_status
) VALUES (
  'opticolour200',
  'library',
  'OPTIK OLDSCHOOL',
  'OptiColour 200',
  'Optik Oldschool OptiColour 200',
  '["OptiColour 200","Opticolour 200","OptiColor 200","Opticolor 200","Optik OptiColour 200","Optik Oldschool OptiColour 200","Optik Old School OptiColour 200","옵티컬러 200","옵티컬러200","옵틱 올드스쿨 옵티컬러 200","opticolour200","opticolor200"]'::jsonb,
  '독일 InovisCoat 가 코팅하는 C-41 컬러 네거티브예요. Wolfen NC200 유제를 씁니다. 같은 NC 계열인 NC400 · NC500 과 달리 오렌지 베이스라 스캔이 수월해요. 자연스러운 색과 또렷한 대비가 특징이고 녹색과 붉은색이 잘 나온다는 평이 따라다닙니다. 피부톤은 살짝 따뜻한 쪽이라 인물에도 무난해요. 데일라이트 밸런스, 35mm 36컷.',
  '200',
  'Color Negative',
  '35mm',
  '[]'::jsonb,
  '[]'::jsonb,
  NULL,
  'pending'
) ON CONFLICT (slug) DO NOTHING;
