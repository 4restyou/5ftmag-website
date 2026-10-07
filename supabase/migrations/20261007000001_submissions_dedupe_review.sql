-- 중복 거르기 손보기 (운영자 요청, 2026-10-07). 20261006000002 다음.
--
-- 1) 기준을 6 → 3 으로 낮춘다. 실제 사진 4천여 장에 돌려 보니 차이 5~6 은 하늘·바다처럼
--    무늬가 적은 전혀 다른 사진이었고, 진짜 중복은 0 이었다(시험에서도 재압축·축소·밝기 0~1).
--    이미 붙은 표시 가운데 새 기준을 넘는 것은 지운다.
-- 2) 「다른 사진이에요」: 편집부가 고른 묶음은 reader_duplicate_dismissals 에 남겨 다시 보이지 않게 한다.
-- 3) 중복 반려와 반려 취소: duplicate_rejected 로 중복 반려를 구분하고 status_before_duplicate 에
--    원래 상태를 남겨 되돌릴 수 있게 한다. 이 둘은 독자에게 알리지 않는다(같은 사진이 이미 실려
--    있어 독자 쪽에서 달라지는 것이 없다).
-- 재실행 안전.

ALTER TABLE public.reader_submissions ADD COLUMN IF NOT EXISTS duplicate_rejected boolean NOT NULL DEFAULT false;
ALTER TABLE public.reader_submissions ADD COLUMN IF NOT EXISTS status_before_duplicate text;
ALTER TABLE public.reader_submissions DROP CONSTRAINT IF EXISTS reader_submissions_status_before_duplicate_check;
ALTER TABLE public.reader_submissions ADD CONSTRAINT reader_submissions_status_before_duplicate_check
  CHECK (status_before_duplicate IS NULL OR status_before_duplicate IN ('pending', 'approved'));
CREATE INDEX IF NOT EXISTS idx_submissions_duplicate_rejected
  ON public.reader_submissions (created_at DESC) WHERE duplicate_rejected;

-- 아래 두 UPDATE 는 편집부 로그인 없이 돈다. 본인 수정 보호 트리거(reader_submissions_owner_guard)가
-- auth.uid() 가 없으면 독자로 보고 막으므로, 이 두 문장 동안만 끈다. 마이그레이션은 한 트랜잭션이라
-- 중간에 실패하면 끈 상태도 함께 되돌아간다.
ALTER TABLE public.reader_submissions DISABLE TRIGGER reader_submissions_owner_guard;

-- 어제(20261006000002 직후) 관리 화면의 「이 사진 반려(중복)」 는 일반 반려로 처리돼 이 표시가 없다.
-- 그 문구로 반려된 사진에 표시를 붙여 「반려 취소」 가 뜨게 한다. 원래 상태는 남아 있지 않아
-- 취소하면 대기로 돌아간다(COALESCE). 편집부가 다시 승인하면 된다.
UPDATE public.reader_submissions
   SET duplicate_rejected = true
 WHERE status = 'rejected'
   AND NOT duplicate_rejected
   AND rejection_reason = '같은 사진이 이미 올라와 있어 한 장만 싣기로 했어요.';

-- ── 1) 기준 3 ──
CREATE OR REPLACE FUNCTION public.reader_phash_threshold()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$;

UPDATE public.reader_submissions
   SET dup_of = NULL, dup_distance = NULL
 WHERE dup_of IS NOT NULL AND dup_distance > public.reader_phash_threshold();

ALTER TABLE public.reader_submissions ENABLE TRIGGER reader_submissions_owner_guard;

-- ── 2) 「다른 사진이에요」 ──
-- 두 id 는 작은 쪽을 first 에 넣어 한 묶음이 한 줄이 되게 한다.
CREATE TABLE IF NOT EXISTS public.reader_duplicate_dismissals (
  first_id     uuid NOT NULL REFERENCES public.reader_submissions(id) ON DELETE CASCADE,
  second_id    uuid NOT NULL REFERENCES public.reader_submissions(id) ON DELETE CASCADE,
  dismissed_by uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (first_id, second_id),
  CHECK (first_id < second_id)
);
ALTER TABLE public.reader_duplicate_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "editors manage dismissals" ON public.reader_duplicate_dismissals;
CREATE POLICY "editors manage dismissals" ON public.reader_duplicate_dismissals
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor));

-- 저장 때 표시: 기준을 따르고, 「다른 사진」으로 고른 짝은 건너뛴다. 새 행이라 짝이 아직 없으니
-- 표시 대상만 바뀐다. 중복 반려 칸은 독자가 넣지 못하게 늘 비운다.
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
  NEW.duplicate_rejected := false;
  NEW.status_before_duplicate := NULL;
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

-- 묶음 목록: 「다른 사진」으로 고른 짝은 빼고, 둘 중 하나가 반려됐는지(처리한 묶음)를 함께 준다.
DROP FUNCTION IF EXISTS public.admin_reader_duplicate_pairs(integer);
CREATE OR REPLACE FUNCTION public.admin_reader_duplicate_pairs(p_max_distance integer DEFAULT NULL)
RETURNS TABLE (
  first_id uuid, second_id uuid, distance integer, user_id uuid,
  first_path text, second_path text, first_status text, second_status text,
  first_created timestamptz, second_created timestamptz,
  first_duplicate_rejected boolean, second_duplicate_rejected boolean,
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
         a.duplicate_rejected, b.duplicate_rejected,
         COALESCE(b.submitter_name, a.submitter_name), COALESCE(b.instagram, a.instagram)
  FROM public.reader_submissions a
  JOIN public.reader_submissions b
    ON b.user_id = a.user_id
   AND (a.created_at, a.id) < (b.created_at, b.id)
  WHERE a.phash IS NOT NULL AND b.phash IS NOT NULL
    AND public.reader_phash_distance(a.phash, b.phash)
        <= COALESCE(p_max_distance, public.reader_phash_threshold())
    AND NOT EXISTS (
      SELECT 1 FROM public.reader_duplicate_dismissals d
      WHERE d.first_id = LEAST(a.id, b.id) AND d.second_id = GREATEST(a.id, b.id)
    )
  ORDER BY 3, b.created_at DESC
  LIMIT 500;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reader_duplicate_pairs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reader_duplicate_pairs(integer) TO authenticated;

-- 「다른 사진이에요」: 짝을 기록하고, 서로를 가리키던 중복 의심 표시를 지운다.
CREATE OR REPLACE FUNCTION public.admin_dismiss_duplicate_pair(p_a uuid, p_b uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor) THEN
    RAISE EXCEPTION 'editor only' USING ERRCODE = '42501';
  END IF;
  IF p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN
    RAISE EXCEPTION 'two different submissions required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.reader_duplicate_dismissals (first_id, second_id, dismissed_by)
  VALUES (LEAST(p_a, p_b), GREATEST(p_a, p_b), auth.uid())
  ON CONFLICT (first_id, second_id) DO NOTHING;
  UPDATE public.reader_submissions
     SET dup_of = NULL, dup_distance = NULL
   WHERE (id = p_a AND dup_of = p_b) OR (id = p_b AND dup_of = p_a);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_dismiss_duplicate_pair(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dismiss_duplicate_pair(uuid, uuid) TO authenticated;

-- ── 3) 중복 반려 / 반려 취소 ──
CREATE OR REPLACE FUNCTION public.admin_reject_duplicate(p_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prev text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor) THEN
    RAISE EXCEPTION 'editor only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.reader_submissions
     SET status_before_duplicate = status,
         duplicate_rejected = true,
         status = 'rejected',
         rejection_reason = '같은 사진이 이미 올라와 있어 한 장만 싣기로 했어요.',
         reviewed_at = now(),
         reviewed_by = auth.uid()
   WHERE id = p_id AND status IN ('pending', 'approved')
  RETURNING status_before_duplicate INTO prev;
  IF prev IS NULL THEN
    RAISE EXCEPTION '이미 반려됐거나 찾을 수 없는 사진입니다' USING ERRCODE = 'P0002';
  END IF;
  RETURN prev;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reject_duplicate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_duplicate(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_undo_duplicate_reject(p_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  restored text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor) THEN
    RAISE EXCEPTION 'editor only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.reader_submissions
     SET status = COALESCE(status_before_duplicate, 'pending'),
         status_before_duplicate = NULL,
         rejection_reason = NULL,
         reviewed_at = now(),
         reviewed_by = auth.uid()
   WHERE id = p_id AND duplicate_rejected AND status = 'rejected'
  RETURNING status INTO restored;
  IF restored IS NULL THEN
    RAISE EXCEPTION '중복 반려한 사진이 아닙니다' USING ERRCODE = 'P0002';
  END IF;
  -- duplicate_rejected 는 아래 트리거가 내린다. 알림 트리거는 OLD 의 표시로 "취소" 를 알아본다.
  RETURN restored;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_undo_duplicate_reject(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_undo_duplicate_reject(uuid) TO authenticated;

-- 반려에서 다른 상태로 바뀌면(반려 취소든, 반려됨 탭의 「승인으로 변경」이든) 중복 반려 표시를 내린다.
CREATE OR REPLACE FUNCTION public.reader_submissions_clear_duplicate_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'rejected' THEN
    NEW.duplicate_rejected := false;
    NEW.status_before_duplicate := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reader_submissions_clear_duplicate_flag ON public.reader_submissions;
CREATE TRIGGER reader_submissions_clear_duplicate_flag
  BEFORE UPDATE ON public.reader_submissions
  FOR EACH ROW EXECUTE FUNCTION public.reader_submissions_clear_duplicate_flag();

-- 알림: 중복 반려(NEW.duplicate_rejected)와 그 취소(OLD.duplicate_rejected)는 독자에게 보내지 않는다.
-- 그 밖은 20261002000005 와 같다.
CREATE OR REPLACE FUNCTION public.notify_reader_submission_status()
RETURNS TRIGGER AS $$
BEGIN
  -- 승인 (중복 반려를 취소해 되돌린 경우는 빼고)
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'
     AND NOT COALESCE(OLD.duplicate_rejected, false) THEN
    INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link, meta)
    VALUES (
      NEW.user_id,
      'submission_approved',
      NEW.id,
      '사진이 승인됐어요',
      COALESCE(NULLIF(NEW.film, ''), '필름') || ' 사진이 라이브러리에 공개됐어요.',
      '/me.html#photos',
      jsonb_build_object('film', NULLIF(NEW.film, ''))
    );
  -- 반려 (중복 반려는 빼고)
  ELSIF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected'
        AND NOT COALESCE(NEW.duplicate_rejected, false) THEN
    INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link, meta)
    VALUES (
      NEW.user_id,
      'submission_rejected',
      NEW.id,
      '사진이 반려됐어요',
      COALESCE(NULLIF(NEW.rejection_reason, ''), '이번 사진은 싣지 않기로 했어요. 다른 컷으로 다시 응모해 주세요.'),
      '/me.html#photos',
      jsonb_build_object('film', NULLIF(NEW.film, ''), 'reason', NULLIF(NEW.rejection_reason, ''))
    );
  END IF;

  -- 검토 요청이 처리(pending → 그 외)됐으면 편집부 검토 알림을 자동 읽음.
  IF NEW.status IS DISTINCT FROM 'pending' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.user_notifications
       SET read_at = NOW()
     WHERE type = 'submission_pending_editor'
       AND related_id = NEW.id
       AND read_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = off;

REVOKE ALL ON FUNCTION public.notify_reader_submission_status() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
