-- 일회용(single-use) 카메라 일괄 등록.
-- 표기 컨벤션: "<모델명> (일회용카메라)" — 사용자가 admin 에서 등록한
-- "Ilford XP2 (일회용카메라)" 패턴을 따름.
-- model_key 는 lower + [\s\-_] 제거 (js/camera-brands.js 의 modelKey()).
-- 이미 같은 model_key 가 있으면 건드리지 않음.

INSERT INTO public.camera_brand_overrides (model_key, brand, display, note) VALUES
  ('funsaver(일회용카메라)',  'KODAK',      'FunSaver (일회용카메라)',
   '코닥 컨슈머 일회용 카메라. 보통 Kodak Gold 400 또는 FunSaver 800 장착, 27 컷.'),
  ('quicksnap(일회용카메라)', 'FUJIFILM',   'QuickSnap (일회용카메라)',
   '후지필름 컨슈머 일회용 카메라. 보통 Superia 400 장착, 27 컷. 플래시 모델은 QuickSnap Flash.'),
  ('simpleace(일회용카메라)', 'FUJIFILM',   'Simple Ace (일회용카메라)',
   '일본/한국 시장에 흔히 풀리는 후지필름 보급형 일회용 (ISO 400).'),
  ('hp5plus(일회용카메라)',   'ILFORD',     'HP5 Plus (일회용카메라)',
   '일포드 HP5 Plus 400 을 장착한 일회용 흑백 카메라.'),
  ('trix(일회용카메라)',      'KODAK',      'Tri-X (일회용카메라)',
   '코닥 Tri-X 400 을 장착한 흑백 일회용. 2017 출시.'),
  ('simpleuse(일회용카메라)', 'LOMOGRAPHY', 'Simple Use (일회용카메라)',
   '로모그래피 Simple Use 시리즈. 필름 교체 가능한 재사용형이지만 흔히 일회용 카테고리로 통용됨.')
ON CONFLICT (model_key) DO NOTHING;
