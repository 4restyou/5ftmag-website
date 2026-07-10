// 5ft.mag — 스마트스토어 주문번호 인증 → 이북 열람권 부여.
//
// 흐름: 구매자가 스마트스토어에서 열람권 상품을 결제 → 사이트 로그인 →
// 주문번호 + 주문자 이름/연락처 입력 → 이 함수가 네이버 커머스 API 로 주문을 조회해
//   - 결제 완료 상태인지 (취소/반품 아님)
//   - 주문한 상품이 이 이북의 스마트스토어 상품(store_url 의 /products/{번호})인지
//   - 주문자 이름 + 연락처 끝 4자리가 네이버 주문의 주문자 정보와 일치하는지
// 확인 후 열람권을 넣는다. order_ref 부분 유니크 인덱스가 같은 주문의
// 재사용을 DB 차원에서 막고, 주문자 대조가 주문번호 유출만으로의 가로채기를 막는다.
//
// 호출(브라우저 fetch):
//   POST /functions/v1/ebook-redeem
//   Authorization: Bearer <user access_token>
//   body: { slug, orderNo, buyerName, buyerPhone }
//     orderNo   = 주문번호 또는 상품주문번호
//     buyerName = 스마트스토어 주문자 이름
//     buyerPhone= 주문자 연락처(끝 4자리만 대조)
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

// 구매자 본인 확인용 정규화 — 이름은 공백 제거·소문자화, 전화는 숫자만 남겨 끝 4자리.
function normName(s: unknown): string {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}
function phoneTail(s: unknown): string {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : '';
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

// 상품주문 상세 조회 — '상품주문번호' 배열로 질의. { status, orders } 반환.
// 상품주문번호가 아닌 주문번호를 넣으면 400 "처리 권한이 없는 상품 주문 번호" 가 온다
// (그 경우 호출부에서 recentProductOrderIds 로 역추적한다).
async function queryProductOrders(token: string, ids: string[]): Promise<{ status: number; orders: any[] }> {
  const res = await naverFetch('/v1/pay-order/seller/product-orders/query', {
    method: 'POST',
    contentType: 'application/json',
    authorization: `Bearer ${token}`,
    body: JSON.stringify({ productOrderIds: ids }),
  });
  const data = parseJson(res.text);
  if (res.status !== 200) {
    console.error('[ebook-redeem] query fail', res.status, data?.message || '');
    return { status: res.status, orders: [] };
  }
  const list = data?.data || [];
  return { status: 200, orders: Array.isArray(list) ? list : [] };
}

// 최근 변경(결제 포함) 상품주문번호 목록 — '주문번호' 입력을 상품주문으로 역추적할 때 사용.
// 커머스 API 엔 '주문번호 → 상품주문번호' 직접 변환이 없어서, 최근 상품주문번호를 모은 뒤
// 상세 조회해 order.orderId 로 대조한다. last-changed-statuses 는 1회 최대 24h 범위라
// 최근 며칠을 24h 단위로 스캔. 소규모 스토어 기준(최근 주문 수 적음)으로 상한을 둔다.
async function recentProductOrderIds(token: string, maxIds = 300): Promise<string[]> {
  const ids = new Set<string>();
  const now = Date.now();
  for (let i = 0; i < 4 && ids.size < maxIds; i++) {
    const to = new Date(now - i * 86_400_000).toISOString();
    const from = new Date(now - (i + 1) * 86_400_000).toISOString();
    const params = new URLSearchParams({ lastChangedFrom: from, lastChangedTo: to });
    const res = await naverFetch(`/v1/pay-order/seller/product-orders/last-changed-statuses?${params.toString()}`, {
      authorization: `Bearer ${token}`,
    });
    if (res.status !== 200) { console.error('[ebook-redeem] scan fail', res.status); continue; }
    const data = parseJson(res.text);
    const list = data?.data?.lastChangeStatuses || data?.lastChangeStatuses || [];
    for (const it of (Array.isArray(list) ? list : [])) {
      if (it?.productOrderId) ids.add(String(it.productOrderId));
    }
  }
  return [...ids].slice(0, maxIds);
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

  // 레이트리밋 — 주문번호 무차별 대입 완화. 오류가 나면 통과(fail-open)해서
  // 정상 상환이 절대 막히지 않도록 한다. 로그인 계정·IP 각각 1시간 창 기준.
  const clientIp = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  try {
    const sinceIso = new Date(Date.now() - 3600_000).toISOString();
    const userQ = admin.from('ebook_redeem_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', sinceIso);
    const ipQ = clientIp
      ? admin.from('ebook_redeem_attempts')
          .select('id', { count: 'exact', head: true })
          .eq('ip', clientIp).gte('created_at', sinceIso)
      : Promise.resolve({ count: 0 });
    const [uRes, ipRes]: any = await Promise.all([userQ, ipQ]);
    if ((uRes?.count || 0) >= 15 || (ipRes?.count || 0) >= 40) {
      return json({ error: 'too many attempts', detail: '시도가 너무 많아요. 잠시 후 다시 시도해 주세요.' }, 429, origin);
    }
    await admin.from('ebook_redeem_attempts').insert({ user_id: user.id, ip: clientIp || null });
  } catch (_) { /* fail-open */ }

  let body: any = null;
  try { body = await req.json(); } catch (_) { /* noop */ }
  const slug = (body?.slug || '').trim();
  const orderNo = String(body?.orderNo || '').replace(/[^0-9A-Za-z]/g, '');
  if (!slug || !orderNo || orderNo.length < 8 || orderNo.length > 32) {
    return json({ error: 'invalid order number' }, 400, origin);
  }
  // 구매자 본인 확인 — 주문번호만 유출돼도 타인이 열람권을 가로채지 못하도록,
  // 스마트스토어 주문자 이름 + 연락처 끝 4자리를 네이버 주문의 주문자 정보와 대조한다.
  const buyerName = normName(body?.buyerName);
  const buyerPhone4 = phoneTail(body?.buyerPhone);
  if (!buyerName || !buyerPhone4) {
    return json({ error: 'buyer info required', detail: '주문자 이름과 연락처(끝 4자리)를 입력해 주세요.' }, 400, origin);
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

  // 1) 입력을 '상품주문번호'로 직접 조회 (상품주문번호를 넣은 경우 바로 매칭).
  // 2) 비면(대개 '주문번호'를 넣은 경우) 최근 상품주문을 조회해 order.orderId 로 대조.
  let orders = (await queryProductOrders(ncpToken, [orderNo])).orders;
  let requireOrderId = false;
  if (!orders.length) {
    const recent = await recentProductOrderIds(ncpToken);
    if (recent.length) { orders = (await queryProductOrders(ncpToken, recent)).orders; requireOrderId = true; }
  }
  if (!orders.length) {
    return json({
      error: 'order not found',
      detail: '주문을 찾을 수 없어요. 주문번호를 다시 확인해 주세요. (결제 직후라면 잠시 후 다시 시도해 주세요.)',
    }, 404, origin);
  }

  // 이 이북 상품에 해당하고 결제가 유지 중인 상품주문 찾기.
  // 주문번호 경로(requireOrderId)에선 반드시 입력 주문번호와 order.orderId 가 일치해야 한다
  // (타인 주문에 매칭되는 것을 막는 보안 확인).
  let matched: any = null;
  let sawProduct = false;    // 이 이북 상품이 포함된 주문을 봤는지
  let buyerMismatch = false; // 결제 완료인데 주문자 정보가 안 맞았는지
  for (const row of orders) {
    const po = row?.productOrder || row;
    const ord = row?.order || {};
    if (requireOrderId) {
      const parentOrderId = String(ord?.orderId || po?.orderId || '');
      if (parentOrderId !== orderNo) continue;
    }
    const candidates = [po?.productId, po?.originProductId, po?.channelProductId, po?.merchantChannelProductId]
      .filter(Boolean).map(String);
    if (!candidates.includes(expectedProductNo)) continue;
    sawProduct = true;
    const status = String(po?.productOrderStatus || '');
    if (!OK_STATUS.has(status)) continue;
    // 구매자 본인 확인 — 주문자 이름 + 연락처 끝 4자리 모두 일치해야 부여.
    if (normName(ord?.ordererName) !== buyerName || phoneTail(ord?.ordererTel) !== buyerPhone4) {
      buyerMismatch = true;
      continue;
    }
    matched = po;
    break;
  }
  if (!matched) {
    // 우선순위: 주문자 불일치 > (상품은 있으나 미결제/기타) > 상품 없음
    if (buyerMismatch) {
      return json({
        error: 'buyer mismatch',
        detail: '주문자 이름 또는 연락처가 주문 정보와 달라요. 스마트스토어 주문자 정보와 똑같이 입력해 주세요.',
      }, 403, origin);
    }
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
