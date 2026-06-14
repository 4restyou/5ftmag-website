// 5ft.mag — Web Push 발송 edge function.
// user_notifications INSERT 트리거에서 pg_net.http_post 로 호출.
// payload: { user_id: uuid, title, body, link }
// VAPID 비밀키는 함수 시크릿(VAPID_PRIVATE_KEY) 으로 주입.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'https://esm.sh/web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:4rest_design@naver.com';
// 트리거가 함수를 호출할 때 함께 보내는 공유 시크릿. 외부 노출을 막는 가벼운 게이트.
const DISPATCH_SECRET = Deno.env.get('PUSH_DISPATCH_SECRET') || '';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResp({ error: 'method' }, 405);

  // 공유 시크릿 체크 — 함수 URL 이 노출돼도 임의 호출 차단
  if (DISPATCH_SECRET) {
    const got = req.headers.get('x-dispatch-secret') || '';
    if (got !== DISPATCH_SECRET) return jsonResp({ error: 'forbidden' }, 403);
  }

  let payload: any;
  try { payload = await req.json(); }
  catch { return jsonResp({ error: 'bad json' }, 400); }

  const userId = String(payload.user_id || '');
  const title = String(payload.title || '5ft magazine').slice(0, 120);
  const body = String(payload.body || '').slice(0, 500);
  const link = String(payload.link || '/').slice(0, 300);
  if (!userId) return jsonResp({ error: 'user_id required' }, 400);

  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (error) return jsonResp({ error: error.message }, 500);
  if (!subs || subs.length === 0) return jsonResp({ sent: 0, total: 0 });

  const message = JSON.stringify({ title, body, link, tag: link });
  let sent = 0;
  const stale: string[] = [];

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
      }, message);
      sent += 1;
    } catch (e: any) {
      // 404/410 = 구독 만료 → DB 에서 제거
      const status = e?.statusCode || 0;
      if (status === 404 || status === 410) stale.push(s.endpoint);
    }
  }));

  if (stale.length) {
    await admin.from('push_subscriptions').delete().in('endpoint', stale);
  }

  return jsonResp({ sent, total: subs.length, pruned: stale.length });
});
