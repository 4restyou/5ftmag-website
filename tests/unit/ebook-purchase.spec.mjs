import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createPaymentHandler } from '../../supabase/functions/ebook-purchase/handler.ts';

const slug = 'issue-03';
const product = { id: 'product-03', slug, title: 'Issue 03', price: 7000, published: true };
const storeId = 'our-store';

// Stateful Supabase adapter: exercises real request/auth/ownership/provider
// branches. RPC models its atomic contract; it is not a PostgreSQL execution.
function setup() {
  const tables = { ebook_products: [{ ...product }], ebook_checkout_orders: [], ebook_entitlements: [] };
  const payments = new Map();
  let serial = 0;
  const from = vi.fn((table) => {
    const filters = [];
    const query = {
      select: () => query,
      eq: (key, value) => { filters.push([key, value]); return query; },
      maybeSingle: async () => ({
        data: tables[table].find(row => filters.every(([key, value]) => row[key] === value)) || null,
        error: null,
      }),
      insert: async (row) => { tables[table].push({ ...row }); return { error: null }; },
    };
    return query;
  });
  const rpc = vi.fn(async (name, args) => {
    expect(name).toBe('grant_ebook_checkout_order');
    const order = tables.ebook_checkout_orders.find(row => row.payment_id === args.p_payment_id);
    if (!order || order.buyer_id !== args.p_buyer_id) return { error: { code: '42501' } };
    const existing = tables.ebook_entitlements.find(row => row.user_id === order.buyer_id && row.product_id === order.product_id);
    if (existing?.status === 'active') return { data: { ok: true, already: true }, error: null };
    const grant = {
      user_id: order.buyer_id, product_id: order.product_id, order_ref: order.payment_id,
      source: 'portone', status: 'active', external_status: 'PAID', revoked_at: null, revoke_reason: '',
    };
    if (existing) Object.assign(existing, grant);
    else tables.ebook_entitlements.push(grant);
    return { data: { ok: true, already: false }, error: null };
  });
  const getUser = vi.fn(async token => ({
    data: { user: ['buyer-A', 'buyer-B'].includes(token) ? { id: token } : null }, error: null,
  }));
  const lookupPayment = vi.fn(async id => payments.has(id)
    ? { status: 200, payment: payments.get(id) } : { status: 404, payment: null });
  const configured = vi.fn(() => true);
  const handler = createPaymentHandler({
    admin: { from, rpc, auth: { getUser } }, configured, lookupPayment, storeId,
    randomUUID: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`,
  });
  async function request(body, buyer = 'buyer-A', options = {}) {
    const response = await handler(new Request('https://example.test/ebook-purchase', {
      method: 'POST', headers: { authorization: `Bearer ${buyer}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), ...options,
    }));
    return { status: response.status, body: await response.json(), response };
  }
  async function create(buyer = 'buyer-A', extra = {}) {
    const result = await request({ slug, ...extra }, buyer);
    expect(result.status).toBe(200);
    const order = result.body.order;
    payments.set(order.paymentId, {
      id: order.paymentId, status: 'PAID', amount: { total: order.price },
      currency: 'KRW', storeId, customData: JSON.stringify({ slug }),
    });
    return order;
  }
  return { tables, payments, from, rpc, getUser, lookupPayment, configured, handler, request, create };
}

describe('server-created ebook orders', () => {
  it('binds authenticated A and server product/price/ID despite forged client fields', async () => {
    const s = setup();
    const order = await s.create('buyer-A', { buyer_id: 'buyer-B', userId: 'buyer-B', price: 1, product_id: 'other' });
    expect(s.tables.ebook_checkout_orders).toEqual([expect.objectContaining({
      buyer_id: 'buyer-A', product_id: product.id, price: 7000, slug, payment_id: order.paymentId,
    })]);
    expect(order).not.toHaveProperty('buyer_id');
    expect(s.getUser).toHaveBeenCalledWith('buyer-A');
    expect(s.rpc).not.toHaveBeenCalled();
    expect(s.lookupPayment).not.toHaveBeenCalled();
  });

  it('issues independent orders and never accepts caller-selected payment IDs for creation', async () => {
    const s = setup();
    const a = await s.create();
    const b = await s.create('buyer-B');
    expect(a.paymentId).not.toBe(b.paymentId);
    const result = await s.request({ slug, paymentId: 'attacker-selected' });
    expect(result.status).toBe(409);
    expect(s.tables.ebook_checkout_orders).toHaveLength(2);
  });

  it.each([0, -1, 1.5, '7000', null])('rejects invalid catalog price %s', async price => {
    const s = setup();
    s.tables.ebook_products[0].price = price;
    expect((await s.request({ slug })).status).toBe(409);
    expect(s.tables.ebook_checkout_orders).toHaveLength(0);
  });

  it('rejects unpublished products and unauthenticated or malformed requests', async () => {
    const s = setup();
    s.tables.ebook_products[0].published = false;
    expect((await s.request({ slug })).status).toBe(404);
    expect((await s.request({ slug, userId: 'buyer-A' }, 'invalid-token')).status).toBe(401);
    expect((await s.request({ slug }, '', { headers: {} })).status).toBe(401);
    expect((await s.request({ slug: {} })).status).toBe(400);
    expect((await s.request({ slug, paymentId: null })).status).toBe(400);
    expect((await s.request({ slug }, 'buyer-A', { body: '{broken' })).status).toBe(400);
    expect(s.tables.ebook_checkout_orders).toHaveLength(0);
  });
});

describe('bound purchase ownership and idempotency', () => {
  it('rejects B claiming A before first use, even with forged UID/customData and B already entitled', async () => {
    const s = setup();
    const order = await s.create();
    s.tables.ebook_entitlements.push({ user_id: 'buyer-B', product_id: product.id, status: 'active', source: 'manual' });
    s.payments.get(order.paymentId).customData = JSON.stringify({ slug, userId: 'buyer-B' });
    const denied = await s.request({ slug, paymentId: order.paymentId, userId: 'buyer-A' }, 'buyer-B');
    expect(denied).toMatchObject({ status: 403, body: { error: 'payment buyer mismatch' } });
    expect(s.lookupPayment).not.toHaveBeenCalled();
    expect(s.rpc).not.toHaveBeenCalled();
    expect(s.tables.ebook_entitlements).toHaveLength(1);
    expect((await s.request({ slug, paymentId: order.paymentId })).body.ok).toBe(true);
  });

  it('allows A to retry safely and continues to reject B after grant', async () => {
    const s = setup();
    const order = await s.create();
    const body = { slug, paymentId: order.paymentId };
    expect((await s.request(body)).body).toEqual({ ok: true, already: false });
    const original = structuredClone(s.tables.ebook_entitlements);
    expect((await s.request(body)).body).toEqual({ ok: true, already: true });
    expect((await s.request(body, 'buyer-B')).status).toBe(403);
    expect(s.tables.ebook_entitlements).toEqual(original);
    expect(s.rpc).toHaveBeenCalledTimes(2);
    expect(s.lookupPayment).toHaveBeenCalledTimes(2);
  });

  it('handles simultaneous A/B submissions and repeated A verification', async () => {
    const s = setup();
    const order = await s.create();
    const body = { slug, paymentId: order.paymentId };
    const results = await Promise.all([s.request(body, 'buyer-B'), s.request(body), s.request(body)]);
    expect(results.map(r => r.status)).toEqual([403, 200, 200]);
    expect(s.tables.ebook_entitlements).toHaveLength(1);
    expect(s.tables.ebook_entitlements[0].user_id).toBe('buyer-A');
  });

  it('verifies the immutable price/product snapshot after catalog edits/unpublishing', async () => {
    const s = setup();
    const order = await s.create();
    Object.assign(s.tables.ebook_products[0], { price: 9000, published: false, slug: 'renamed' });
    expect((await s.request({ slug, paymentId: order.paymentId })).status).toBe(200);
    expect(s.tables.ebook_entitlements[0].product_id).toBe(product.id);
  });

  it.each(['manual', 'smartstore', 'portone'])('preserves existing active %s entitlements byte-for-byte', async source => {
    const s = setup();
    const order = await s.create();
    const existing = { user_id: 'buyer-A', product_id: product.id, status: 'active', source, order_ref: 'old-ref' };
    s.tables.ebook_entitlements.push({ ...existing });
    expect((await s.request({ slug, paymentId: order.paymentId })).body.already).toBe(true);
    expect(s.tables.ebook_entitlements).toEqual([existing]);
  });

  it('reactivates revoked access for A without losing permanent ownership of earlier orders', async () => {
    const s = setup();
    const older = await s.create();
    await s.request({ slug, paymentId: older.paymentId });
    s.tables.ebook_entitlements[0].status = 'revoked';
    const newer = await s.create();
    await s.request({ slug, paymentId: newer.paymentId });
    expect(s.tables.ebook_entitlements[0].order_ref).toBe(newer.paymentId);
    expect((await s.request({ slug, paymentId: older.paymentId }, 'buyer-B')).status).toBe(403);
    expect(s.tables.ebook_checkout_orders).toHaveLength(2);
  });

  it.each([
    [{ status: 'CANCELLED' }, 'not paid'],
    [{ status: 'PARTIAL_CANCELLED' }, 'not paid'],
    [{ status: 'READY' }, 'not paid'],
    [{ amount: { total: 1 } }, 'amount mismatch'],
    [{ amount: { total: '7000' } }, 'amount mismatch'],
    [{ currency: 'USD' }, 'currency mismatch'],
    [{ currency: undefined }, 'currency mismatch'],
    [{ storeId: 'other-store' }, 'store mismatch'],
    [{ customData: JSON.stringify({ slug: 'other' }) }, 'product mismatch'],
    [{ customData: '{broken' }, 'product mismatch'],
    [{ id: 'other-id' }, 'payment mismatch'],
  ])('does not grant for provider mismatch %j', async (patch, error) => {
    const s = setup();
    const order = await s.create();
    Object.assign(s.payments.get(order.paymentId), patch);
    const result = await s.request({ slug, paymentId: order.paymentId });
    expect(result).toMatchObject({ status: 402, body: { error } });
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it('rejects wrong product before provider lookup and does not revive cancelled access', async () => {
    const s = setup();
    const order = await s.create();
    expect((await s.request({ slug: 'other', paymentId: order.paymentId })).status).toBe(409);
    expect(s.lookupPayment).not.toHaveBeenCalled();
    await s.request({ slug, paymentId: order.paymentId });
    s.tables.ebook_entitlements[0].status = 'revoked';
    s.payments.get(order.paymentId).status = 'CANCELLED';
    expect((await s.request({ slug, paymentId: order.paymentId })).status).toBe(402);
    expect(s.tables.ebook_entitlements[0].status).toBe('revoked');
  });

  it('fails closed on unavailable provider or order storage without changing access', async () => {
    const s = setup();
    const order = await s.create();
    s.lookupPayment.mockResolvedValue({ status: 0, payment: null });
    expect((await s.request({ slug, paymentId: order.paymentId })).status).toBe(502);
    s.from.mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ error: { code: 'DB_DOWN' } }) }) }) });
    expect((await s.request({ slug, paymentId: order.paymentId })).status).toBe(500);
    expect(s.rpc).not.toHaveBeenCalled();
    expect(s.tables.ebook_entitlements).toHaveLength(0);
  });

  it('returns retryable grant failure or definitive duplicate-use conflict without reporting success', async () => {
    const s = setup();
    const order = await s.create();
    s.rpc.mockResolvedValueOnce({ error: { code: '23505' } });
    expect((await s.request({ slug, paymentId: order.paymentId })).body.error).toBe('payment already used');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      s.rpc.mockResolvedValueOnce({ error: { code: 'DB_DOWN' } });
      expect((await s.request({ slug, paymentId: order.paymentId })).status).toBe(500);
    } finally { errorLog.mockRestore(); }
    expect(s.tables.ebook_entitlements).toHaveLength(0);
  });
});

describe('legacy payment policy', () => {
  it('blocks unused unbound paid IDs instead of accepting browser buyer assertions', async () => {
    const s = setup();
    s.payments.set('old-unused', { status: 'PAID', customData: JSON.stringify({ slug, userId: 'buyer-A' }) });
    for (const buyer of ['buyer-A', 'buyer-B']) {
      expect((await s.request({ slug, paymentId: 'old-unused', userId: buyer }, buyer)).body.error).toBe('legacy payment unbound');
    }
    expect(s.rpc).not.toHaveBeenCalled();
    expect(s.lookupPayment).not.toHaveBeenCalled();
  });

  it('acknowledges existing active owner A without rewriting access, and rejects B', async () => {
    const s = setup();
    const original = { user_id: 'buyer-A', product_id: product.id, source: 'portone', order_ref: 'legacy', status: 'active' };
    s.tables.ebook_entitlements.push({ ...original });
    s.configured.mockReturnValue(false);
    const body = { slug, paymentId: 'legacy' };
    expect((await s.request(body)).body).toEqual({ ok: true, already: true });
    expect((await s.request(body, 'buyer-B')).status).toBe(403);
    expect(s.tables.ebook_entitlements).toEqual([original]);
    expect(s.rpc).not.toHaveBeenCalled();
    expect(s.lookupPayment).not.toHaveBeenCalled();
  });

  it('never revives revoked legacy access or substitutes another product', async () => {
    const s = setup();
    s.tables.ebook_entitlements.push({ user_id: 'buyer-A', product_id: product.id, source: 'portone', order_ref: 'legacy', status: 'revoked' });
    expect((await s.request({ slug, paymentId: 'legacy' })).status).toBe(409);
    expect((await s.request({ slug: 'other', paymentId: 'legacy' })).body.error).toBe('product mismatch');
    expect(s.rpc).not.toHaveBeenCalled();
  });
});

describe('checkout migration contract', () => {
  it('locks down all browser writes and RPC calls, protects immutable history and active rows', () => {
    const sql = readFileSync('supabase/migrations/20261003000001_ebook_checkout_orders.sql', 'utf8');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON public.ebook_checkout_orders FROM PUBLIC, anon, authenticated, service_role');
    expect(sql).toContain('GRANT SELECT, INSERT ON public.ebook_checkout_orders TO service_role');
    expect(sql).toContain('BEFORE UPDATE OR DELETE');
    expect(sql).toContain('checkout.buyer_id IS DISTINCT FROM p_buyer_id');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain("WHERE entitlement.status = 'revoked'");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.grant_ebook_checkout_order(text, uuid) FROM PUBLIC, anon, authenticated');
    expect(sql).not.toMatch(/UPDATE public\.ebook_entitlements/);
  });
});

describe('existing MagDB payment transport', () => {
  it('serializes the create shape without paymentId and verifies the issued order with authenticated headers', async () => {
    const s = setup();
    window.eval(readFileSync('js/db/commerce.js', 'utf8'));
    const { ebooks } = window.MagDBCommerce.create({
      client: () => ({}), session: async () => ({ access_token: 'buyer-A' }),
      url: 'https://example.test', webzine: {},
    });
    const transport = vi.fn(async (url, options) => s.handler(new Request(url, options)));
    vi.stubGlobal('fetch', transport);
    try {
      const created = await ebooks.purchaseVerify(slug);
      expect(created.ok).toBe(true);
      const [url, options] = transport.mock.calls[0];
      expect(url).toBe('https://example.test/functions/v1/ebook-purchase');
      expect(JSON.parse(options.body)).toEqual({ slug });
      expect(options.headers.Authorization).toBe('Bearer buyer-A');
      const { paymentId } = created.order;
      s.payments.set(paymentId, { id: paymentId, status: 'PAID', amount: { total: 7000 }, currency: 'KRW', storeId, customData: { slug } });
      expect(await ebooks.purchaseVerify(slug, paymentId)).toEqual({ ok: true, already: false });
      expect(s.tables.ebook_entitlements[0].user_id).toBe('buyer-A');
    } finally {
      vi.unstubAllGlobals();
      delete window.MagDBCommerce;
    }
  });
});
