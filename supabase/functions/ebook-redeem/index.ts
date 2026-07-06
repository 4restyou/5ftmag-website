// 5ft.mag — 스마트스토어 주문번호 인증 → 이북 열람권 부여.
//
// 흐름: 구매자가 스마트스토어에서 열람권 상품을 결제 → 사이트 로그인 →
// 주문번호 입력 → 이 함수가 네이버 커머스 API 로 주문을 조회해
//   - 결제 완료 상태인지 (취소/반품 아님)
//   - 주문한 상품이 이 이북의 스마트스토어 상품(store_url 의 /products/{번호})인지
// 확인 후 열람권을 넣는다. order_ref 부분 유니크 인덱스가 같은 주문의
// 재사용을 DB 차원에서 막는다.
//
// 호출(브라우저 fetch):
//   POST /functions/v1/ebook-redeem
//   Authorization: Bearer <user access_token>
//   body: { slug, orderNo }   // orderNo = 주문번호 또는 상품주문번호
// 응답: { ok: true } 또는 { error }
//
// 필요 시크릿: NAVER_COMMERCE_CLIENT_ID / NAVER_COMMERCE_CLIENT_SECRET
// (커머스API센터 apicenter.commerce.naver.com 에서 발급)
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import bcrypt from 'https://esm.sh/bcryptjs@2.4.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NCP_CLIENT_ID = Deno.env.get('NAVER_COMMERCE_CLIENT_ID') || '';
const NCP_CLIENT_SECRET = Deno.env.get('NAVER_COMMERCE_CLIENT_SECRET') || '';
// 고정 IP 중계 (relay/naver-relay.mjs) — 커머스 API 가 등록된 IP 에서만
// 호출을 허용하는데 엣지 함수는 고정 IP 가 없어서, 설정돼 있으면 모든
// 커머스 API 호출을 중계 서버로 보낸다. 비어 있으면 직접 호출(로컬 테스트용).
const RELAY_URL = (Deno.env.get('NAVER_RELAY_URL') || '').replace(/\/$/, '');
const RELAY_KEY = Deno.env.get('NAVER_RELAY_KEY') || '';
const API = 'https://api.commerce.naver.com/external';

// 커머스 API 호출 — 중계 경유/직접 을 한 곳에서. { status, text } 반환.
async function naverFetch(path: string, opts: { method?: string; contentType?: string; authorization?: string; body?: string } = {}): Promise<{ status: number; text: string }> {
  const method = opts.method || 'GET';
  if (RELAY_URL && RELAY_KEY) {
    const res = await fetch(`${RELAY_URL}/forward`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-relay-key': RELAY_KEY },
      body: JSON.stringify({
        path: `/external${path}`,
        method,
        contentType: opts.contentType || '',
        authorization: opts.authorization || '',
        body: opts.body || '',
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || typeof data?.status !== 'number') {
      console.error('[ebook-redeem] relay fail', res.status, data?.error || '');
      return { status: 0, text: '' };
    }
    return { status: data.status, text: String(data.body ?? '') };
  }
  const headers: Record<string, string> = {};
  if (opts.contentType) headers['content-type'] = opts.contentType;
  if (opts.authorization) headers['authorization'] = opts.authorization;
  const res = await fetch(API + path, { method, headers, body: opts.body || undefined });
  return { status: res.status, text: await res.text() };
}

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

function parseJson(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

// 커머스 API 토큰 (client_credentials + bcrypt 서명)
async function commerceToken(): Promise<string | null> {
  const timestamp = Date.now();
  const sign = btoa(bcrypt.hashSync(`${NCP_CLIENT_ID}_${timestamp}`, NCP_CLIENT_SECRET));
  const body = new URLSearchParams({
    client_id: NCP_CLIENT_ID,
    timestamp: String(timestamp),
    grant_type: 'client_credentials',
    client_secret_sign: sign,
    type: 'SELF',
  });
  const res = await naverFetch('/v1/oauth2/token', {
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    body: body.toString(),
  });
  const data = parseJson(res.text);
  if (res.status !== 200 || !data?.access_token) {
    console.error('[ebook-redeem] token fail', res.status, data?.message || '');
    return null;
  }
  return data.access_token as string;
}

// 상품주문 상세 조회 — productOrderIds 배열로 질의
async function queryProductOrders(token: string, ids: string[]): Promise<any[]> {
  const res = await naverFetch('/v1/pay-order/seller/product-orders/query', {
    method: 'POST',
    contentType: 'application/json',
    authorization: `Bearer ${token}`,
    body: JSON.stringify({ productOrderIds: ids }),
  });
  const data = parseJson(res.text);
  if (res.status !== 200) { console.error('[ebook-redeem] query fail', res.status, data?.message || ''); return []; }
  const list = data?.data || [];
  return Array.isArray(list) ? list : [];
}

// 주문번호(orderId) → 상품주문번호 목록
async function productOrderIdsOf(token: string, orderId: string): Promise<string[]> {
  const res = await naverFetch(`/v1/pay-order/seller/orders/${encodeURIComponent(orderId)}/product-order-ids`, {
    authorization: `Bearer ${token}`,
  });
  const data = parseJson(res.text);
  if (res.status !== 200) return [];
  const ids = data?.data?.productOrderIds || data?.productOrderIds || [];
  return Array.isArray(ids) ? ids.map(String) : [];
}

// 결제가 유지되는 상태만 통과 (취소·반품·교환 거절)
const OK_STATUS = new Set(['PAYED', 'DELIVERING', 'DELIVERED', 'PURCHASE_DECIDED', 'DISPATCHED']);

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'method' }, 405, origin);
  if (!NCP_CLIENT_ID || !NCP_CLIENT_SECRET) return json({ error: 'redeem not configured' }, 500, origin);

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
  const orderNo = String(body?.orderNo || '').replace(/[^0-9A-Za-z]/g, '');
  if (!slug || !orderNo || orderNo.length < 8 || orderNo.length > 32) {
    return json({ error: 'invalid order number' }, 400, origin);
  }

  // 상품 + 스마트스토어 상품번호 (store_url 의 /products/{번호})
  const { data: product } = await admin
    .from('ebook_products')
    .select('id, published, store_url')
    .eq('slug', slug)
    .maybeSingle();
  if (!product || !product.published) return json({ error: 'not found' }, 404, origin);
  const m = (product.store_url || '').match(/\/products\/(\d+)/);
  if (!m) return json({ error: 'store not linked' }, 400, origin);
  const expectedProductNo = m[1];

  // 이미 열람권 보유 → 그대로 성공 (재호출 안전)
  const { data: existing } = await admin
    .from('ebook_entitlements')
    .select('id').eq('user_id', user.id).eq('product_id', product.id).maybeSingle();
  if (existing) return json({ ok: true, already: true }, 200, origin);

  const ncpToken = await commerceToken();
  if (!ncpToken) return json({ error: 'store verify unavailable' }, 502, origin);

  // 입력이 상품주문번호일 수도, 주문번호일 수도 있다 — 둘 다 시도
  let orders = await queryProductOrders(ncpToken, [orderNo]);
  if (!orders.length) {
    const ids = await productOrderIdsOf(ncpToken, orderNo);
    if (ids.length) orders = await queryProductOrders(ncpToken, ids);
  }
  if (!orders.length) return json({ error: 'order not found', detail: '주문을 찾을 수 없어요. 번호를 다시 확인해 주세요.' }, 404, origin);

  // 이 이북 상품에 해당하고 결제가 유지 중인 상품주문 찾기
  let matched: any = null;
  let sawProduct = false;
  for (const row of orders) {
    const po = row?.productOrder || row;
    const candidates = [po?.productId, po?.originProductId, po?.channelProductId, po?.merchantChannelProductId]
      .filter(Boolean).map(String);
    if (!candidates.includes(expectedProductNo)) continue;
    sawProduct = true;
    const status = String(po?.productOrderStatus || '');
    if (OK_STATUS.has(status)) { matched = po; break; }
  }
  if (!matched) {
    return json({
      error: sawProduct ? 'order not payable' : 'product mismatch',
      detail: sawProduct
        ? '이 주문은 결제 완료 상태가 아니에요 (취소·반품 포함).'
        : '이 주문에는 해당 이북 상품이 없어요.',
    }, 402, origin);
  }

  // 부여 — order_ref 유니크 인덱스가 같은 주문 재사용을 차단
  const orderRef = `ss_${String(matched.productOrderId || orderNo)}`;
  const { error: grantErr } = await admin
    .from('ebook_entitlements')
    .insert({ user_id: user.id, product_id: product.id, source: 'smartstore', order_ref: orderRef });
  if (grantErr) {
    if (grantErr.code === '23505') {
      return json({ error: 'order already used', detail: '이미 사용된 주문번호예요. 본인 주문인데 문제가 있다면 문의해 주세요.' }, 409, origin);
    }
    return json({ error: 'grant failed', detail: grantErr.message }, 500, origin);
  }

  return json({ ok: true }, 200, origin);
});
