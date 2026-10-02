-- 보안 하드닝 2차 — 2026-10-02 전반 점검(보안·개인정보) 반영.
--
-- 전제는 1차(20260710000001)와 같다. anon 키·요청 주소·클라이언트 JS 는 공개이고,
-- 막는 힘은 RLS·트리거·정의자 함수에 있다. 항목마다 무엇을 왜 막는지 적는다.
-- 전부 재실행 안전(DROP ... IF EXISTS / CREATE OR REPLACE / IF NOT EXISTS).

-- ════════════════════════════════════════════════════════════
-- 1) [P1] profiles_public — 전 가입자 로스터 노출 축소 (운영자 결정: 공개 활동자만)
--    WHERE 가 없어 anon 이 가입자 전원의 구글 이름·아바타·편집부 여부를 한 번에
--    받을 수 있었다. 이제 다음 중 하나에 해당하는 행만 돌려준다.
--      · 편집부(is_editor) · 본인(헤더 이름·내 정보) · 호출자가 편집부(회원 검색·메시지함)
--      · 공개 활동이 있는 사람: 삭제 안 된 댓글, 승인된 투고, 공개 매물, 댓글 좋아요
--    user_favorites 는 본인만 보는 비공개 기록이라 "공개 활동"에 넣지 않는다.
--    컬럼 목록과 정의자 권한(security_invoker=false)은 그대로 둔다.
--    댓글·투고·매물 화면은 profiles 베이스를 직접 조인하는 뷰라 영향이 없다.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.profiles_public AS
SELECT p.user_id, p.display_name, p.avatar_url, p.is_editor, p.bio
FROM public.profiles p
WHERE p.is_editor = TRUE
   OR p.user_id = auth.uid()
   OR EXISTS (SELECT 1 FROM public.profiles e WHERE e.user_id = auth.uid() AND e.is_editor = TRUE)
   OR EXISTS (SELECT 1 FROM public.comments c WHERE c.user_id = p.user_id AND c.deleted_at IS NULL)
   OR EXISTS (SELECT 1 FROM public.reader_submissions s WHERE s.user_id = p.user_id AND s.status = 'approved')
   OR EXISTS (SELECT 1 FROM public.market_listings l WHERE l.user_id = p.user_id AND l.status IN ('available','reserved','sold'))
   OR EXISTS (SELECT 1 FROM public.likes k WHERE k.user_id = p.user_id);

ALTER VIEW public.profiles_public SET (security_invoker = false);
GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- ════════════════════════════════════════════════════════════
-- 2) [P1] 댓글 — 삭제 본문 노출 · 삭제 되돌리기 · 수정으로 금칙어 우회
--
-- 2a) 삭제한 댓글 본문을 남이 읽지 못하게 한다.
--     본문을 지우는 대신 "보는 쪽"을 막는다. body 에 1~2000자 CHECK 가 있어 빈 문자열로
--     덮을 수 없고, 관리 화면(admin/comments.html)이 삭제 댓글의 본문을 보고 "복구"하므로
--     원문이 남아 있어야 한다. 그래서
--       · 베이스 SELECT 정책: 삭제 안 된 행 + 본인 행 + 편집부만 (realtime 도 이 정책을 따른다)
--       · comments_with_meta 뷰: 삭제 행의 body 를 편집부가 아니면 '' 로 내보낸다
--     클라이언트 수정 없이 관리 화면 복구가 그대로 동작한다.
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "comments_select" ON public.comments;
CREATE POLICY "comments_select" ON public.comments
  FOR SELECT
  USING (
    deleted_at IS NULL
    OR auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor = TRUE)
  );

CREATE OR REPLACE VIEW public.comments_with_meta AS
SELECT
  c.id,
  c.page_id,
  c.user_id,
  c.parent_id,
  CASE
    WHEN c.deleted_at IS NULL THEN c.body
    WHEN EXISTS (SELECT 1 FROM public.profiles e WHERE e.user_id = auth.uid() AND e.is_editor = TRUE) THEN c.body
    ELSE ''
  END AS body,
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

GRANT SELECT ON public.comments_with_meta TO anon, authenticated;

-- 2b) 작성자 UPDATE 는 본문 수정과 본인 삭제만.
--     "comments_update_own" 정책은 본인 행이면 어떤 칸이든 바꿀 수 있어, 편집부가 가린 댓글을
--     작성자가 deleted_at=null 로 되살릴 수 있었다. 편집부가 아니면
--       · 이미 삭제된 댓글은 손댈 수 없다(복구·수정 모두)
--       · id·page_id·user_id·parent_id·created_at 은 바꿀 수 없다
--       · 본문이 그대로면 updated_at 도 그대로 둔다("수정됨" 표시 위조 방지)
--     본문 수정 시 updated_at 은 기존 comments_set_updated_at 트리거가 now() 로 채운다.
CREATE OR REPLACE FUNCTION public.comments_owner_guard()
RETURNS TRIGGER AS $$
DECLARE
  is_editor_now BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;   -- service_role / SQL Editor
  END IF;
  SELECT COALESCE(is_editor, FALSE) INTO is_editor_now
  FROM public.profiles WHERE user_id = auth.uid();
  IF COALESCE(is_editor_now, FALSE) THEN
    RETURN NEW;
  END IF;

  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION '삭제된 댓글은 바꿀 수 없습니다';
  END IF;
  IF NEW.id         IS DISTINCT FROM OLD.id         THEN RAISE EXCEPTION 'id 변경 불가'; END IF;
  IF NEW.page_id    IS DISTINCT FROM OLD.page_id    THEN RAISE EXCEPTION 'page_id 변경 불가'; END IF;
  IF NEW.user_id    IS DISTINCT FROM OLD.user_id    THEN RAISE EXCEPTION 'user_id 변경 불가'; END IF;
  IF NEW.parent_id  IS DISTINCT FROM OLD.parent_id  THEN RAISE EXCEPTION 'parent_id 변경 불가'; END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'created_at 변경 불가'; END IF;
  IF NEW.body IS NOT DISTINCT FROM OLD.body THEN
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS comments_owner_guard ON public.comments;
CREATE TRIGGER comments_owner_guard
  BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.comments_owner_guard();

REVOKE ALL ON FUNCTION public.comments_owner_guard() FROM PUBLIC, anon, authenticated;

-- 2c) 금칙어 알림을 본문 수정에도 건다.
--     INSERT 에만 걸려 있어, 평범한 문구로 쓰고 나중에 고치면 편집부 알림이 오지 않았다.
--     함수(notify_editors_flagged_comment)는 그대로 쓰고 UPDATE 트리거만 더한다.
DROP TRIGGER IF EXISTS notify_editors_flagged_comment_update ON public.comments;
CREATE TRIGGER notify_editors_flagged_comment_update
  AFTER UPDATE OF body ON public.comments
  FOR EACH ROW
  WHEN (OLD.body IS DISTINCT FROM NEW.body)
  EXECUTE FUNCTION public.notify_editors_flagged_comment();

-- ════════════════════════════════════════════════════════════
-- 3) [P2] 장터 연락처 RPC — 판매 끝난 매물 · 갓 만든 계정 차단
--    sold 매물도 연락처를 내주고 있었고, 새 계정을 여러 개 만들면 시간당 40건 제한을
--    계정 수만큼 늘릴 수 있었다.
--      · 판매중(available)·예약중(reserved)만 연락처를 준다. 본인 매물은 상태와 무관.
--      · 가입 10분이 안 된 계정은 빈 결과. 가입 시각은 auth.users.created_at 으로 보고,
--        권한 문제로 읽지 못하면 profiles.created_at 으로 대신한다.
--      · 시간당 40건 제한은 유지하되, 실제로 연락처를 돌려준 경우만 센다.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.market_listing_contact(p_listing_id UUID)
RETURNS TABLE (seller_name TEXT, phone TEXT, contact TEXT) AS $$
DECLARE
  uid        UUID := auth.uid();
  recent     INT;
  joined_at  TIMESTAMPTZ;
BEGIN
  IF uid IS NULL THEN RETURN; END IF;

  BEGIN
    SELECT u.created_at INTO joined_at FROM auth.users u WHERE u.id = uid;
  EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
    SELECT p.created_at INTO joined_at FROM public.profiles p WHERE p.user_id = uid;
  END;
  IF joined_at IS NOT NULL AND joined_at > now() - interval '10 minutes' THEN
    RETURN;   -- 가입 10분 미만
  END IF;

  SELECT count(*) INTO recent
    FROM public.market_contact_reveals
   WHERE user_id = uid AND created_at > now() - interval '1 hour';
  IF recent >= 40 THEN RETURN; END IF;   -- 시간당 40건 초과 시 빈 결과

  RETURN QUERY
    SELECT l.seller_name, l.phone, l.contact
      FROM public.market_listings l
     WHERE l.id = p_listing_id
       AND (l.status IN ('available','reserved') OR l.user_id = uid);
  IF FOUND THEN
    INSERT INTO public.market_contact_reveals (user_id, listing_id) VALUES (uid, p_listing_id);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = off SET search_path = public;
REVOKE ALL   ON FUNCTION public.market_listing_contact(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_listing_contact(UUID) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 4) [P2] 스토리지 목록 열거 — article-media · webzine 을 편집부만
--    두 버킷은 public=true 라 /object/public/ 표시 경로는 정책과 무관하게 계속 서빙된다.
--    anon SELECT 정책이 남아 있어 /object/list 로 파일 이름을 훑어 미공개 PDF·초고 이미지를
--    찾을 수 있었다. 목록·인증 다운로드는 편집부만 남긴다(편집부 upsert 도 SELECT 가 필요).
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "article_media_public_read" ON storage.objects;
DROP POLICY IF EXISTS "article_media_editor_select" ON storage.objects;
CREATE POLICY "article_media_editor_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'article-media'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor = TRUE)
  );

DROP POLICY IF EXISTS "webzine public read" ON storage.objects;
DROP POLICY IF EXISTS "webzine editor select" ON storage.objects;
CREATE POLICY "webzine editor select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'webzine'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_editor = TRUE)
  );

-- ════════════════════════════════════════════════════════════
-- 5) [P2] 뉴스레터 — 직접 INSERT 대신 정의자 RPC
--    anon INSERT with check(true) 라 (1) 중복 409 로 "이 주소가 구독 중인지" 알 수 있었고
--    (2) unsubscribe_token 을 클라이언트가 정해 넣을 수 있었다(남의 주소를 넣고 해지 토큰을
--    아는 상태). RPC 는 형식을 검사하고, 토큰은 컬럼 기본값(gen_random_uuid)으로만 만들며,
--    새 주소든 이미 있는 주소든 똑같이 아무것도 돌려주지 않는다.
--    해지 경로(newsletter_unsubscribe RPC)는 그대로다.
--    ※ js/db-client.js newsletter.subscribe 가 이 RPC 를 부르도록 같은 배포에서 바꿔야 한다.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.newsletter_subscribe(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF char_length(clean) < 3 OR char_length(clean) > 200
     OR clean !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid email' USING errcode = '22023';
  END IF;
  INSERT INTO public.newsletter_subscribers (email, source)
  VALUES (clean, 'home')
  ON CONFLICT (email) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_subscribe(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_subscribe(text) TO anon, authenticated;

DROP POLICY IF EXISTS "newsletter_anyone_subscribe" ON public.newsletter_subscribers;

-- ════════════════════════════════════════════════════════════
-- 6) [P2] profiles_privilege_guard 를 INSERT 에도 + 8) [P3] avatar_url 출처 제한
--    UPDATE 에만 걸려 있어, 프로필 행이 없는 계정은 profiles_insert_own 으로
--    is_editor=true 행을 직접 넣을 수 있었다. INSERT 에서는 편집부가 아니면 is_editor 를
--    true 로 넣을 수 없다.
--    avatar_url 은 아무 외부 주소나 넣을 수 있어, 댓글을 보는 독자의 IP 를 남의 서버로
--    보낼 수 있었다. 로그인 사용자가 값을 바꿀 때는 NULL·빈 값, 본인 폴더의 user-avatars
--    공개 URL, 구글 프로필 사진(lh3.googleusercontent.com)만 받는다.
--    CHECK 제약 대신 트리거로 둔다. 가입·로그인 트리거(handle_new_user)는 auth.uid() 가
--    NULL 인 경로라 건드리지 않고, 기존 행의 옛 값 때문에 로그인이 실패할 일도 없다.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.profiles_privilege_guard()
RETURNS TRIGGER AS $$
DECLARE
  is_editor_now BOOLEAN;
BEGIN
  -- service_role / 관리자(SQL editor) 컨텍스트에서는 auth.uid() 가 NULL 이며
  -- 이 경로로만 is_editor 를 부여한다. 인증된 사용자만 가드 대상.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.avatar_url IS NOT NULL AND NEW.avatar_url <> ''
     AND (TG_OP = 'INSERT' OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url)
     AND NOT (
       NEW.avatar_url LIKE 'https://pucpqsfwqouqohwsvmnd.supabase.co/storage/v1/object/public/user-avatars/' || NEW.user_id::text || '/%'
       OR NEW.avatar_url LIKE 'https://lh3.googleusercontent.com/%'
     ) THEN
    RAISE EXCEPTION 'avatar_url 은 업로드한 사진 주소만 쓸 수 있습니다';
  END IF;

  SELECT COALESCE(is_editor, FALSE) INTO is_editor_now
  FROM public.profiles WHERE user_id = auth.uid();
  IF COALESCE(is_editor_now, FALSE) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.is_editor, FALSE) THEN
      RAISE EXCEPTION 'is_editor 는 본인이 정할 수 없습니다';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.is_editor IS DISTINCT FROM OLD.is_editor THEN
    RAISE EXCEPTION 'is_editor 는 본인이 변경할 수 없습니다';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id 변경 불가';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS profiles_privilege_guard ON public.profiles;
CREATE TRIGGER profiles_privilege_guard
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_privilege_guard();

-- ════════════════════════════════════════════════════════════
-- 7) [P3] market_listings 소유자 가드 — storage_paths 를 본인 폴더로 제한
--    가드 주석은 "storage_paths 는 별도 절차로만" 이라 했지만 실제로는 검사하지 않았다.
--    매물 수정 화면은 사진을 바꿀 때 storage_paths 를 통째로 다시 보내므로 변경 자체를 막을
--    수는 없다. 대신 모든 경로가 "<본인 user_id>/" 로 시작하고 '..' 이 없어야 한다.
--    (업로드 경로: js/market-page.js `${user.id}/${Date.now()}-${uuid()}.jpg`)
--    남의 매물 사진 경로를 끌어와 쓰거나, 삭제할 때 남의 파일 경로를 지우게 만드는 것을 막는다.
--    INSERT 에도 같은 검사를 건다. 편집부는 면제.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.market_listings_owner_guard()
RETURNS TRIGGER AS $$
DECLARE
  is_editor_now BOOLEAN;
  sp            TEXT;
BEGIN
  SELECT COALESCE(is_editor, FALSE) INTO is_editor_now
  FROM public.profiles WHERE user_id = auth.uid();
  IF NOT COALESCE(is_editor_now, FALSE) THEN
    IF TG_OP = 'UPDATE' THEN
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
    IF TG_OP = 'INSERT' OR NEW.storage_paths IS DISTINCT FROM OLD.storage_paths THEN
      FOREACH sp IN ARRAY COALESCE(NEW.storage_paths, ARRAY[]::TEXT[]) LOOP
        IF sp IS NULL
           OR NOT starts_with(sp, NEW.user_id::text || '/')
           OR position('..' in sp) > 0 THEN
          RAISE EXCEPTION '사진 경로는 본인 폴더만 쓸 수 있습니다';
        END IF;
      END LOOP;
    END IF;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS market_listings_owner_guard ON public.market_listings;
CREATE TRIGGER market_listings_owner_guard
  BEFORE INSERT OR UPDATE ON public.market_listings
  FOR EACH ROW EXECUTE FUNCTION public.market_listings_owner_guard();

-- ════════════════════════════════════════════════════════════
-- 9) [P3] 텔레메트리 INSERT 속도 제한
--    page_views · page_dwells · app_events 는 anon INSERT 가 무제한이라 스크립트 하나로
--    통계를 오염시키고 테이블을 키울 수 있었다. 같은 session_id 로 최근 1분에
--    page_views·page_dwells 120건, app_events 60건을 넘기면 그 행은 조용히 버린다
--    (20260519000003 client_error_logs 가드와 같은 방식, 클라이언트엔 오류가 가지 않는다).
--    anon 은 이 테이블을 읽을 수 없으므로 세는 함수는 정의자 권한이어야 한다.
--    (session_id, ts) 인덱스로 세고, 상한+1 건까지만 훑는다. session_id 가 없는 행은
--    키가 없어 세지 않는다(정상 클라이언트는 늘 보낸다).
--    page_dwells 에는 (session_id) 인덱스뿐이라 (session_id, ts) 를 더한다.
-- ════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS page_dwells_session_ts_idx ON public.page_dwells (session_id, ts);

CREATE OR REPLACE FUNCTION public.telemetry_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
  cap    INT := TG_ARGV[0]::INT;
  recent INT;
BEGIN
  IF NEW.session_id IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format(
    'SELECT count(*) FROM (SELECT 1 FROM public.%I WHERE session_id = $1 AND ts > now() - interval ''1 minute'' LIMIT %s) s',
    TG_TABLE_NAME, cap + 1)
  INTO recent USING NEW.session_id;
  IF recent >= cap THEN
    RETURN NULL;   -- 조용히 버린다(client_error_logs 가드와 같은 방식)
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.telemetry_rate_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS page_views_rate_limit ON public.page_views;
CREATE TRIGGER page_views_rate_limit
  BEFORE INSERT ON public.page_views
  FOR EACH ROW EXECUTE FUNCTION public.telemetry_rate_limit('120');

DROP TRIGGER IF EXISTS page_dwells_rate_limit ON public.page_dwells;
CREATE TRIGGER page_dwells_rate_limit
  BEFORE INSERT ON public.page_dwells
  FOR EACH ROW EXECUTE FUNCTION public.telemetry_rate_limit('120');

DROP TRIGGER IF EXISTS app_events_rate_limit ON public.app_events;
CREATE TRIGGER app_events_rate_limit
  BEFORE INSERT ON public.app_events
  FOR EACH ROW EXECUTE FUNCTION public.telemetry_rate_limit('60');

NOTIFY pgrst, 'reload schema';
