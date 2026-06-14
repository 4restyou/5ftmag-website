-- Web Push 구독 저장소
-- ════════════════════════════════════════════════════════════
-- 사용자가 브라우저에서 푸시 알림 권한을 허용하고 PushManager.subscribe()
-- 한 결과(endpoint + p256dh + auth)를 보관. user_notifications INSERT 시
-- send-push edge function 이 이 테이블을 lookup 해서 Web Push 전송.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  ua          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions(user_id);

-- ════════════════════════════════════════════════════════════
-- RLS — 본인 구독만 SELECT / INSERT / UPDATE / DELETE
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own subscriptions readable" ON public.push_subscriptions;
CREATE POLICY "own subscriptions readable" ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own subscriptions insertable" ON public.push_subscriptions;
CREATE POLICY "own subscriptions insertable" ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own subscriptions updatable" ON public.push_subscriptions;
CREATE POLICY "own subscriptions updatable" ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own subscriptions deletable" ON public.push_subscriptions;
CREATE POLICY "own subscriptions deletable" ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
