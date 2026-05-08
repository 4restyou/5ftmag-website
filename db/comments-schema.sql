-- 5ft.mag 댓글 시스템 스키마
-- Supabase SQL Editor에서 한 번만 실행

-- ════════════════════════════════════════════════════════════
-- profiles: 표시용 사용자 정보 (이름, 아바타, 편집부 권한)
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  is_editor  BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 신규 가입 시 OAuth 메타데이터에서 프로필 자동 생성
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'nickname',
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1)
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture',
      NEW.raw_user_meta_data->>'profile_image'
    )
  )
  ON CONFLICT (user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url,
      updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ════════════════════════════════════════════════════════════
-- comments: 본문
-- page_id 예: "stories/12", "films/cinestill800t"
-- parent_id 있으면 답글 (한 레벨 threading)
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id    TEXT NOT NULL,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id  UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  body       TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_comments_page ON public.comments(page_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON public.comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_user ON public.comments(user_id);

-- ════════════════════════════════════════════════════════════
-- likes: 좋아요
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.likes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_likes_comment ON public.likes(comment_id);

-- ════════════════════════════════════════════════════════════
-- 뷰: 댓글 + 작성자 + 좋아요 수 (프론트가 한 번에 받기)
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.comments_with_meta AS
SELECT
  c.id,
  c.page_id,
  c.user_id,
  c.parent_id,
  c.body,
  c.created_at,
  c.updated_at,
  c.deleted_at,
  p.display_name,
  p.avatar_url,
  p.is_editor,
  COALESCE(l.like_count, 0) AS like_count
FROM public.comments c
LEFT JOIN public.profiles p ON p.user_id = c.user_id
LEFT JOIN (
  SELECT comment_id, COUNT(*) AS like_count
  FROM public.likes
  GROUP BY comment_id
) l ON l.comment_id = c.id;

-- ════════════════════════════════════════════════════════════
-- Row Level Security (RLS)
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;

-- profiles: 누구나 읽기, 본인만 수정
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_select"     ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- comments: 누구나 읽기, 인증된 사용자만 작성/본인 댓글만 수정·삭제
DROP POLICY IF EXISTS "comments_select" ON public.comments;
DROP POLICY IF EXISTS "comments_insert" ON public.comments;
DROP POLICY IF EXISTS "comments_update_own" ON public.comments;
DROP POLICY IF EXISTS "comments_delete_own_or_editor" ON public.comments;
CREATE POLICY "comments_select"
  ON public.comments FOR SELECT
  USING (true);
CREATE POLICY "comments_insert"
  ON public.comments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "comments_update_own"
  ON public.comments FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "comments_delete_own_or_editor"
  ON public.comments FOR DELETE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_editor = TRUE
    )
  );

-- likes: 누구나 읽기, 본인만 추가/삭제
DROP POLICY IF EXISTS "likes_select" ON public.likes;
DROP POLICY IF EXISTS "likes_insert" ON public.likes;
DROP POLICY IF EXISTS "likes_delete_own" ON public.likes;
CREATE POLICY "likes_select"
  ON public.likes FOR SELECT USING (true);
CREATE POLICY "likes_insert"
  ON public.likes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "likes_delete_own"
  ON public.likes FOR DELETE
  USING (auth.uid() = user_id);

-- 뷰에 대한 권한 (RLS는 base 테이블 통해 적용됨)
GRANT SELECT ON public.comments_with_meta TO anon, authenticated;

-- ════════════════════════════════════════════════════════════
-- Realtime 활성화 (새 댓글 즉시 표시)
-- ════════════════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.likes;
