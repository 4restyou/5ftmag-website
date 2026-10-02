// Runtime dependencies are injected so tests exercise the actual HTTP workflow.
// deno-lint-ignore-file no-explicit-any
import { portonePaymentSlug, portonePaymentStatus } from '../_shared/entitlement.ts';

type Dependencies = {
  admin: any;
  lookupPayment: (id: string) => Promise<{ status: number; payment: any }>;
  configured: () => boolean;
  storeId: string;
  randomUUID: () => string;
};

function cors(origin: string | null): Record<string, string> {
  const allowed = origin === 'https://www.5ftmag.com' || origin === 'https://5ftmag.com'
    || /^https:\/\/([a-z0-9]+(-[a-z0-9]+)*--)?5ftmag\.netlify\.app$/.test(origin || '');
  return {
    'Access-Control-Allow-Origin': allowed ? origin! : 'https://www.5ftmag.com',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function createPaymentHandler(deps: Dependencies) {
  const { admin, lookupPayment, configured, storeId, randomUUID } = deps;
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin');
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(origin) },
    });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);

    try {
      const auth = req.headers.get('authorization') || '';
      const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
      if (!token) return json({ error: 'login required' }, 401);
      const { data: userData, error: authError } = await admin.auth.getUser(token);
      const user = userData?.user;
      if (authError || !user) return json({ error: 'login required' }, 401);

      let body: any;
      try { body = await req.json(); } catch { return json({ error: 'invalid request' }, 400); }
      const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
      if (!slug || slug.length > 200) return json({ error: 'slug required' }, 400);

      // Omitting paymentId creates an order. Explicit null/empty IDs are invalid,
      // not a way to turn a failed verification into a new checkout.
      if (!Object.prototype.hasOwnProperty.call(body, 'paymentId')) {
        if (!configured()) return json({ error: 'payment not configured' }, 503);
        const { data: product, error } = await admin.from('ebook_products')
          .select('id, slug, title, price, published').eq('slug', slug).maybeSingle();
        if (error) return json({ error: 'order lookup failed' }, 500);
        if (!product?.published) return json({ error: 'not found' }, 404);
        if (!Number.isSafeInteger(product.price) || product.price <= 0) {
          return json({ error: 'invalid price' }, 409);
        }
        const order = {
          payment_id: `eb_${randomUUID()}`, buyer_id: user.id, product_id: product.id,
          slug: product.slug, title: product.title, price: product.price,
          currency: 'KRW', store_id: storeId,
        };
        const result = await admin.from('ebook_checkout_orders').insert(order);
        if (result.error) return json({ error: 'order creation failed' }, 500);
        return json({ ok: true, order: {
          paymentId: order.payment_id, slug: order.slug, title: order.title,
          price: order.price, currency: order.currency, storeId: order.store_id,
        } });
      }

      const paymentId = typeof body.paymentId === 'string' ? body.paymentId.trim() : '';
      if (!paymentId || paymentId.length > 200) return json({ error: 'paymentId required' }, 400);
      const { data: order, error: orderError } = await admin.from('ebook_checkout_orders')
        .select('payment_id, buyer_id, product_id, slug, price, currency, store_id')
        .eq('payment_id', paymentId).maybeSingle();
      if (orderError) return json({ error: 'order lookup failed' }, 500);

      if (!order) {
        // Legacy receipts establish only an existing owner's access. Never use a
        // browser-supplied UID or provider customData to backfill an unused ID.
        const { data: legacy, error } = await admin.from('ebook_entitlements')
          .select('user_id, product_id, status').eq('order_ref', paymentId)
          .eq('source', 'portone').maybeSingle();
        if (error) return json({ error: 'order lookup failed' }, 500);
        if (!legacy) return json({ error: 'legacy payment unbound' }, 409);
        if (legacy.user_id !== user.id) return json({ error: 'payment buyer mismatch' }, 403);
        const { data: product, error: productError } = await admin.from('ebook_products')
          .select('slug').eq('id', legacy.product_id).maybeSingle();
        if (productError) return json({ error: 'order lookup failed' }, 500);
        if (product?.slug !== slug) return json({ error: 'product mismatch' }, 409);
        if (legacy.status !== 'active') return json({ error: 'legacy payment unbound' }, 409);
        // Cancellation/reverification stays with ebook-page. This is a read-only
        // acknowledgement, not a new grant or revival of revoked access.
        return json({ ok: true, already: true });
      }

      // Must precede provider lookup AND any existing-entitlement shortcut.
      if (order.buyer_id !== user.id) return json({ error: 'payment buyer mismatch' }, 403);
      if (order.slug !== slug) return json({ error: 'product mismatch' }, 409);
      if (!configured()) return json({ error: 'payment not configured' }, 503);
      const lookup = await lookupPayment(paymentId);
      if (lookup.status === 404) return json({ error: 'payment not found' }, 404);
      if (lookup.status !== 200 || !lookup.payment) return json({ error: 'payment lookup failed' }, 502);
      const payment = lookup.payment;
      const status = portonePaymentStatus(payment);
      if (status !== 'PAID') return json({ error: 'not paid', status }, 402);
      if (typeof payment?.amount?.total !== 'number' || payment.amount.total !== order.price) {
        return json({ error: 'amount mismatch' }, 402);
      }
      if (payment.currency !== order.currency) return json({ error: 'currency mismatch' }, 402);
      if (payment.storeId !== order.store_id || order.store_id !== storeId) {
        return json({ error: 'store mismatch' }, 402);
      }
      if (portonePaymentSlug(payment) !== order.slug) return json({ error: 'product mismatch' }, 402);
      if (payment.id && payment.id !== paymentId) return json({ error: 'payment mismatch' }, 402);

      // The RPC rechecks the immutable owner and atomically grants/reactivates.
      // It cannot overwrite active manual, Smart Store, or earlier paid access.
      const { data: grant, error } = await admin.rpc('grant_ebook_checkout_order', {
        p_payment_id: paymentId, p_buyer_id: user.id,
      });
      if (error) {
        if (error.code === '23505') return json({ error: 'payment already used' }, 409);
        console.error('[ebook-purchase] grant failed', error.code || 'unknown');
        return json({ error: 'grant failed' }, 500);
      }
      if (!grant?.ok) return json({ error: 'grant failed' }, 500);
      return json(grant);
    } catch (error) {
      console.error('[ebook-purchase] request failed', (error as Error)?.name || 'unknown');
      return json({ error: 'payment request failed' }, 500);
    }
  };
}
