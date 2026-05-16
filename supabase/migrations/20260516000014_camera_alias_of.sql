-- 카메라 모델 병합(alias) 지원
-- 한 model_key 가 다른 canonical model_key 의 별칭이 되도록.
-- 예) 'autoboy' alias_of 'asahi오토보이' → 두 행이 하나로 합쳐짐.
-- alias_of 가 NULL 이면 일반 brand/display 오버라이드, NOT NULL 이면 별칭 매핑.

ALTER TABLE public.camera_brand_overrides
  ADD COLUMN IF NOT EXISTS alias_of TEXT;

-- alias_of 가 자기 자신을 가리키지 못하도록
ALTER TABLE public.camera_brand_overrides
  DROP CONSTRAINT IF EXISTS camera_brand_overrides_no_self_alias;
ALTER TABLE public.camera_brand_overrides
  ADD CONSTRAINT camera_brand_overrides_no_self_alias
  CHECK (alias_of IS NULL OR alias_of <> model_key);

-- alias 룩업 가속용 인덱스
CREATE INDEX IF NOT EXISTS idx_camera_overrides_alias_of
  ON public.camera_brand_overrides(alias_of)
  WHERE alias_of IS NOT NULL;

NOTIFY pgrst, 'reload schema';
