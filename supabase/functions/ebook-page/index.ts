// 5ft.mag — 이북 접근 (PDF 서명 URL 발급, 프리미엄 게이트).
//
// 페이지를 한 장씩 주던 방식 대신, PDF 한 개를 비공개 버킷에 두고
// 호출 1회로 짧은 TTL 서명 URL 을 발급한다. pdf.js(WebzineReader)가 그걸 렌더.
//   - 열람권 보유: full.pdf
//   - 비보유/비로그인: preview.pdf (앞 1/3, admin 업로드 시 자동 생성)
//
// 호출(브라우저 fetch):
//   GET /functions/v1/ebook-page?slug=<slug>
//   유료(full)면 Authorization: Bearer <user access_token> 로 열람권 확인.
// 응답: { url, entitled, page_count, free_pages }
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import {
  isActiveNaverOrder,
  naverOrderStatus,
  portonePaymentSlug,
  portonePaymentStatus,
  shouldRevalidate,
  smartstoreProductOrderId,
} from '../_shared/entitlement.ts';
import {
  commerceToken,
  naverCommerceConfigured,
  queryProductOrders,
} from '../_shared/naver-commerce.ts';
import {
  lookupPayment,
  portoneConfigured,
  PORTONE_STORE_ID,
} from '../_shared/portone.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'ebook-pages';
const TTL = 600; // 서명 URL 유효 10분

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(origin) },
  });
}

type Entitlement = {
  id: string;
  source: string;
  order_ref: string;
  status: string;
  last_verified_at: string | null;
};

async function markVerified(entitlement: Entitlement, externalStatus: string): Promise<void> {
  const { error } = await admin.from('ebook_entitlements').update({
    last_verified_at: new Date().toISOString(),
    external_status: externalStatus,
  }).eq('id', entitlement.id).eq('status', 'active');
  if (error) console.error('[ebook-page] verification update failed', error.code || 'unknown');
}

async function revoke(entitlement: Entitlement, externalStatus: string): Promise<void> {
  const { error } = await admin.from('ebook_entitlements').update({
    status: 'revoked',
    last_verified_at: new Date().toISOString(),
    external_status: externalStatus,
    revoked_at: new Date().toISOString(),
    revoke_reason: `external:${externalStatus}`,
  }).eq('id', entitlement.id).eq('status', 'active');
  if (error) console.error('[ebook-page] entitlement revoke failed', error.code || 'unknown');
}

// Returns true only for a definitive active state. null means the provider was
// unavailable, in which case an existing customer keeps access and we retry later.
async function verifyAutomaticEntitlement(
  entitlement: Entitlement,
  slug: string,
): Promise<boolean | null> {
  if (entitlement.source === 'portone') {
    if (!portoneConfigured() || !entitlement.order_ref) return null;
    const result = await lookupPayment(entitlement.order_ref);
    if (result.status !== 200 || !result.payment) return null;
    // Amount/product were verified when this entitlement was granted. Rechecking
    // the current catalog price would revoke legitimate buyers after a price edit.
    const active = portonePaymentStatus(result.payment) === 'PAID'
      && String(result.payment.storeId || '') === PORTONE_STORE_ID
      && portonePaymentSlug(result.payment) === slug;
    const status = portonePaymentStatus(result.payment);
    if (active) await markVerified(entitlement, status);
    else await revoke(entitlement, status);
    return active;
  }

  if (entitlement.source === 'smartstore') {
    const productOrderNo = smartstoreProductOrderId(entitlement.order_ref);
    if (!naverCommerceConfigured() || !productOrderNo) return null;
    const token = await commerceToken();
    if (!token) return null;
    const result = await queryProductOrders(token, [productOrderNo]);
    const row = result.orders[0];
    if (result.status !== 200 || !row) return null;
    // The product relation was verified at grant time; only its payment lifecycle
    // changes here. This also survives a later Smart Store product URL migration.
    const active = isActiveNaverOrder(row);
    const status = naverOrderStatus(row);
    if (active) await markVerified(entitlement, status);
    else await revoke(entitlement, status);
    return active;
  }

  return true;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
  if (req.method !== 'GET') return json({ error: 'method' }, 405, origin);

  const url = new URL(req.url);
  const slug = (url.searchParams.get('slug') || '').trim();
  if (!slug) return json({ error: 'slug required' }, 400, origin);

  const { data: product, error: prodErr } = await admin
    .from('ebook_products')
    .select('id, pages_path, page_count, published')
    .eq('slug', slug)
    .maybeSingle();
  if (prodErr || !product || !product.published) return json({ error: 'not found' }, 404, origin);

  const pagesPath = (product.pages_path || slug).replace(/\/+$/, '');
  const total = product.page_count || 0;
  const freeLimit = Math.max(1, Math.ceil(total / 3));

  // 열람권 확인 (토큰 있으면)
  let entitled = false;
  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (token) {
    const { data: userData } = await admin.auth.getUser(token);
    if (userData?.user) {
      const { data: ent } = await admin
        .from('ebook_entitlements')
        .select('id, source, order_ref, status, last_verified_at')
        .eq('user_id', userData.user.id).eq('product_id', product.id).maybeSingle();
      entitled = ent?.status === 'active';
      if (ent && entitled && ['portone', 'smartstore'].includes(ent.source) && shouldRevalidate(ent.last_verified_at)) {
        const verified = await verifyAutomaticEntitlement(ent as Entitlement, slug);
        if (verified === false) entitled = false;
      }
    }
  }

  const file = entitled ? 'full.pdf' : 'preview.pdf';
  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET).createSignedUrl(`${pagesPath}/${file}`, TTL);
  if (signErr || !signed?.signedUrl) {
    // preview 가 없으면(구버전) full 시도 불가 — 안내
    return json({ error: 'file unavailable', entitled, page_count: total, free_pages: freeLimit }, 404, origin);
  }

  return json({
    url: signed.signedUrl,
    entitled,
    page_count: total,
    free_pages: freeLimit,
  }, 200, origin);
});
