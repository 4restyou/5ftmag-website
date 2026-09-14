-- 글 공개/비공개를 즉시 바꾼다.
--
-- 지금까지는 관리 화면의 토글이 GitHub API 로 data/stories.json 을 main 에
-- 직접 커밋했다. 그래서 반영에 Netlify 재빌드 1~2분이 걸리고, 운영자가 GitHub
-- 토큰을 발급해 넣어야 했다(탭을 닫으면 사라진다). 폰에서는 사실상 못 썼다.
-- 그 커밋이 feeds-sync 를 깨우고, feeds-sync 는 보호 브랜치에 막혀 실패했다.
--
-- 공개 여부만 여기로 옮긴다. 기사 HTML 과 목록 데이터는 그대로 미리 배포해
-- 두고, 토글은 이 테이블의 한 줄만 바꾼다. 커밋이 없으니 재배포도 없다.
--
-- ── 두 원본이 갈라지지 않게 ──
-- data/stories.json 의 published 가 기본값이고, 이 테이블에 행이 있으면 그것이
-- 이긴다. 토글해서 기본값과 같아지면 행을 지운다. 그래서 이 테이블에는
-- "기본값에서 벗어난 글" 만 남는다. 대개 비어 있거나 몇 줄이다.
--
-- ── 이 변경으로 되지 않는 것 ──
-- 비공개로 내려도 그 글의 주소로 직접 들어오면 열린다(운영자 결정). sitemap 에서
-- 빠지는 것도 다음 배포 때다. 목록에서 감추는 것까지가 즉시다.

CREATE TABLE IF NOT EXISTS public.story_visibility (
  story_id   TEXT PRIMARY KEY,
  published  BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

COMMENT ON TABLE public.story_visibility IS
  'data/stories.json 의 published 를 덮어쓰는 행만 담는다. 기본값과 같아지면 행을 지운다.';

ALTER TABLE public.story_visibility ENABLE ROW LEVEL SECURITY;

-- 읽기는 누구나. "어떤 글이 공개인지" 는 공개 정보이고, 목록을 그리는 anon
-- 클라이언트가 매번 읽는다. 숨길 것이 없다.
DROP POLICY IF EXISTS "story_visibility public read" ON public.story_visibility;
CREATE POLICY "story_visibility public read" ON public.story_visibility
  FOR SELECT USING (true);

-- 쓰기는 편집부만. 호출자 본인 프로필만 읽는 패턴이라 profiles 정책을
-- "본인만" 으로 좁혀도 깨지지 않는다.
DROP POLICY IF EXISTS "story_visibility editors write" ON public.story_visibility;
CREATE POLICY "story_visibility editors write" ON public.story_visibility
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_editor)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_editor)
  );

-- 바꾼 사람과 시각을 남긴다. 글이 갑자기 사라졌을 때 누가 언제 내렸는지
-- 되짚을 수 있어야 한다.
CREATE OR REPLACE FUNCTION public.story_visibility_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_story_visibility_stamp ON public.story_visibility;
CREATE TRIGGER trg_story_visibility_stamp
  BEFORE INSERT OR UPDATE ON public.story_visibility
  FOR EACH ROW EXECUTE FUNCTION public.story_visibility_stamp();
