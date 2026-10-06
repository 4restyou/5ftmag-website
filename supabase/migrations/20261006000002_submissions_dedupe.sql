-- 독자 사진 중복 거르기 (운영자 요청, 2026-10-06).
--
-- 두 가지 지문을 둔다.
--   source_sha256  올린 원본 파일 바이트의 SHA-256(16진수 64자). 같은 사람이 같은 파일을
--                  다시 올리면 저장 자체를 막는다. 이름만 바꾼 파일도 잡히고, 다른
--                  사진을 잘못 막을 일은 사실상 없다. 대신 다시 내보내거나 보정한 파일은
--                  바이트가 달라 못 잡는다. 기존 사진은 원본이 남아 있지 않아 채울 수 없다.
--   phash          저장된(줄인) 사진의 dHash 64비트(16진수 16자). 크기 조정·재압축·가벼운
--                  보정은 같은 사진으로 본다. 연속 컷처럼 비슷한 다른 사진을 잡을 수 있어
--                  막지 않고 dup_of 에 "중복 의심" 으로 표시만 한다. 편집부가 판단한다.
--
-- 지문은 브라우저가 계산해 넣는다(js/image-processor.js 의 PhotoFingerprint). 기존 사진의
-- phash 는 관리 화면의 「기존 사진 지문 채우기」 가 편집부 권한으로 채운다.
-- 재실행 안전.

ALTER TABLE public.reader_submissions ADD COLUMN IF NOT EXISTS source_sha256 text;
ALTER TABLE public.reader_submissions ADD COLUMN IF NOT EXISTS phash text;
ALTER TABLE public.reader_submissions ADD COLUMN IF NOT EXISTS dup_of uuid;
ALTER TABLE public.reader_submissions ADD COLUMN IF NOT EXISTS dup_distance smallint;

ALTER TABLE public.reader_submissions DROP CONSTRAINT IF EXISTS reader_submissions_source_sha256_format;
ALTER TABLE public.reader_submissions ADD CONSTRAINT reader_submissions_source_sha256_format
  CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE public.reader_submissions DROP CONSTRAINT IF EXISTS reader_submissions_phash_format;
ALTER TABLE public.reader_submissions ADD CONSTRAINT reader_submissions_phash_format
  CHECK (phash IS NULL OR phash ~ '^[0-9a-f]{16}$');
ALTER TABLE public.reader_submissions DROP CONSTRAINT IF EXISTS reader_submissions_dup_of_fkey;
ALTER TABLE public.reader_submissions ADD CONSTRAINT reader_submissions_dup_of_fkey
  FOREIGN KEY (dup_of) REFERENCES public.reader_submissions(id) ON DELETE SET NULL;

-- 같은 사람 + 같은 원본 파일은 한 번만. 지문이 없는 옛 행은 걸리지 않는다.
CREATE UNIQUE INDEX IF NOT EXISTS reader_submissions_user_source_sha256_key
  ON public.reader_submissions (user_id, source_sha256)
  WHERE source_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_submissions_user_phash
  ON public.reader_submissions (user_id)
  WHERE phash IS NOT NULL;

-- 두 dHash 사이의 다른 비트 수(0~64). 작을수록 닮았다.
CREATE OR REPLACE FUNCTION public.reader_phash_distance(a text, b text)
RETURNS integer
LANGUAGE sql IMMUTABLE STRICT
SET search_path = public, pg_temp
AS $$
  SELECT bit_count((('x' || a)::bit(64)) # (('x' || b)::bit(64)))::integer
$$;

-- 이 값 이하이면 "중복 의심". 64비트 중 6비트까지는 재압축·크기 조정의 흔들림으로 본다.
CREATE OR REPLACE FUNCTION public.reader_phash_threshold()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 6 $$;

-- 저장할 때 같은 사람의 사진 가운데 가장 닮은 것을 찾아 dup_of 에 적는다.
-- 클라이언트가 보낸 dup_of 는 믿지 않고 늘 다시 계산한다.
CREATE OR REPLACE FUNCTION public.reader_submissions_mark_duplicate()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  best_id uuid;
  best_d integer;
BEGIN
  NEW.dup_of := NULL;
  NEW.dup_distance := NULL;
  IF NEW.phash IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT s.id, public.reader_phash_distance(s.phash, NEW.phash)
    INTO best_id, best_d
  FROM public.reader_submissions s
  WHERE s.user_id = NEW.user_id
    AND s.phash IS NOT NULL
    AND s.id IS DISTINCT FROM NEW.id
  ORDER BY public.reader_phash_distance(s.phash, NEW.phash), s.created_at
  LIMIT 1;
  IF best_id IS NOT NULL AND best_d <= public.reader_phash_threshold() THEN
    NEW.dup_of := best_id;
    NEW.dup_distance := best_d;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reader_submissions_mark_duplicate ON public.reader_submissions;
CREATE TRIGGER reader_submissions_mark_duplicate
  BEFORE INSERT ON public.reader_submissions
  FOR EACH ROW EXECUTE FUNCTION public.reader_submissions_mark_duplicate();

-- 본인 확인용: 같은 원본을 이미 올렸는지. 업로드 전에 화면이 묻는다(파일을 올린 뒤
-- 저장에서 막히면 저장소에 쓸모없는 파일이 남기 때문).
CREATE OR REPLACE FUNCTION public.reader_submission_exists_by_sha(p_sha text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.reader_submissions
  WHERE user_id = auth.uid() AND source_sha256 = p_sha
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.reader_submission_exists_by_sha(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reader_submission_exists_by_sha(text) TO authenticated;

-- 편집부용: 같은 사람의 사진 가운데 닮은 두 장을 묶어 돌려준다(기존 사진 정리).
CREATE OR REPLACE FUNCTION public.admin_reader_duplicate_pairs(p_max_distance integer DEFAULT NULL)
RETURNS TABLE (
  first_id uuid, second_id uuid, distance integer, user_id uuid,
  first_path text, second_path text, first_status text, second_status text,
  first_created timestamptz, second_created timestamptz,
  submitter_name text, instagram text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND is_editor) THEN
    RAISE EXCEPTION 'editor only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.id, b.id, public.reader_phash_distance(a.phash, b.phash), a.user_id,
         a.storage_path, b.storage_path, a.status, b.status,
         a.created_at, b.created_at,
         COALESCE(b.submitter_name, a.submitter_name), COALESCE(b.instagram, a.instagram)
  FROM public.reader_submissions a
  JOIN public.reader_submissions b
    ON b.user_id = a.user_id
   AND (a.created_at, a.id) < (b.created_at, b.id)
  WHERE a.phash IS NOT NULL AND b.phash IS NOT NULL
    AND public.reader_phash_distance(a.phash, b.phash)
        <= COALESCE(p_max_distance, public.reader_phash_threshold())
  ORDER BY 3, b.created_at DESC
  LIMIT 500;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reader_duplicate_pairs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reader_duplicate_pairs(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
