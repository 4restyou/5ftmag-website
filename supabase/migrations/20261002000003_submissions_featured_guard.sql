-- 투고 소유자 가드에 "이주의 사진" 칸을 더한다 (보안 점검 P0, 2026-10-02).
--
-- "own submissions updatable" 정책은 본인 행이면 어떤 컬럼이든 고칠 수 있게 두고, 핵심 컬럼은
-- reader_submissions_owner_guard 트리거가 막는다. 그런데 9월에 더한 featured_at·featured_note
-- (20260904000001)는 그 보호 목록에 없어서, 승인된 투고자가 PATCH 한 번으로 자기 사진을 홈
-- "이주의 사진"에 걸고 편집부 한 줄 자리에 임의 문구를 넣을 수 있었다.
-- INSERT 도 검사하지 않아 처음부터 값을 넣어 두면 승인되는 순간 걸렸다.
--
-- 고침: 가드 함수에 featured_* 검사를 더하고, INSERT 에도 같은 가드를 건다(편집부가 아니면
-- status·reviewed_*·featured_* 를 비워 둔 채로만 넣을 수 있다). 재실행 안전.

CREATE OR REPLACE FUNCTION public.reader_submissions_owner_guard()
RETURNS TRIGGER AS $$
DECLARE
  is_editor_now BOOLEAN;
BEGIN
  SELECT COALESCE(is_editor, FALSE) INTO is_editor_now
  FROM public.profiles WHERE user_id = auth.uid();
  IF COALESCE(is_editor_now, FALSE) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- 편집부만 정할 수 있는 칸은 처음부터 비어 있어야 한다
    IF NEW.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'status 는 본인이 정할 수 없습니다'; END IF;
    IF NEW.rejection_reason IS NOT NULL THEN RAISE EXCEPTION 'rejection_reason 은 본인이 정할 수 없습니다'; END IF;
    IF NEW.reviewed_at      IS NOT NULL THEN RAISE EXCEPTION 'reviewed_at 는 본인이 정할 수 없습니다'; END IF;
    IF NEW.reviewed_by      IS NOT NULL THEN RAISE EXCEPTION 'reviewed_by 는 본인이 정할 수 없습니다'; END IF;
    IF NEW.featured_at      IS NOT NULL THEN RAISE EXCEPTION 'featured_at 는 편집부만 정할 수 있습니다'; END IF;
    IF NEW.featured_note    IS NOT NULL THEN RAISE EXCEPTION 'featured_note 는 편집부만 정할 수 있습니다'; END IF;
    RETURN NEW;
  END IF;

  IF NEW.status           IS DISTINCT FROM OLD.status           THEN RAISE EXCEPTION 'status 는 본인이 변경할 수 없습니다'; END IF;
  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN RAISE EXCEPTION 'rejection_reason 은 본인이 변경할 수 없습니다'; END IF;
  IF NEW.reviewed_at      IS DISTINCT FROM OLD.reviewed_at      THEN RAISE EXCEPTION 'reviewed_at 는 본인이 변경할 수 없습니다'; END IF;
  IF NEW.reviewed_by      IS DISTINCT FROM OLD.reviewed_by      THEN RAISE EXCEPTION 'reviewed_by 는 본인이 변경할 수 없습니다'; END IF;
  IF NEW.user_id          IS DISTINCT FROM OLD.user_id          THEN RAISE EXCEPTION 'user_id 변경 불가'; END IF;
  IF NEW.storage_path     IS DISTINCT FROM OLD.storage_path     THEN RAISE EXCEPTION '사진 교체는 별도 절차로만 가능합니다'; END IF;
  IF NEW.theme_month      IS DISTINCT FROM OLD.theme_month      THEN RAISE EXCEPTION 'theme_month 은 본인이 변경할 수 없습니다'; END IF;
  IF NEW.consent_publish  IS DISTINCT FROM OLD.consent_publish  THEN RAISE EXCEPTION 'consent_publish 는 변경할 수 없습니다'; END IF;
  IF NEW.featured_at      IS DISTINCT FROM OLD.featured_at      THEN RAISE EXCEPTION 'featured_at 는 편집부만 변경할 수 있습니다'; END IF;
  IF NEW.featured_note    IS DISTINCT FROM OLD.featured_note    THEN RAISE EXCEPTION 'featured_note 는 편집부만 변경할 수 있습니다'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS reader_submissions_owner_guard ON public.reader_submissions;
CREATE TRIGGER reader_submissions_owner_guard
  BEFORE INSERT OR UPDATE ON public.reader_submissions
  FOR EACH ROW EXECUTE FUNCTION public.reader_submissions_owner_guard();
