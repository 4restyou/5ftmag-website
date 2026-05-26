-- profiles 권한 상승(privilege escalation) 차단
--
-- 기존 정책 "profiles_update_own" 은 USING (auth.uid() = user_id) 만 있고
-- WITH CHECK / 컬럼 보호가 없어, 로그인한 누구나 본인 row 의 is_editor 를
-- true 로 바꿔 편집부 권한을 자가 획득할 수 있었다. is_editor 는 labs /
-- reader_submissions 승인 / market / films / 댓글 모더레이션 / admin RPC 등
-- 모든 인가의 기준이므로 인증 모델 전체가 무력화되는 결함이었다.
--
-- 수정:
--  1) UPDATE 정책에 WITH CHECK 추가 → user_id 를 본인 외 값으로 바꾸지 못하게
--  2) BEFORE UPDATE 트리거 → 편집부가 아닌 "인증된 사용자" 가 is_editor /
--     user_id 를 바꾸면 차단. service_role(대시보드, auth.uid() NULL)로 부여하는
--     정상 경로는 막지 않는다. (reader_submissions_owner_guard 패턴과 동일)

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.profiles_privilege_guard()
RETURNS TRIGGER AS $$
DECLARE
  is_editor_now BOOLEAN;
BEGIN
  -- service_role / 관리자(SQL editor) 컨텍스트에서는 auth.uid() 가 NULL 이며
  -- 이 경로로만 is_editor 를 부여한다. 인증된 일반 사용자만 가드 대상.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(is_editor, FALSE) INTO is_editor_now
  FROM public.profiles WHERE user_id = auth.uid();

  IF NOT COALESCE(is_editor_now, FALSE) THEN
    IF NEW.is_editor IS DISTINCT FROM OLD.is_editor THEN
      RAISE EXCEPTION 'is_editor 는 본인이 변경할 수 없습니다';
    END IF;
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'user_id 변경 불가';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS profiles_privilege_guard ON public.profiles;
CREATE TRIGGER profiles_privilege_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_privilege_guard();
