-- user_notifications INSERT 정책 강화 — 디버그용 open insert 되돌리기.
--
-- 20260516000010_notify_debug_v2 가 원인 진단을 위해 INSERT 정책을
-- WITH CHECK (true) 로 열어뒀고, 이후 되돌려지지 않았다. 그 결과 로그인한
-- 아무 사용자나 임의의 user_id 로 알림을 넣을 수 있었고, dispatch 트리거가
-- 실제 웹푸시까지 발송해 피싱·스팸 프리미티브가 됐다.
--
-- 올바른 정책 = "본인 OR 편집자" (마이그레이션 원 주석의 의도와 동일):
--   • 편집자 직접 INSERT — 필름 신청 승인/반려 알림(js/db-client.js notifyDecision)
--     은 편집자가 신청자(타 user_id)에게 넣으므로 편집자 조건이 필요.
--   • SECURITY DEFINER 트리거 — RLS 를 우회하므로 이 정책과 무관하게 계속 동작.
--   • 일반 사용자 — 본인 대상만 허용(무해). 타인 대상 주입은 차단(취약점 제거).

DROP POLICY IF EXISTS "notifications open insert"   ON public.user_notifications;
DROP POLICY IF EXISTS "notifications system insert"  ON public.user_notifications;
DROP POLICY IF EXISTS "notifications editor insert"  ON public.user_notifications;

CREATE POLICY "notifications self or editor insert" ON public.user_notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_editor = true
    )
  );

NOTIFY pgrst, 'reload schema';
