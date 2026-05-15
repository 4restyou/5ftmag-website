-- 사용자 알림(in-app) — 사진/매물 조치 통지
-- ════════════════════════════════════════════════════════════
-- 1) user_notifications 테이블
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.user_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN (
    'submission_approved',
    'submission_rejected',
    'submission_deleted',
    'listing_hidden',
    'listing_restored'
  )),
  related_id  UUID,                          -- submission_id 또는 listing_id
  title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body        TEXT CHECK (body IS NULL OR char_length(body) <= 500),
  link        TEXT CHECK (link IS NULL OR char_length(link) <= 200),
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user
  ON public.user_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_unread
  ON public.user_notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

-- ════════════════════════════════════════════════════════════
-- 2) RLS — 본인만 SELECT / UPDATE(read_at) / DELETE
--    INSERT 는 트리거 함수(SECURITY DEFINER)만 가능
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own notifications readable" ON public.user_notifications;
CREATE POLICY "own notifications readable" ON public.user_notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- read_at 만 변경 가능하도록 트리거에서 컬럼 가드
DROP POLICY IF EXISTS "own notifications updatable" ON public.user_notifications;
CREATE POLICY "own notifications updatable" ON public.user_notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own notifications deletable" ON public.user_notifications;
CREATE POLICY "own notifications deletable" ON public.user_notifications
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.user_notifications_owner_guard()
RETURNS TRIGGER AS $$
BEGIN
  -- read_at 외에는 사용자가 변경할 수 없음
  IF NEW.user_id    IS DISTINCT FROM OLD.user_id    THEN RAISE EXCEPTION 'user_id 변경 불가'; END IF;
  IF NEW.type       IS DISTINCT FROM OLD.type       THEN RAISE EXCEPTION 'type 변경 불가';    END IF;
  IF NEW.related_id IS DISTINCT FROM OLD.related_id THEN RAISE EXCEPTION 'related_id 변경 불가'; END IF;
  IF NEW.title      IS DISTINCT FROM OLD.title      THEN RAISE EXCEPTION 'title 변경 불가';   END IF;
  IF NEW.body       IS DISTINCT FROM OLD.body       THEN RAISE EXCEPTION 'body 변경 불가';    END IF;
  IF NEW.link       IS DISTINCT FROM OLD.link       THEN RAISE EXCEPTION 'link 변경 불가';    END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'created_at 변경 불가'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_notifications_owner_guard ON public.user_notifications;
CREATE TRIGGER user_notifications_owner_guard
  BEFORE UPDATE ON public.user_notifications
  FOR EACH ROW EXECUTE FUNCTION public.user_notifications_owner_guard();

-- ════════════════════════════════════════════════════════════
-- 3) reader_submissions 상태 변경 → 알림 INSERT
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.notify_reader_submission_status()
RETURNS TRIGGER AS $$
BEGIN
  -- 승인
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
    VALUES (
      NEW.user_id,
      'submission_approved',
      NEW.id,
      '사진이 승인됐어요',
      COALESCE(NULLIF(NEW.film, ''), '필름') || ' 사진이 라이브러리에 공개됐어요.',
      '/me.html#photos'
    );
  -- 반려
  ELSIF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
    VALUES (
      NEW.user_id,
      'submission_rejected',
      NEW.id,
      '사진이 반려됐어요',
      COALESCE(NULLIF(NEW.rejection_reason, ''), '편집부 사유를 /me.html 에서 확인하세요.'),
      '/me.html#photos'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS notify_reader_submission_status ON public.reader_submissions;
CREATE TRIGGER notify_reader_submission_status
  AFTER UPDATE OF status ON public.reader_submissions
  FOR EACH ROW EXECUTE FUNCTION public.notify_reader_submission_status();

-- ════════════════════════════════════════════════════════════
-- 4) reader_submissions 삭제 → 편집부 삭제만 알림
--    본인 삭제(`auth.uid() = OLD.user_id`)는 알림 없음
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.notify_reader_submission_deleted()
RETURNS TRIGGER AS $$
DECLARE
  acting UUID;
BEGIN
  acting := auth.uid();
  IF acting IS NULL OR acting <> OLD.user_id THEN
    INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
    VALUES (
      OLD.user_id,
      'submission_deleted',
      OLD.id,
      '사진이 편집부에 의해 삭제됐어요',
      '문의가 있으면 편집부로 연락해주세요.',
      '/me.html#photos'
    );
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS notify_reader_submission_deleted ON public.reader_submissions;
CREATE TRIGGER notify_reader_submission_deleted
  AFTER DELETE ON public.reader_submissions
  FOR EACH ROW EXECUTE FUNCTION public.notify_reader_submission_deleted();

-- ════════════════════════════════════════════════════════════
-- 5) market_listings 편집부 조치 → 알림
--    본인 변경은 알림 없음
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.notify_market_listing_status()
RETURNS TRIGGER AS $$
DECLARE
  acting UUID;
BEGIN
  acting := auth.uid();
  -- 본인 조작은 알림 없음
  IF acting IS NOT NULL AND acting = OLD.user_id THEN RETURN NEW; END IF;

  IF NEW.status = 'hidden' AND OLD.status IS DISTINCT FROM 'hidden' THEN
    INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
    VALUES (
      OLD.user_id,
      'listing_hidden',
      NEW.id,
      '매물이 숨김 처리됐어요',
      '편집부가 매물을 검토 후 숨김 상태로 전환했어요.',
      '/me.html#market'
    );
  ELSIF OLD.status = 'hidden' AND NEW.status IS DISTINCT FROM 'hidden' THEN
    INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
    VALUES (
      OLD.user_id,
      'listing_restored',
      NEW.id,
      '매물이 다시 공개됐어요',
      '편집부가 매물을 복구했어요.',
      '/me.html#market'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS notify_market_listing_status ON public.market_listings;
CREATE TRIGGER notify_market_listing_status
  AFTER UPDATE OF status ON public.market_listings
  FOR EACH ROW EXECUTE FUNCTION public.notify_market_listing_status();

-- ════════════════════════════════════════════════════════════
-- 6) 함수 권한 잠금
-- ════════════════════════════════════════════════════════════
REVOKE ALL ON FUNCTION public.notify_reader_submission_status()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_reader_submission_deleted() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_market_listing_status()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.user_notifications_owner_guard()   FROM PUBLIC, anon, authenticated;
