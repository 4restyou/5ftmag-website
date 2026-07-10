-- 보안 하드닝 — 프론트 노출 정보(공개 anon 키·요청주소·클라이언트 JS)만으로
-- curl 접근 시 타인 PII 를 꺼낼 수 있던 경로 차단. (2026-07 보안 감사 반영)
--
-- 안전 원리: 공개 브라우징은 전부 뷰(security_invoker=false = 정의자 권한)로
-- 동작하므로, 베이스 테이블의 광범위 anon/authenticated 정책을 좁혀도 화면은
-- 그대로 유지된다. 베이스 테이블은 본인/편집부만 원본 행을 읽게 한다.
--   · profiles / reader_submissions 는 본인만 → 편집부는 표시용 뷰로 충분
--   · 다른 테이블 정책의 is_editor 체크는 "호출자 본인" 프로필만 읽으므로 유지됨

-- ════════════════════════════════════════════════════════════
-- 0) 공개 뷰를 정의자 권한으로 고정 (베이스 RLS 우회 유지)
--    market_* 뷰는 이전 마이그레이션에서 이미 false. 나머지 둘도 명시한다.
-- ════════════════════════════════════════════════════════════
ALTER VIEW IF EXISTS public.profiles_public             SET (security_invoker = false);
ALTER VIEW IF EXISTS public.reader_submissions_approved SET (security_invoker = false);

-- ════════════════════════════════════════════════════════════
-- 1) [HIGH] market_listings 판매자 이름/전화 대량 유출 차단
-- ════════════════════════════════════════════════════════════
-- 1a) 로그인 사용자 전체에 열려 있던 광범위 SELECT 제거.
--     본인("market own readable") / 편집부("market editor read") 정책은 유지 →
--     listMine() · 편집부 관리 정상. 공개 목록은 market_listings_public 뷰(연락처 마스킹).
DROP POLICY IF EXISTS "market public visible" ON public.market_listings;

-- 1b) (참고) 연락처 포함 market_listings_authed 뷰는 마이그레이션 007 에서 이미 제거됨
--     (RPC 로 대체). 별도 회수 불필요.

-- 1c) 연락처는 이제 market_listing_contact() RPC 로만 노출. RPC 반복 호출로 전량
--     수집하는 것을 막기 위해 시간당 조회 횟수 제한을 둔다(일반 구매자는 몇 건 수준).
CREATE TABLE IF NOT EXISTS public.market_contact_reveals (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL,
  listing_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_contact_reveals_user
  ON public.market_contact_reveals (user_id, created_at DESC);
ALTER TABLE public.market_contact_reveals ENABLE ROW LEVEL SECURITY;
-- 정책 0개 → anon/authenticated 직접 접근 불가. 정의자 함수만 기록/집계.
REVOKE ALL ON public.market_contact_reveals FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.market_listing_contact(p_listing_id UUID)
RETURNS TABLE (seller_name TEXT, phone TEXT, contact TEXT) AS $$
DECLARE
  uid    UUID := auth.uid();
  recent INT;
BEGIN
  IF uid IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO recent
    FROM public.market_contact_reveals
   WHERE user_id = uid AND created_at > now() - interval '1 hour';
  IF recent >= 40 THEN RETURN; END IF;   -- 시간당 40건 초과 시 빈 결과
  INSERT INTO public.market_contact_reveals (user_id, listing_id) VALUES (uid, p_listing_id);
  RETURN QUERY
    SELECT l.seller_name, l.phone, l.contact
      FROM public.market_listings l
     WHERE l.id = p_listing_id
       AND l.status IN ('available','reserved','sold');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET row_security = off;
REVOKE ALL   ON FUNCTION public.market_listing_contact(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_listing_contact(UUID) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 2) [MEDIUM] profiles 베이스 전체 로스터 노출 차단
--    USING(true) → 본인만. 공개 표시는 profiles_public 뷰(정의자)로 유지.
--    다른 테이블의 is_editor 체크는 "본인 프로필"만 읽으므로 영향 없음.
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════
-- 3) [LOW] reader_submissions 베이스 anon 노출(내부 컬럼) 차단
--    승인 사진 공개 표시는 reader_submissions_approved 뷰(정의자)로 유지.
--    베이스는 본인("own submissions readable")/편집부("editors read all")만.
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "public reads approved" ON public.reader_submissions;

-- ════════════════════════════════════════════════════════════
-- 4) [MEDIUM] 스토리지 열거 차단 — 미승인/반려 사진, 숨김 매물 이미지
--    public=true 버킷의 /object/public/ 표시 경로는 정책과 무관하게 유지된다.
--    광범위 anon SELECT(목록 열거/인증 다운로드)를 소유자 한정으로 축소.
--    (표시는 /i/reader/*, /i/market/* → object/public/ 로 서빙되므로 영향 없음)
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "public read submissions" ON storage.objects;
CREATE POLICY "reader own list" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'reader-submissions'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "market public read obj" ON storage.objects;
CREATE POLICY "market own list" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'market-listings'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

NOTIFY pgrst, 'reload schema';
