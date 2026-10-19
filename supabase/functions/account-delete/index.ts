// 회원 스스로 탈퇴. --no-verify-jwt 로 배포되므로 handler 가 getUser(token) 으로 본인을 확인한다.
// 지우는 대상·순서는 handler.ts 참고.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { createAccountDeleteHandler } from './handler.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

Deno.serve(createAccountDeleteHandler({ admin }));
