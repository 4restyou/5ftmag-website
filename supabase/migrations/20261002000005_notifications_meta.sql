-- 알림에 재료(meta)를 더해 화면이 독자의 언어로 문구를 만들 수 있게 한다 (정비 C2, 2026-10-02).
--
-- 알림의 title·body·link 는 트리거가 한국어로 적어 넣고, Web Push 디스패치(20260620000001)가
-- 그 값을 그대로 보낸다. 그래서 문구를 DB 에서 빼 버리면 푸시가 빈다. 대신 type 과 재료(meta)를
-- 함께 저장하고, 벨 패널·내 정보 화면은 type + meta 로 세 언어 문구를 만든다(site-common.js).
-- meta 가 없는 옛 행과 알 수 없는 type 은 저장된 title·body 를 그대로 보여 준다(하위 호환).
--
-- 반려 사유가 없을 때의 본문도 바꾼다. 전에는 "편집부 사유를 /me.html 에서 확인하세요" 였는데,
-- 내 정보에는 사유 칸이 없어 독자가 빈 곳을 보게 됐다. 이제는 사유가 없으면
-- "이번 사진은 싣지 않기로 했어요. 다른 컷으로 다시 응모해 주세요." 가 나간다.
-- 재실행 안전.

ALTER TABLE public.user_notifications
  ADD COLUMN IF NOT EXISTS meta JSONB;

COMMENT ON COLUMN public.user_notifications.meta IS
  '화면이 언어별 문구를 만들 때 쓰는 재료 (film·reason·date 등). 옛 행은 NULL';

-- 사진 승인·반려 알림: meta 에 film·reason 을 넣는다. 편집부 검토 알림 자동 읽음은 그대로.
CREATE OR REPLACE FUNCTION public.notify_reader_submission_status()
RETURNS TRIGGER AS $$
BEGIN
  -- 승인
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
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
  -- 반려
  ELSIF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
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
