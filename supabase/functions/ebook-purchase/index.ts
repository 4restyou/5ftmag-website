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
import {
  isActivePortonePayment,
  portonePaymentSlug,
  portonePaymentStatus,
} from '../_shared/entitlement.ts';
import {
  lookupPayment,
  portoneConfigured,
  PORTONE_STORE_ID,
} from '../_shared/portone.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
  if (!portoneConfigured()) return json({ error: 'payment not configured' }, 500, origin);

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
  const lookup = await lookupPayment(paymentId);
  const payment: any = lookup.payment;
  if (lookup.status === 404) return json({ error: 'payment not found' }, 404, origin);
  if (lookup.status !== 200) return json({ error: 'payment lookup failed' }, 502, origin);

  // 검증 — 상태 / 금액 / 통화 / slug
  if (portonePaymentStatus(payment) !== 'PAID') {
    return json({ error: 'not paid', status: portonePaymentStatus(payment) }, 402, origin);
  }
  if (!Number.isFinite(Number(payment?.amount?.total)) || Number(payment.amount.total) !== Number(product.price)) {
    return json({ error: 'amount mismatch' }, 402, origin);
  }
  if (payment?.currency && payment.currency !== 'KRW') return json({ error: 'currency mismatch' }, 402, origin);
  if (String(payment?.storeId || '') !== PORTONE_STORE_ID) return json({ error: 'store mismatch' }, 402, origin);
  // customData.slug 는 필수 — 없으면 우리 체크아웃이 만든 결제가 아니다.
  // (A 상품 결제로 같은 가격의 B 상품 열람권을 얻는 우회 차단)
  const cdSlug = portonePaymentSlug(payment);
  if (cdSlug !== slug) return json({ error: 'product mismatch' }, 402, origin);
  if (!isActivePortonePayment(payment, { slug, price: Number(product.price), storeId: PORTONE_STORE_ID })) {
    return json({ error: 'payment mismatch' }, 402, origin);
  }

  // 이미 열람권 보유 → 그대로 성공 (재호출 안전)
  const { data: existing } = await admin
    .from('ebook_entitlements')
    .select('id, status').eq('user_id', user.id).eq('product_id', product.id).maybeSingle();
  if (existing?.status === 'active') return json({ ok: true, already: true }, 200, origin);

  // 부여 — order_ref 부분 유니크 인덱스가 같은 paymentId 재사용을 차단
  const grant = {
    user_id: user.id,
    product_id: product.id,
    source: 'portone',
    order_ref: paymentId,
    status: 'active',
    last_verified_at: new Date().toISOString(),
    external_status: portonePaymentStatus(payment),
    revoked_at: null,
    revoke_reason: '',
  };
  const grantResult = existing?.id
    ? await admin.from('ebook_entitlements').update(grant).eq('id', existing.id)
    : await admin.from('ebook_entitlements').insert(grant);
  const grantErr = grantResult.error;
  if (grantErr) {
    if (grantErr.code === '23505') {
      const { data: owner } = await admin.from('ebook_entitlements')
        .select('user_id, product_id, status').eq('order_ref', paymentId).maybeSingle();
      if (owner?.user_id === user.id && owner?.product_id === product.id && owner?.status === 'active') {
        return json({ ok: true, already: true }, 200, origin);
      }
      return json({ error: 'payment already used' }, 409, origin);
    }
    console.error('[ebook-purchase] grant failed', grantErr.code || 'unknown');
    return json({ error: 'grant failed' }, 500, origin);
  }

  return json({ ok: true }, 200, origin);
});
