-- ════════════════════════════════════════════════════════════
-- 회원 스스로 탈퇴 (account-delete 엣지 함수)
--
-- 탈퇴는 함수가 회원 데이터를 지운 뒤 auth.admin.deleteUser 로 auth 사용자를 지운다.
-- 그때 남겨야 하는 행이 auth.users 를 바라보는 외래키에 걸려 함께 사라지거나(CASCADE)
-- 삭제를 막는다(NO ACTION). 남길 행의 외래키를 ON DELETE SET NULL 로 바꾸고 NOT NULL 을 푼다.
--
--   · comments.user_id            CASCADE → SET NULL. 댓글은 「탈퇴한 회원」으로 남긴다(운영자 결정).
--   · ebook_entitlements.user_id  CASCADE → SET NULL. 이북 열람권(구매 기록)은 전자상거래법상 5년 보존.
--   · ebook_checkout_orders.buyer_id  NO ACTION → SET NULL. 결제 주문 장부. 구매 이력이 있으면
--                                  auth 사용자 삭제 자체가 실패했다. 고칠 수 없는 장부라 갱신 트리거가
--                                  막는데, 외래키가 buyer_id 만 비우는 경우는 통과시킨다.
--   · 편집부가 남긴 처리 기록(신고 처리자·투고 검토자·중복 판정자·카메라 브랜드 등록자)
--     NO ACTION → SET NULL. 편집부 계정은 함수가 탈퇴를 막지만, 편집부에서 빠진 뒤 탈퇴하는
--     경우 이 외래키가 auth 삭제를 막아 반쯤 지워진 상태로 멈춘다.
--
-- 외래키 이름이 환경마다 다를 수 있어 pg_constraint 에서 열 이름으로 찾는다.
-- 이미 SET NULL 인 외래키는 그대로 둔다. 모두 전부터 같은 열에 외래키가 있던 자리라
-- 기존 데이터가 새 외래키를 어길 일은 없다(참조 대상과 열은 그대로, 삭제 동작만 바뀐다).
-- 공개 뷰 comments_with_meta 는 고치지 않는다. profiles 와 LEFT JOIN 이라 user_id 가 비면
-- display_name·avatar_url·is_editor 가 NULL 로 나가고, 화면이 「탈퇴한 회원」으로 표시한다.
-- 재실행 안전.
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE
  spec record;
  fk record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('comments', 'user_id'),
      ('ebook_entitlements', 'user_id'),
      ('ebook_checkout_orders', 'buyer_id'),
      ('market_reports', 'resolved_by'),
      ('reader_submissions', 'reviewed_by'),
      ('reader_duplicate_dismissals', 'dismissed_by'),
      ('camera_brand_overrides', 'created_by')
    ) AS v(tbl, col)
  LOOP
    IF to_regclass('public.' || spec.tbl) IS NULL THEN
      CONTINUE;
    END IF;

    -- SET NULL 이 아닌 auth.users 외래키를 걷어낸다
    FOR fk IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
      WHERE con.contype = 'f'
        AND con.conrelid = ('public.' || spec.tbl)::regclass
        AND con.confrelid = 'auth.users'::regclass
        AND a.attname = spec.col
        AND con.confdeltype <> 'n'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', spec.tbl, fk.conname);
    END LOOP;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
      WHERE con.contype = 'f'
        AND con.conrelid = ('public.' || spec.tbl)::regclass
        AND con.confrelid = 'auth.users'::regclass
        AND a.attname = spec.col
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE SET NULL',
        spec.tbl, spec.tbl || '_' || spec.col || '_fkey', spec.col);
    END IF;

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', spec.tbl, spec.col);
  END LOOP;
END
$$;

-- 결제 주문 장부는 여전히 고칠 수 없다. 외래키(ON DELETE SET NULL)가 buyer_id 만 비우는 갱신만 통과.
-- 이 테이블에 UPDATE 권한을 가진 역할이 없어(service_role 도 SELECT·INSERT 만) 외래키 동작 말고는
-- 이 분기에 닿을 수 없다.
CREATE OR REPLACE FUNCTION public.ebook_checkout_orders_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.buyer_id IS NOT NULL AND NEW.buyer_id IS NULL
     AND (to_jsonb(NEW) - 'buyer_id') = (to_jsonb(OLD) - 'buyer_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'checkout orders are immutable' USING ERRCODE = '23514';
END;
$$;
REVOKE ALL ON FUNCTION public.ebook_checkout_orders_immutable() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
