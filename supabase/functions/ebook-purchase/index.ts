// 5ft.mag — 이북 결제 검증 + 열람권 부여 (PortOne V2).
//
// 브라우저에서 PortOne.requestPayment() 로 결제한 뒤, 그 paymentId 를 이 함수로 보낸다.
// 함수는 PortOne API 로 결제를 다시 조회해 위변조를 막고, 통과하면 열람권을 넣는다.
//   - 상태 PAID 확인
//   - 결제 금액 == 상품 가격 확인 (클라이언트가 보낸 금액 신뢰 안 함)
//   - 통화 KRW 확인
//   - customData.slug == 요청 slug 확인 (A 결제하고 B 열람권 받는 것 차단)
//
// 호출(브라우저 fetch):
//   POST /functions/v1/ebook-purchase
//   Authorization: Bearer <user access_token>
//   body: { slug, paymentId }
// 응답: { ok: true } 또는 { error }
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PORTONE_API_SECRET = Deno.env.get('PORTONE_API_SECRET') || '';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function allowOrigin(origin: string | null): string {
  const o = origin || '';
  if (o === 'https://www.5ftmag.com' || o === 'https://5ftmag.com') return o;
  if (/^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(o)) return o;
  return 'https://www.5ftmag.com';
}
function cors(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowOrigin(origin),
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(origin) },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'method' }, 405, origin);
  if (!PORTONE_API_SECRET) return json({ error: 'payment not configured' }, 500, origin);

  // 로그인 확인
  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return json({ error: 'login required' }, 401, origin);
  const { data: userData } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (!user) return json({ error: 'login required' }, 401, origin);

  let body: any = null;
  try { body = await req.json(); } catch (_) { /* noop */ }
  const slug = (body?.slug || '').trim();
  const paymentId = (body?.paymentId || '').trim();
  if (!slug || !paymentId) return json({ error: 'slug and paymentId required' }, 400, origin);

  // 상품 조회 (가격은 서버 기준)
  const { data: product, error: prodErr } = await admin
    .from('ebook_products')
    .select('id, price, published')
    .eq('slug', slug)
    .maybeSingle();
  if (prodErr || !product || !product.published) return json({ error: 'not found' }, 404, origin);

  // PortOne 결제 단건 조회
  let payment: any = null;
  try {
    const res = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `PortOne ${PORTONE_API_SECRET}` },
    });
    payment = await res.json().catch(() => null);
    if (!res.ok) return json({ error: 'payment lookup failed', detail: payment?.message || res.status }, 502, origin);
  } catch (_) {
    return json({ error: 'payment lookup failed' }, 502, origin);
  }

  // 검증 — 상태 / 금액 / 통화 / slug
  if (payment?.status !== 'PAID') return json({ error: 'not paid', status: payment?.status || 'UNKNOWN' }, 402, origin);
  const paidAmount = Number(payment?.amount?.total);
  if (!Number.isFinite(paidAmount) || paidAmount !== Number(product.price)) {
    return json({ error: 'amount mismatch' }, 402, origin);
  }
  if (payment?.currency && payment.currency !== 'KRW') return json({ error: 'currency mismatch' }, 402, origin);
  // customData 는 문자열 또는 객체로 올 수 있다 — slug 일치 확인
  let cdSlug = '';
  try {
    const cd = typeof payment?.customData === 'string' ? JSON.parse(payment.customData) : payment?.customData;
    cdSlug = (cd?.slug || '').trim();
  } catch (_) { /* noop */ }
  if (cdSlug && cdSlug !== slug) return json({ error: 'product mismatch' }, 402, origin);

  // 열람권 부여 (중복은 무시 — 재호출 안전)
  const { error: grantErr } = await admin
    .from('ebook_entitlements')
    .upsert(
      { user_id: user.id, product_id: product.id, source: 'portone', order_ref: paymentId },
      { onConflict: 'user_id,product_id', ignoreDuplicates: true }
    );
  if (grantErr) return json({ error: 'grant failed', detail: grantErr.message }, 500, origin);

  return json({ ok: true }, 200, origin);
});
