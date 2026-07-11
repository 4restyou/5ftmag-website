-- 5ft.mag DB baseline
-- version: 2026-07-12
-- GENERATED FILE. db/baseline-manifest.json과 개별 스키마 파일을 수정한 뒤 npm run db:baseline을 실행하세요.
-- 새 프로젝트 복구 시 이 파일을 먼저 적용하고, 이어서 supabase/migrations를 시간순으로 적용합니다.
-- ─────────────────────────────────────────────
-- SOURCE: db/comments-schema.sql
-- ─────────────────────────────────────────────
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
-- 공개 프로필 뷰 — 클라이언트가 base 테이블 대신 이 view 로 조회
-- 메타(created_at/updated_at) 가리고 표시용 컬럼만 노출
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.profiles_public AS
SELECT user_id, display_name, avatar_url, is_editor
FROM public.profiles;

GRANT SELECT ON public.profiles_public TO anon, authenticated;

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
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 권한 상승 차단: 편집부가 아닌 인증 사용자는 is_editor / user_id 를 바꿀 수 없다.
-- (service_role/대시보드 = auth.uid() NULL 경로로만 is_editor 부여)
CREATE OR REPLACE FUNCTION public.profiles_privilege_guard()
RETURNS TRIGGER AS $$
DECLARE
  is_editor_now BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(is_editor, FALSE) INTO is_editor_now
  FROM public.profiles WHERE user_id = auth.uid();
  IF NOT COALESCE(is_editor_now, FALSE) THEN
    IF NEW.is_editor IS DISTINCT FROM OLD.is_editor THEN
      RAISE EXCEPTION 'is_editor 는 본인이 변경할 수 없습니다';
    END IF;
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'user_id 변경 불가';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS profiles_privilege_guard ON public.profiles;
CREATE TRIGGER profiles_privilege_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_privilege_guard();

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
-- profiles_public 권한은 view 정의 직후에 부여됨 (위 참조)

-- ════════════════════════════════════════════════════════════
-- Realtime 활성화 (새 댓글 즉시 표시)
-- ════════════════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.likes;

-- ─────────────────────────────────────────────
-- SOURCE: db/user-favorites-schema.sql
-- ─────────────────────────────────────────────
-- 5ft.mag user_favorites — 본인용 즐겨찾기 (사진/필름)
-- Supabase SQL Editor에서 한 번만 실행
-- 사전조건: auth.users 존재 (기본). profiles 의존 없음.
-- 공개 카운터 없음. 본인만 SELECT/INSERT/DELETE.
--
-- target_type: 'submission' | 'film' | 'article'
--   - 'submission' → target_id = reader_submissions.id (UUID, TEXT 캐스팅)
--   - 'film'       → target_id = films.json slug (예: 'kodakgold200')
--   - 'article'    → target_id = stories.json id (예: 'lomo-mca', 'spc-issue01', '01')
-- target_id 컬럼은 TEXT 로 통일 — 서버 측 폴리모피즘.

CREATE TABLE IF NOT EXISTS public.user_favorites (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('submission', 'film', 'article')),
  target_id   TEXT NOT NULL CHECK (char_length(target_id) <= 80),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_type_created
  ON public.user_favorites(user_id, target_type, created_at DESC);

-- ════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own favorites readable" ON public.user_favorites;
CREATE POLICY "own favorites readable" ON public.user_favorites
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own favorites insertable" ON public.user_favorites;
CREATE POLICY "own favorites insertable" ON public.user_favorites
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own favorites deletable" ON public.user_favorites;
CREATE POLICY "own favorites deletable" ON public.user_favorites
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ─────────────────────────────────────────────
-- SOURCE: db/market-schema.sql
-- ─────────────────────────────────────────────
-- 5ft.mag Market — 구독자 중고 장터
-- 사전조건: db/comments-schema.sql 가 먼저 실행되어 있어야 함 (profiles, is_editor)
-- ════════════════════════════════════════════════════════════
-- market_listings: 매물
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.market_listings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  price         TEXT NOT NULL CHECK (char_length(price) BETWEEN 1 AND 40),
  category      TEXT NOT NULL CHECK (category IN ('film','camera','lens','accessory','etc')),
  description   TEXT CHECK (description IS NULL OR char_length(description) <= 1000),

  -- Storage 경로 1~3장 (bucket: market-listings)
  storage_paths TEXT[] NOT NULL CHECK (
    array_length(storage_paths, 1) BETWEEN 1 AND 3
  ),

  contact       TEXT NOT NULL CHECK (char_length(contact) BETWEEN 1 AND 100),
  location      TEXT CHECK (location IS NULL OR char_length(location) <= 60),

  status        TEXT NOT NULL DEFAULT 'available'
                CHECK (status IN ('available','reserved','sold','hidden')),

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_listings_public
  ON public.market_listings(status, created_at DESC)
  WHERE status IN ('available','reserved','sold');
CREATE INDEX IF NOT EXISTS idx_market_listings_user
  ON public.market_listings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_listings_category
  ON public.market_listings(category, status);

-- ════════════════════════════════════════════════════════════
-- market_reports: 신고
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.market_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   UUID NOT NULL REFERENCES public.market_listings(id) ON DELETE CASCADE,
  reporter_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason       TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'resolved', 'dismissed')),
  resolved_at  TIMESTAMPTZ,
  resolved_by  UUID REFERENCES auth.users(id),
  resolver_note TEXT CHECK (resolver_note IS NULL OR char_length(resolver_note) <= 300),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (listing_id, reporter_id)  -- 한 사람당 한 매물 1회 신고
);

CREATE INDEX IF NOT EXISTS idx_market_reports_listing
  ON public.market_reports(listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_reports_status
  ON public.market_reports(status, created_at DESC);

-- ════════════════════════════════════════════════════════════
-- 공개 뷰: hidden 제외 + 작성자 표시 정보
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.market_listings_public AS
SELECT
  l.id,
  l.user_id,
  l.title,
  l.price,
  l.category,
  l.description,
  l.storage_paths,
  l.contact,
  l.location,
  l.status,
  l.created_at,
  l.updated_at,
  p.display_name,
  p.avatar_url
FROM public.market_listings l
LEFT JOIN public.profiles p ON p.user_id = l.user_id
WHERE l.status IN ('available','reserved','sold');

GRANT SELECT ON public.market_listings_public TO anon, authenticated;

-- ════════════════════════════════════════════════════════════
-- 본인 매물 컬럼 보호 트리거
--   본인이 변경할 수 없는 컬럼: user_id, storage_paths(별도 절차로만)
--   본인이 변경 가능: title, price, category, description, contact,
--                    location, status (available/reserved/sold 순환)
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.market_listings_owner_guard()
RETURNS TRIGGER AS $$
DECLARE
  is_editor_now BOOLEAN;
BEGIN
  SELECT COALESCE(is_editor, FALSE) INTO is_editor_now
  FROM public.profiles WHERE user_id = auth.uid();
  IF NOT COALESCE(is_editor_now, FALSE) THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'user_id 변경 불가';
    END IF;
    -- 'hidden' 으로의 본인 변경 금지 (편집부만 처리)
    IF NEW.status = 'hidden' AND OLD.status <> 'hidden' THEN
      RAISE EXCEPTION 'hidden 상태는 본인이 설정할 수 없습니다';
    END IF;
    -- 한번 hidden 된 매물의 status 변경 금지 (편집부만 복구 가능)
    IF OLD.status = 'hidden' THEN
      RAISE EXCEPTION 'hidden 매물은 본인이 변경할 수 없습니다';
    END IF;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS market_listings_owner_guard ON public.market_listings;
CREATE TRIGGER market_listings_owner_guard
  BEFORE UPDATE ON public.market_listings
  FOR EACH ROW EXECUTE FUNCTION public.market_listings_owner_guard();

-- ════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.market_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_reports  ENABLE ROW LEVEL SECURITY;

-- listings: 누구나 hidden 제외 SELECT (뷰 + base 정책)
DROP POLICY IF EXISTS "market public visible" ON public.market_listings;
CREATE POLICY "market public visible" ON public.market_listings
  FOR SELECT TO anon, authenticated
  USING (status <> 'hidden');

-- 본인은 본인 매물 전체 SELECT (hidden 포함)
DROP POLICY IF EXISTS "market own readable" ON public.market_listings;
CREATE POLICY "market own readable" ON public.market_listings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 편집부는 모든 매물 SELECT
DROP POLICY IF EXISTS "market editor read" ON public.market_listings;
CREATE POLICY "market editor read" ON public.market_listings
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND is_editor = TRUE
  ));

-- 인증 사용자: 본인 user_id 로 INSERT, status='available' 만
DROP POLICY IF EXISTS "market insert own" ON public.market_listings;
CREATE POLICY "market insert own" ON public.market_listings
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'available'
  );

-- 본인 UPDATE (트리거가 컬럼 제한)
DROP POLICY IF EXISTS "market update own" ON public.market_listings;
CREATE POLICY "market update own" ON public.market_listings
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 편집부 UPDATE (모든 컬럼)
DROP POLICY IF EXISTS "market editor update" ON public.market_listings;
CREATE POLICY "market editor update" ON public.market_listings
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND is_editor = TRUE
  ));

-- 본인 DELETE
DROP POLICY IF EXISTS "market delete own" ON public.market_listings;
CREATE POLICY "market delete own" ON public.market_listings
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 편집부 DELETE
DROP POLICY IF EXISTS "market editor delete" ON public.market_listings;
CREATE POLICY "market editor delete" ON public.market_listings
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND is_editor = TRUE
  ));

-- reports: 인증 사용자가 본인 reporter_id 로 INSERT
DROP POLICY IF EXISTS "market reports insert" ON public.market_reports;
CREATE POLICY "market reports insert" ON public.market_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- 본인 신고 SELECT
DROP POLICY IF EXISTS "market reports own read" ON public.market_reports;
CREATE POLICY "market reports own read" ON public.market_reports
  FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

-- 편집부는 모든 신고 SELECT
DROP POLICY IF EXISTS "market reports editor read" ON public.market_reports;
CREATE POLICY "market reports editor read" ON public.market_reports
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND is_editor = TRUE
  ));

-- 편집부 UPDATE (status / resolved_* / resolver_note)
DROP POLICY IF EXISTS "market reports editor update" ON public.market_reports;
CREATE POLICY "market reports editor update" ON public.market_reports
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND is_editor = TRUE
  ));

-- ════════════════════════════════════════════════════════════
-- Storage bucket 'market-listings'
-- ════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'market-listings',
  'market-listings',
  TRUE,
  5 * 1024 * 1024,
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 본인 폴더에만 업로드 + 확장자 화이트리스트
DROP POLICY IF EXISTS "market upload own" ON storage.objects;
CREATE POLICY "market upload own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'market-listings'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (
      lower(name) LIKE '%.jpg'
      OR lower(name) LIKE '%.jpeg'
      OR lower(name) LIKE '%.png'
      OR lower(name) LIKE '%.webp'
    )
  );

-- 본인 폴더 객체 DELETE
DROP POLICY IF EXISTS "market delete own folder" ON storage.objects;
CREATE POLICY "market delete own folder" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'market-listings'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 편집부 임의 객체 DELETE
DROP POLICY IF EXISTS "market editor delete obj" ON storage.objects;
CREATE POLICY "market editor delete obj" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'market-listings'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_editor = TRUE
    )
  );

-- 공개 SELECT
DROP POLICY IF EXISTS "market public read obj" ON storage.objects;
CREATE POLICY "market public read obj" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'market-listings');

-- ─────────────────────────────────────────────
-- SOURCE: db/reader-submissions-schema.sql
-- ─────────────────────────────────────────────
-- 5ft.mag Reader's Roll 직접 제출 시스템
-- Supabase SQL Editor에서 한 번만 실행
-- 사전조건: db/comments-schema.sql 가 먼저 실행되어 있어야 함 (profiles 테이블, is_editor 플래그 사용)

-- ════════════════════════════════════════════════════════════
-- reader_submissions: 독자 직접 제출 데이터
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.reader_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Storage 경로 (bucket: reader-submissions). 예: '{user_id}/{uuid}.jpg'
  storage_path  TEXT NOT NULL,

  -- 제출자 정보 (자동 채움 + 수정 가능)
  -- submitter_name: 표시용 이름 (인스타그램 없는 사용자 대응). 둘 중 하나는 필수 (JS 검증)
  -- 길이 CHECK 는 클라이언트 maxlength 와 동일 — DB 레벨에서도 한 번 더 가드 (RLS bypass / API 직접 호출 대비)
  submitter_name TEXT CHECK (submitter_name IS NULL OR char_length(submitter_name) <= 60),
  instagram     TEXT CHECK (instagram IS NULL OR char_length(instagram) <= 80),
  film          TEXT CHECK (film IS NULL OR char_length(film) <= 120),
  camera        TEXT CHECK (camera IS NULL OR char_length(camera) <= 80),
  caption       TEXT CHECK (caption IS NULL OR char_length(caption) <= 200),

  -- 월간 테마 응모 여부 (예: '2026-05' / NULL이면 일반 제출)
  theme_month   TEXT,

  -- 워크플로우
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 500),

  -- 동의 (게재 동의 + 저작권 본인 확인)
  consent_publish BOOLEAN NOT NULL DEFAULT FALSE,

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at   TIMESTAMPTZ,
  reviewed_by   UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_submissions_status ON public.reader_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON public.reader_submissions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_theme ON public.reader_submissions(theme_month) WHERE theme_month IS NOT NULL;

-- ════════════════════════════════════════════════════════════
-- 공개 뷰: 승인된 제출만 + 작가 표시정보 조인
-- 메인 Reader's Roll에서 이걸 SELECT
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.reader_submissions_approved AS
SELECT
  rs.id,
  rs.storage_path,
  rs.submitter_name,
  rs.instagram,
  rs.film,
  rs.camera,
  rs.caption,
  rs.theme_month,
  rs.created_at,
  p.display_name,
  p.avatar_url
FROM public.reader_submissions rs
LEFT JOIN public.profiles p ON p.user_id = rs.user_id
WHERE rs.status = 'approved';

-- ────────────────────────────────────────────────────────────
-- ★ 마이그레이션 (이미 schema 가 적용된 환경에서 submitter_name 컬럼 추가)
--   Supabase SQL Editor 에 따로 한 번만 실행:
--   ※ CREATE OR REPLACE VIEW 는 칼럼 순서 변경을 거부하므로 DROP + CREATE 로
-- ────────────────────────────────────────────────────────────
-- ALTER TABLE public.reader_submissions
--   ADD COLUMN IF NOT EXISTS submitter_name TEXT;
--
-- DROP VIEW IF EXISTS public.reader_submissions_approved;
--
-- CREATE VIEW public.reader_submissions_approved AS
-- SELECT
--   rs.id,
--   rs.storage_path,
--   rs.submitter_name,
--   rs.instagram,
--   rs.film,
--   rs.camera,
--   rs.caption,
--   rs.theme_month,
--   rs.created_at,
--   p.display_name,
--   p.avatar_url
-- FROM public.reader_submissions rs
-- LEFT JOIN public.profiles p ON p.user_id = rs.user_id
-- WHERE rs.status = 'approved';

-- ════════════════════════════════════════════════════════════
-- RLS 정책
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.reader_submissions ENABLE ROW LEVEL SECURITY;

-- 본인 제출만 조회
DROP POLICY IF EXISTS "own submissions readable" ON public.reader_submissions;
CREATE POLICY "own submissions readable" ON public.reader_submissions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 편집부는 모든 제출 조회 가능
DROP POLICY IF EXISTS "editors read all" ON public.reader_submissions;
CREATE POLICY "editors read all" ON public.reader_submissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles
            WHERE user_id = auth.uid() AND is_editor = TRUE)
  );

-- 인증 사용자: 본인 user_id로만 INSERT 가능
DROP POLICY IF EXISTS "authenticated can submit" ON public.reader_submissions;
CREATE POLICY "authenticated can submit" ON public.reader_submissions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND consent_publish = TRUE
  );

-- 본인은 자기 제출을 status 무관 삭제 가능 (마이그레이션 20260513000001)
DROP POLICY IF EXISTS "own pending deletable" ON public.reader_submissions;
DROP POLICY IF EXISTS "own deletable" ON public.reader_submissions;
CREATE POLICY "own deletable" ON public.reader_submissions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 편집부는 모든 제출 UPDATE 가능 (status, rejection_reason 등)
DROP POLICY IF EXISTS "editors review" ON public.reader_submissions;
CREATE POLICY "editors review" ON public.reader_submissions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles
            WHERE user_id = auth.uid() AND is_editor = TRUE)
  );

-- 본인은 자기 제출의 메타(필름/카메라/캡션/IG/이름)만 UPDATE 가능.
-- status, storage_path, user_id, rejection_reason, reviewed_* 는
-- 아래 트리거로 막아서 본인이 변경할 수 없게 가드.
DROP POLICY IF EXISTS "own submissions updatable" ON public.reader_submissions;
CREATE POLICY "own submissions updatable" ON public.reader_submissions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 컬럼 보호 트리거: 편집부가 아닌 사용자의 UPDATE 가
-- 핵심 컬럼을 바꾸지 못하게 막음
CREATE OR REPLACE FUNCTION public.reader_submissions_owner_guard()
RETURNS TRIGGER AS $$
DECLARE
  is_editor_now BOOLEAN;
BEGIN
  SELECT COALESCE(is_editor, FALSE) INTO is_editor_now
  FROM public.profiles WHERE user_id = auth.uid();
  IF NOT COALESCE(is_editor_now, FALSE) THEN
    IF NEW.status           IS DISTINCT FROM OLD.status           THEN RAISE EXCEPTION 'status 는 본인이 변경할 수 없습니다'; END IF;
    IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN RAISE EXCEPTION 'rejection_reason 은 본인이 변경할 수 없습니다'; END IF;
    IF NEW.reviewed_at      IS DISTINCT FROM OLD.reviewed_at      THEN RAISE EXCEPTION 'reviewed_at 는 본인이 변경할 수 없습니다'; END IF;
    IF NEW.reviewed_by      IS DISTINCT FROM OLD.reviewed_by      THEN RAISE EXCEPTION 'reviewed_by 는 본인이 변경할 수 없습니다'; END IF;
    IF NEW.user_id          IS DISTINCT FROM OLD.user_id          THEN RAISE EXCEPTION 'user_id 변경 불가'; END IF;
    IF NEW.storage_path     IS DISTINCT FROM OLD.storage_path     THEN RAISE EXCEPTION '사진 교체는 별도 절차로만 가능합니다'; END IF;
    IF NEW.theme_month      IS DISTINCT FROM OLD.theme_month      THEN RAISE EXCEPTION 'theme_month 은 본인이 변경할 수 없습니다'; END IF;
    IF NEW.consent_publish  IS DISTINCT FROM OLD.consent_publish  THEN RAISE EXCEPTION 'consent_publish 는 변경할 수 없습니다'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS reader_submissions_owner_guard ON public.reader_submissions;
CREATE TRIGGER reader_submissions_owner_guard
  BEFORE UPDATE ON public.reader_submissions
  FOR EACH ROW EXECUTE FUNCTION public.reader_submissions_owner_guard();

-- 편집부는 모든 제출 DELETE 가능
DROP POLICY IF EXISTS "editors delete any" ON public.reader_submissions;
CREATE POLICY "editors delete any" ON public.reader_submissions
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles
            WHERE user_id = auth.uid() AND is_editor = TRUE)
  );

-- 익명 사용자: 승인된 제출만 뷰를 통해 SELECT 가능
DROP POLICY IF EXISTS "public reads approved" ON public.reader_submissions;
CREATE POLICY "public reads approved" ON public.reader_submissions
  FOR SELECT TO anon, authenticated
  USING (status = 'approved');

-- 뷰는 RLS 안 받지만 베이스 테이블 정책에 의해 자동으로 필터됨

-- ════════════════════════════════════════════════════════════
-- Storage bucket 'reader-submissions' 설정
-- (Supabase Dashboard → Storage 에서 수동 생성하거나 아래 SQL)
-- ════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reader-submissions',
  'reader-submissions',
  TRUE,                                        -- public read (URL 직접 접근 가능)
  5 * 1024 * 1024,                             -- 5MB 상한 (브라우저에서 리사이즈 후 업로드 가정)
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 업로드 정책: 인증 사용자가 자기 user_id 폴더에만 업로드
-- 확장자 화이트리스트도 RLS 단에서 추가 가드 (bucket allowed_mime_types 와 이중 가드)
DROP POLICY IF EXISTS "user upload to own folder" ON storage.objects;
CREATE POLICY "user upload to own folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'reader-submissions'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (
      lower(name) LIKE '%.jpg'
      OR lower(name) LIKE '%.jpeg'
      OR lower(name) LIKE '%.png'
      OR lower(name) LIKE '%.webp'
    )
  );

-- 본인은 자기 폴더 객체 DELETE 가능 (제출 취소 시)
DROP POLICY IF EXISTS "user delete own folder" ON storage.objects;
CREATE POLICY "user delete own folder" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'reader-submissions'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 편집부는 모든 객체 DELETE 가능 (반려 처리)
DROP POLICY IF EXISTS "editor delete any" ON storage.objects;
CREATE POLICY "editor delete any" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'reader-submissions'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_editor = TRUE
    )
  );

-- 모든 사용자 SELECT (bucket public이라 사실상 항상 OK이지만 명시)
DROP POLICY IF EXISTS "public read submissions" ON storage.objects;
CREATE POLICY "public read submissions" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'reader-submissions');

-- ════════════════════════════════════════════════════════════
-- 기존 환경용 마이그레이션 (이미 schema 적용된 프로젝트)
-- Supabase SQL Editor 에서 따로 한 번만 실행:
-- ════════════════════════════════════════════════════════════
-- ALTER TABLE public.reader_submissions
--   ADD CONSTRAINT reader_submissions_submitter_name_len
--     CHECK (submitter_name IS NULL OR char_length(submitter_name) <= 60);
-- ALTER TABLE public.reader_submissions
--   ADD CONSTRAINT reader_submissions_instagram_len
--     CHECK (instagram IS NULL OR char_length(instagram) <= 80);
-- ALTER TABLE public.reader_submissions
--   ADD CONSTRAINT reader_submissions_film_len
--     CHECK (film IS NULL OR char_length(film) <= 120);
-- ALTER TABLE public.reader_submissions
--   ADD CONSTRAINT reader_submissions_camera_len
--     CHECK (camera IS NULL OR char_length(camera) <= 80);
-- ALTER TABLE public.reader_submissions
--   ADD CONSTRAINT reader_submissions_rejection_len
--     CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 500);

-- ─────────────────────────────────────────────
-- SOURCE: db/webzine-schema.sql
-- ─────────────────────────────────────────────
-- 5ft.mag 웹진 (편집부가 PDF 를 올려 flipbook 으로 보여주는 기능) 스키마
-- Supabase SQL Editor 에서 한 번 실행. (reader-submissions 와 동일한 수동 적용 방식)
--
-- 권한 요약
--   webzine_issues : 발행분(published)은 누구나 읽기, 쓰기/미발행 열람은 편집부만
--   storage(webzine): 읽기는 공개, 업로드/삭제는 편집부만

CREATE TABLE IF NOT EXISTS public.webzine_issues (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,          -- URL 식별자 (예: vol-01)
  title       TEXT NOT NULL,
  issue_label TEXT,                          -- 표지 뱃지 (예: Vol.01)
  category    TEXT,                          -- 분류/시즌 (같은 값끼리 한 줄로 묶임. 예: 시즌 1)
  description TEXT,                           -- 쇼케이스 소개 문구
  cover_path  TEXT,                          -- 표지 이미지 storage 경로
  pdf_path    TEXT,                          -- 원본 PDF storage 경로
  page_count  INT,                           -- 페이지 수 (페이지 이미지 경로 계산용)
  published   BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 기존 테이블에도 안전하게 컬럼 추가 (이미 있으면 무시)
ALTER TABLE public.webzine_issues ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.webzine_issues ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE public.webzine_issues ENABLE ROW LEVEL SECURITY;

-- 발행된 호는 누구나 읽기
DROP POLICY IF EXISTS "webzine read published" ON public.webzine_issues;
CREATE POLICY "webzine read published" ON public.webzine_issues
  FOR SELECT USING (published = TRUE);

-- 편집부는 전체 읽기/쓰기 (미발행 포함). FOR ALL 이 SELECT 도 포함.
DROP POLICY IF EXISTS "webzine editor all" ON public.webzine_issues;
CREATE POLICY "webzine editor all" ON public.webzine_issues
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor = TRUE));

-- ════════════════════════════════════════════════════════════
-- Storage: webzine 버킷 (PDF + 표지 + 페이지 이미지)
-- ════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'webzine', 'webzine', TRUE,
  60 * 1024 * 1024,                          -- 60MB 상한 (웹용 PDF 가정)
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "webzine editor upload" ON storage.objects;
CREATE POLICY "webzine editor upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'webzine'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor = TRUE)
  );

DROP POLICY IF EXISTS "webzine editor delete" ON storage.objects;
CREATE POLICY "webzine editor delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'webzine'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor = TRUE)
  );

DROP POLICY IF EXISTS "webzine public read" ON storage.objects;
CREATE POLICY "webzine public read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'webzine');
