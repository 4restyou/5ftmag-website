-- 이북 판매(결제 열람권 생성) → 편집부 전원에게 알림 + 웹푸시.
--
-- ebook_entitlements 에 결제 소스(portone=카카오페이 / smartstore=주문번호 인증)로
-- 행이 생기면 편집부에게 알림을 넣는다. 수동 부여(manual)는 판매가 아니므로 제외.
-- user_notifications INSERT 시 기존 dispatch 트리거가 웹푸시까지 발송한다.

-- 1) type CHECK 제약에 'ebook_sold' 추가.
--    스키마 드리프트 방지를 위해 지금까지 사용된 모든 타입의 상위집합으로 재정의
--    (기존 행/트리거 INSERT 가 깨지지 않도록).
ALTER TABLE public.user_notifications
  DROP CONSTRAINT IF EXISTS user_notifications_type_check;
ALTER TABLE public.user_notifications
  ADD  CONSTRAINT user_notifications_type_check
       CHECK (type IN (
         'submission_approved',
         'submission_rejected',
         'submission_deleted',
         'submission_pending_editor',
         'listing_hidden',
         'listing_restored',
         'comment_reply',
         'proposal_approved',
         'proposal_rejected',
         'market_report_editor',
         'debug_test',
         'ebook_sold'
       ));

-- 2) 결제 열람권 생성 → 편집부 알림 트리거 함수
CREATE OR REPLACE FUNCTION public.notify_editors_ebook_sold()
RETURNS TRIGGER AS $$
DECLARE
  ed        RECORD;
  v_title   text;
  v_price   integer;
  v_channel text;
BEGIN
  -- 결제 경로만 (수동 부여 제외)
  IF NEW.source NOT IN ('portone', 'smartstore') THEN
    RETURN NEW;
  END IF;

  SELECT title, price INTO v_title, v_price
    FROM public.ebook_products WHERE id = NEW.product_id;

  v_channel := CASE NEW.source
                 WHEN 'portone'    THEN '카카오페이'
                 WHEN 'smartstore' THEN '스마트스토어'
                 ELSE NEW.source
               END;

  FOR ed IN SELECT user_id FROM public.profiles WHERE is_editor = TRUE
  LOOP
    INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
    VALUES (
      ed.user_id,
      'ebook_sold',
      NEW.product_id,
      '이북이 판매됐어요',
      COALESCE(v_title, '이북') || ' · ' || v_channel
        || COALESCE(' · ₩' || to_char(v_price, 'FM999,999,999'), ''),
      '/admin/analytics.html'
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS notify_editors_ebook_sold ON public.ebook_entitlements;
CREATE TRIGGER notify_editors_ebook_sold
  AFTER INSERT ON public.ebook_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.notify_editors_ebook_sold();

-- 3) 함수 권한 잠금 (트리거로만 실행)
REVOKE ALL ON FUNCTION public.notify_editors_ebook_sold() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
