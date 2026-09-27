import { parseProductOrderIds } from './entitlement.ts';

// bcryptjs 는 네이버 커머스 토큰 서명에만 쓴다. 최상위에서 import 하면
// 이 모듈을 부르는 모든 함수가 시작할 때 외부 CDN 을 먼저 받아야 하고,
// 그 한 번이 실패하면 함수가 뜨지도 못한 채 500 을 낸다. 그때는 CORS
// 헤더조차 붙지 않아 브라우저에는 원인이 안 보인다. 실제로 이북 뷰어가
// 그렇게 막혔다. 서명이 필요한 순간에만 받는다.
type BcryptModule = { hashSync(data: string, salt: string): string };
let bcryptMod: BcryptModule | null = null;
async function bcryptHash(data: string, salt: string): Promise<string | null> {
  try {
    const mod = bcryptMod ?? (await import('https://esm.sh/bcryptjs@2.4.3')) as BcryptModule;
    bcryptMod = mod;
    return mod.hashSync(data, salt);
  } catch (e) {
    console.error('[naver-commerce] bcryptjs 로드 실패', (e as Error)?.message || e);
    return null;
  }
}

const CLIENT_ID = Deno.env.get('NAVER_COMMERCE_CLIENT_ID') || '';
const CLIENT_SECRET = Deno.env.get('NAVER_COMMERCE_CLIENT_SECRET') || '';
const RELAY_URL = (Deno.env.get('NAVER_RELAY_URL') || '').replace(/\/$/, '');
const RELAY_KEY = Deno.env.get('NAVER_RELAY_KEY') || '';
const API = 'https://api.commerce.naver.com/external';
const TIMEOUT_MS = 12_000;

export type NaverResponse = { status: number; text: string };
export type ProductOrdersResponse = { status: number; orders: any[] };

export function naverCommerceConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

function parseJson(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

async function naverFetch(
  path: string,
  opts: { method?: string; contentType?: string; authorization?: string; body?: string } = {},
): Promise<NaverResponse> {
  const method = opts.method || 'GET';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if (RELAY_URL && RELAY_KEY) {
      const res = await fetch(`${RELAY_URL}/forward`, {
        method: 'POST',
        signal: controller.signal,
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
      if (!res.ok || typeof data?.status !== 'number') return { status: 0, text: '' };
      return { status: data.status, text: String(data.body ?? '') };
    }
    const headers: Record<string, string> = {};
    if (opts.contentType) headers['content-type'] = opts.contentType;
    if (opts.authorization) headers.authorization = opts.authorization;
    const res = await fetch(API + path, {
      method,
      headers,
      signal: controller.signal,
      body: method === 'POST' ? opts.body || undefined : undefined,
    });
    return { status: res.status, text: await res.text() };
  } catch {
    return { status: 0, text: '' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function commerceToken(): Promise<string | null> {
  if (!naverCommerceConfigured()) return null;
  const timestamp = Date.now();
  const hashed = await bcryptHash(`${CLIENT_ID}_${timestamp}`, CLIENT_SECRET);
  if (!hashed) return null;
  const sign = btoa(hashed);
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
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
  return res.status === 200 && data?.access_token ? String(data.access_token) : null;
}

export async function queryProductOrders(token: string, ids: string[]): Promise<ProductOrdersResponse> {
  if (!ids.length) return { status: 404, orders: [] };
  const res = await naverFetch('/v1/pay-order/seller/product-orders/query', {
    method: 'POST',
    contentType: 'application/json',
    authorization: `Bearer ${token}`,
    body: JSON.stringify({ productOrderIds: ids.slice(0, 300) }),
  });
  const data = parseJson(res.text);
  return {
    status: res.status,
    orders: res.status === 200 && Array.isArray(data?.data) ? data.data : [],
  };
}

export async function productOrderIdsForOrder(token: string, orderId: string): Promise<{ status: number; ids: string[] }> {
  const res = await naverFetch(
    `/v1/pay-order/seller/orders/${encodeURIComponent(orderId)}/product-order-ids`,
    { authorization: `Bearer ${token}` },
  );
  return { status: res.status, ids: parseProductOrderIds(parseJson(res.text)) };
}

// Accept either a product-order id or a parent order id. Unlike the old
// changed-order scan, this works for orders of any age and only reads one order.
export async function resolveProductOrders(token: string, orderNo: string): Promise<ProductOrdersResponse> {
  const direct = await queryProductOrders(token, [orderNo]);
  if (direct.orders.length) return direct;

  const parent = await productOrderIdsForOrder(token, orderNo);
  if (parent.status !== 200) {
    const unavailable = direct.status === 0 || direct.status >= 500 || parent.status === 0 || parent.status >= 500;
    return { status: unavailable ? 0 : 404, orders: [] };
  }
  return queryProductOrders(token, parent.ids);
}
