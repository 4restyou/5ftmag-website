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
// 응답: { ok: true } 또는 { error, detail? }
//   주문 확인 실패(주문 없음·주문자 불일치·미결제·다른 상품)는 모두 403 { error: 'order not verified' } 하나로 준다.
//
// 필요 시크릿: NAVER_COMMERCE_CLIENT_ID / NAVER_COMMERCE_CLIENT_SECRET
// (커머스API센터 apicenter.commerce.naver.com 에서 발급)
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import {
  commerceToken,
  naverCommerceConfigured,
  resolveProductOrders,
} from '../_shared/naver-commerce.ts';
import {
  isActiveNaverOrder,
  productOrderId,
  productOrderMatches,
} from '../_shared/entitlement.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function allowOrigin(origin: string | null): string {
  const o = origin || '';
  if (o === 'https://www.5ftmag.com' || o === 'https://5ftmag.com') return o;
  // Netlify 는 우리 사이트(5ftmag)의 기본 주소와 미리보기·브랜치 주소(<무엇>--5ftmag.netlify.app)만 연다.
  // 예전처럼 *.netlify.app 전체를 열면 남의 Netlify 사이트도 응답을 읽을 수 있었다.
  // 앞부분에 '--' 가 다시 들어가지 않게 해 'evil--x--5ftmag' 같은 주소를 거른다(Netlify 사이트 이름엔 '--' 를 쓸 수 없다고 본다).
  if (/^https:\/\/([a-z0-9]+(-[a-z0-9]+)*--)?5ftmag\.netlify\.app$/.test(o)) return o;
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

// 구매자 본인 확인용 정규화 — 이름은 공백 제거·소문자화, 전화는 숫자만 남겨 끝 4자리.
function normName(s: unknown): string {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}
function phoneTail(s: unknown): string {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : '';
}

async function hashIp(ip: string): Promise<string> {
  if (!ip) return '';
  const bytes = new TextEncoder().encode(`${ip}|${SERVICE_ROLE_KEY.slice(-24)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'method' }, 405, origin);
  if (!naverCommerceConfigured()) return json({ error: 'redeem not configured' }, 500, origin);

  // 로그인 확인
  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return json({ error: 'login required' }, 401, origin);
  const { data: userData } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (!user) return json({ error: 'login required' }, 401, origin);

  // 레이트리밋 — 주문번호 무차별 대입 완화. 원본 IP 대신 keyed hash 만 저장한다.
  // 제한 저장소가 고장 난 경우에는 우회를 허용하지 않고 잠시 후 재시도시킨다.
  // 클라이언트 IP. x-forwarded-for 의 첫 값은 요청자가 직접 써 넣을 수 있어 IP 제한을 우회하는 데
  // 쓰인다. 프록시는 받은 헤더 뒤에 자기가 본 주소를 덧붙이므로 마지막 값을 쓴다.
  // 가정: Supabase 엣지 게이트웨이가 x-forwarded-for 끝에 실제 접속 IP 를 붙인다(실제 헤더는 확인하지 못했다).
  // x-real-ip 는 게이트웨이가 덮어쓰는지 알 수 없어 x-forwarded-for 가 비었을 때만 쓴다.
  // 둘 다 없으면 IP 제한은 건너뛰고 계정당 제한만 걸린다.
  const xff = (req.headers.get('x-forwarded-for') || '').split(',').map(v => v.trim()).filter(Boolean);
  const clientIp = xff[xff.length - 1] || (req.headers.get('x-real-ip') || '').trim();
  try {
    const sinceIso = new Date(Date.now() - 3600_000).toISOString();
    const ipHash = await hashIp(clientIp);
    const userQ = admin.from('ebook_redeem_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', sinceIso);
    const ipQ = ipHash
      ? admin.from('ebook_redeem_attempts')
          .select('id', { count: 'exact', head: true })
          .eq('ip_hash', ipHash).gte('created_at', sinceIso)
      : Promise.resolve({ count: 0 });
    const [uRes, ipRes]: any = await Promise.all([userQ, ipQ]);
    if (uRes?.error || ipRes?.error) throw new Error('rate limit lookup failed');
    if ((uRes?.count || 0) >= 15 || (ipRes?.count || 0) >= 40) {
      return json({ error: 'too many attempts', detail: '시도가 너무 많아요. 잠시 후 다시 시도해 주세요.' }, 429, origin);
    }
    const { error: attemptError } = await admin.from('ebook_redeem_attempts')
      .insert({ user_id: user.id, ip: null, ip_hash: ipHash || null });
    if (attemptError) throw attemptError;
    await admin.from('ebook_redeem_attempts')
      .delete().lt('created_at', new Date(Date.now() - 48 * 3600_000).toISOString());
  } catch (_) {
    return json({ error: 'rate limit unavailable', detail: '주문 확인을 잠시 사용할 수 없어요. 잠시 후 다시 시도해 주세요.' }, 503, origin);
  }

  // 주문 확인 실패는 이유(주문 없음·주문자 불일치·미결제·다른 상품)를 가리지 않고 같은 응답을 준다.
  // 이유를 나눠 돌려주면 남의 주문번호가 실제로 있는지, 주문자 이름이 맞았는지를 하나씩 알아낼 수 있다.
  // 자세한 이유는 함수 로그에만 남긴다(주문번호·이름·연락처는 남기지 않는다).
  const notVerified = (reason: string) => {
    console.warn('[ebook-redeem] not verified', reason);
    return json({
      error: 'order not verified',
      detail: '주문을 확인하지 못했어요. 주문번호와 주문자 이름·연락처 끝 4자리를 스마트스토어 주문 정보와 똑같이 입력했는지 확인해 주세요. 결제 직후라면 잠시 후 다시 시도해 주세요.',
    }, 403, origin);
  };

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
    .select('id, status').eq('user_id', user.id).eq('product_id', product.id).maybeSingle();
  if (existing?.status === 'active') return json({ ok: true, already: true }, 200, origin);

  const ncpToken = await commerceToken();
  if (!ncpToken) return json({ error: 'store verify unavailable' }, 502, origin);

  // 상품주문번호면 바로 상세 조회, 일반 주문번호면 네이버의 공식 변환 API 사용.
  // 주문 시점과 무관하므로 오래된 구매도 인증할 수 있다.
  const resolved = await resolveProductOrders(ncpToken, orderNo);
  const orders = resolved.orders;
  if (!orders.length) {
    if (resolved.status === 0) {
      return json({ error: 'store verify unavailable', detail: '스마트스토어 주문 확인이 지연되고 있어요. 잠시 후 다시 시도해 주세요.' }, 502, origin);
    }
    return notVerified('order not found');
  }

  // 이 이북 상품에 해당하고 결제가 유지 중인 상품주문 찾기.
  let matched: any = null;
  let sawProduct = false;    // 이 이북 상품이 포함된 주문을 봤는지
  let buyerMismatch = false; // 결제 완료인데 주문자 정보가 안 맞았는지
  for (const row of orders) {
    const ord = row?.order || {};
    if (!productOrderMatches(row, expectedProductNo)) continue;
    sawProduct = true;
    if (!isActiveNaverOrder(row)) continue;
    // 구매자 본인 확인 — 주문자 이름 + 연락처 끝 4자리 모두 일치해야 부여.
    if (normName(ord?.ordererName) !== buyerName || phoneTail(ord?.ordererTel) !== buyerPhone4) {
      buyerMismatch = true;
      continue;
    }
    matched = row;
    break;
  }
  if (!matched) {
    // 우선순위: 주문자 불일치 > (상품은 있으나 미결제/기타) > 상품 없음
    return notVerified(buyerMismatch ? 'buyer mismatch' : sawProduct ? 'order not payable' : 'product mismatch');
  }

  // 부여 — order_ref 유니크 인덱스가 같은 주문 재사용을 차단
  const externalStatus = String((matched?.productOrder || matched)?.productOrderStatus || 'PAYED');
  const orderRef = `ss_${productOrderId(matched) || orderNo}`;
  const grant = {
    user_id: user.id,
    product_id: product.id,
    source: 'smartstore',
    order_ref: orderRef,
    status: 'active',
    last_verified_at: new Date().toISOString(),
    external_status: externalStatus,
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
        .select('user_id, product_id, status').eq('order_ref', orderRef).maybeSingle();
      if (owner?.user_id === user.id && owner?.product_id === product.id && owner?.status === 'active') {
        return json({ ok: true, already: true }, 200, origin);
      }
      return json({ error: 'order already used', detail: '이미 사용된 주문번호예요. 본인 주문인데 문제가 있다면 문의해 주세요.' }, 409, origin);
    }
    console.error('[ebook-redeem] grant failed', grantErr.code || 'unknown');
    return json({ error: 'grant failed' }, 500, origin);
  }

  return json({ ok: true }, 200, origin);
});
