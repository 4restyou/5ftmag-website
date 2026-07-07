-- ebook-redeem 무차별 대입 완화 — 상환 시도 로그(레이트리밋용).
--
-- ebook-redeem 은 주문번호만 맞으면 열람권을 부여하는데, 함수가
-- --no-verify-jwt 로 공개 노출되고 레이트리밋이 없어 주문번호 대입이 가능했다.
-- 이 테이블에 시도를 기록하고 엣지함수가 최근 1시간 시도 수를 세어 제한한다.
--
-- 엣지함수(service_role)만 기록/조회한다. 정책을 두지 않으므로 authenticated·anon
-- 은 접근할 수 없고, service_role 은 RLS 를 우회한다.

CREATE TABLE IF NOT EXISTS public.ebook_redeem_attempts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ebook_redeem_attempts_user_idx
  ON public.ebook_redeem_attempts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ebook_redeem_attempts_ip_idx
  ON public.ebook_redeem_attempts (ip, created_at DESC);

ALTER TABLE public.ebook_redeem_attempts ENABLE ROW LEVEL SECURITY;
-- 정책 없음 → 클라이언트 접근 불가. service_role(엣지함수)만 접근.

NOTIFY pgrst, 'reload schema';
