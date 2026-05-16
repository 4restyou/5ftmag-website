-- 카메라 브랜드 오버라이드 — 편집부가 사이트 내에서 모델→브랜드 매핑을 추가/수정
-- 정적 사전(js/camera-brands.js)의 CAMERA_BRANDS / MODEL_BRAND_HINTS 를 보강하는 layer.
-- 정규화된 model_key 를 PK 로 두고 브랜드(canonical) 와 (선택) display 표기를 저장.

CREATE TABLE IF NOT EXISTS public.camera_brand_overrides (
  model_key   TEXT PRIMARY KEY CHECK (char_length(model_key) BETWEEN 1 AND 80),
  brand       TEXT NOT NULL CHECK (char_length(brand) BETWEEN 1 AND 40),
  display     TEXT CHECK (display IS NULL OR char_length(display) <= 80),
  note        TEXT CHECK (note IS NULL OR char_length(note) <= 200),
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION public.camera_brand_overrides_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS camera_brand_overrides_touch ON public.camera_brand_overrides;
CREATE TRIGGER camera_brand_overrides_touch
  BEFORE UPDATE ON public.camera_brand_overrides
  FOR EACH ROW EXECUTE FUNCTION public.camera_brand_overrides_touch_updated_at();

-- RLS
ALTER TABLE public.camera_brand_overrides ENABLE ROW LEVEL SECURITY;

-- 누구나 읽기 (Films 페이지 비로그인 사용자도 드롭다운 분류 결과 보아야 함)
DROP POLICY IF EXISTS "camera overrides public read" ON public.camera_brand_overrides;
CREATE POLICY "camera overrides public read" ON public.camera_brand_overrides
  FOR SELECT TO anon, authenticated
  USING (true);

-- 편집부만 INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "camera overrides editor insert" ON public.camera_brand_overrides;
CREATE POLICY "camera overrides editor insert" ON public.camera_brand_overrides
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
     WHERE user_id = auth.uid() AND is_editor = TRUE
  ));

DROP POLICY IF EXISTS "camera overrides editor update" ON public.camera_brand_overrides;
CREATE POLICY "camera overrides editor update" ON public.camera_brand_overrides
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
     WHERE user_id = auth.uid() AND is_editor = TRUE
  ));

DROP POLICY IF EXISTS "camera overrides editor delete" ON public.camera_brand_overrides;
CREATE POLICY "camera overrides editor delete" ON public.camera_brand_overrides
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
     WHERE user_id = auth.uid() AND is_editor = TRUE
  ));

NOTIFY pgrst, 'reload schema';
