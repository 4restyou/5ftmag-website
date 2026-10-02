// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createPaymentHandler } from '../../supabase/functions/ebook-purchase/handler.ts';

const BUYER_A = '00000000-0000-4000-8000-000000000001';
const BUYER_B = '00000000-0000-4000-8000-000000000002';
const PRODUCT = '00000000-0000-4000-8000-000000000003';
const OTHER_PRODUCT = '00000000-0000-4000-8000-000000000004';
const PAYMENT = 'eb_00000000-0000-4000-8000-000000000005';
const NEXT_PAYMENT = 'eb_00000000-0000-4000-8000-000000000006';
const SLUG = 'issue-03';
let db;
let migration;

beforeAll(async () => {
  db = new PGlite();
  // Stub only the pre-existing Supabase schema. The order table, permissions,
  // immutable trigger and grant RPC below come from the unmodified migration.
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    CREATE TABLE public.profiles (user_id uuid PRIMARY KEY REFERENCES auth.users(id), is_editor boolean NOT NULL DEFAULT false);
    CREATE TABLE public.ebook_products (
      id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, title text NOT NULL,
      price integer NOT NULL, published boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.ebook_entitlements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES public.ebook_products(id) ON DELETE CASCADE,
      source text NOT NULL DEFAULT 'manual', order_ref text NOT NULL DEFAULT '',
      granted_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
      last_verified_at timestamptz, external_status text NOT NULL DEFAULT '',
      revoked_at timestamptz, revoke_reason text NOT NULL DEFAULT '',
      UNIQUE (user_id, product_id)
    );
    CREATE UNIQUE INDEX idx_ebook_entitlements_order_ref
      ON public.ebook_entitlements(order_ref)
      WHERE order_ref <> '' AND source IN ('portone', 'smartstore');
    ALTER TABLE public.ebook_entitlements ENABLE ROW LEVEL SECURITY;
    CREATE POLICY ebook_entitlements_select_own ON public.ebook_entitlements
      FOR SELECT TO authenticated USING (user_id = auth.uid());
    GRANT SELECT ON public.ebook_entitlements, public.profiles TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON public.ebook_products, public.ebook_entitlements TO service_role;
    INSERT INTO auth.users VALUES ('${BUYER_A}'), ('${BUYER_B}');
    INSERT INTO public.profiles VALUES ('${BUYER_A}', false), ('${BUYER_B}', true);
  `);
  migration = await readFile('supabase/migrations/20261003000001_ebook_checkout_orders.sql', 'utf8');
  await db.exec(migration);
}, 15000);

beforeEach(async () => {
  await db.exec(`
    RESET ROLE;
    TRUNCATE public.ebook_checkout_orders, public.ebook_entitlements, public.ebook_products;
    INSERT INTO public.ebook_products VALUES
      ('${PRODUCT}', '${SLUG}', 'Issue 03', 7000, true),
      ('${OTHER_PRODUCT}', 'issue-04', 'Issue 04', 7000, true);
  `);
});

afterAll(async () => { await db?.close(); });

async function asRole(role, action, buyer = null) {
  if (!['anon', 'authenticated', 'service_role'].includes(role)) throw new Error('invalid test role');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [buyer || '']);
  await db.exec(`SET ROLE ${role};`);
  try { return await action(); }
  finally { await db.exec('RESET ROLE;'); }
}

async function createOrder(paymentId = PAYMENT, buyer = BUYER_A, product = PRODUCT) {
  return asRole('service_role', () => db.query(`
    INSERT INTO public.ebook_checkout_orders (payment_id, buyer_id, product_id, slug, title, price, currency, store_id)
    VALUES ($1, $2, $3, $4, 'Issue 03', 7000, 'KRW', 'our-store') RETURNING *
  `, [paymentId, buyer, product, SLUG]));
}

async function grant(paymentId = PAYMENT, buyer = BUYER_A) {
  const result = await asRole('service_role', () => db.query(
    'SELECT public.grant_ebook_checkout_order($1, $2::uuid) AS result', [paymentId, buyer],
  ));
  return result.rows[0].result;
}

async function entitlementRows() {
  return (await db.query('SELECT * FROM public.ebook_entitlements ORDER BY user_id')).rows;
}

async function legacyEntitlement(status = 'revoked', source = 'portone', buyer = BUYER_A, orderRef = 'legacy-payment') {
  return db.query(`
    INSERT INTO public.ebook_entitlements
      (user_id, product_id, source, order_ref, granted_by, status, created_at, last_verified_at, external_status, revoked_at, revoke_reason)
    VALUES ($1, $2, $3, $4, $5, $6, '2026-01-01', '2026-01-02', 'LEGACY',
      CASE WHEN $6 = 'revoked' THEN '2026-01-03'::timestamptz ELSE NULL END,
      CASE WHEN $6 = 'revoked' THEN 'external:CANCELLED' ELSE '' END)
    RETURNING *
  `, [buyer, PRODUCT, source, orderRef, BUYER_B, status]);
}

describe('ebook order PostgreSQL binding and immutability', () => {
  it('persists the buyer/product/price snapshot and grants only the bound buyer', async () => {
    const order = (await createOrder()).rows[0];
    expect(order).toMatchObject({ payment_id: PAYMENT, buyer_id: BUYER_A, product_id: PRODUCT, price: 7000 });
    await legacyEntitlement('active', 'manual', BUYER_B);
    const originalB = (await entitlementRows())[0];
    await expect(grant(PAYMENT, BUYER_B)).rejects.toMatchObject({ code: '42501' });
    await expect(grant(PAYMENT, null)).rejects.toMatchObject({ code: '42501' });
    expect(await entitlementRows()).toEqual([originalB]);
    expect(await grant()).toEqual({ ok: true, already: false });
    await expect(grant(PAYMENT, BUYER_B)).rejects.toMatchObject({ code: '42501' });
    expect(await entitlementRows()).toEqual([
      expect.objectContaining({ user_id: BUYER_A, product_id: PRODUCT, order_ref: PAYMENT, status: 'active' }), originalB,
    ]);
  });

  it.each([
    ['buyer_id', BUYER_B], ['product_id', OTHER_PRODUCT], ['payment_id', NEXT_PAYMENT],
    ['price', 1], ['slug', 'issue-04'], ['title', 'Changed'], ['currency', 'USD'],
    ['store_id', 'other-store'], ['created_at', '2000-01-01'],
  ])('rejects privileged mutation of %s through the actual trigger', async (column, value) => {
    const original = (await createOrder()).rows;
    await expect(db.query(`UPDATE public.ebook_checkout_orders SET ${column} = $1 WHERE payment_id = $2`, [value, PAYMENT]))
      .rejects.toMatchObject({ code: '23514', message: 'checkout orders are immutable' });
    expect((await db.query('SELECT * FROM public.ebook_checkout_orders')).rows).toEqual(original);
  });

  it('rejects deletion and conflict-upsert rebinding, retaining the original price', async () => {
    await createOrder();
    await expect(db.query('DELETE FROM public.ebook_checkout_orders WHERE payment_id = $1', [PAYMENT]))
      .rejects.toMatchObject({ code: '23514' });
    await expect(createOrder(PAYMENT, BUYER_B)).rejects.toMatchObject({ code: '23505' });
    await expect(db.query(`
      INSERT INTO public.ebook_checkout_orders (payment_id, buyer_id, product_id, slug, title, price, currency, store_id)
      VALUES ($1, $2, $3, $4, 'Other', 1, 'KRW', 'our-store')
      ON CONFLICT (payment_id) DO UPDATE SET buyer_id = EXCLUDED.buyer_id, price = EXCLUDED.price
    `, [PAYMENT, BUYER_B, PRODUCT, SLUG])).rejects.toMatchObject({ code: '23514' });
    expect((await db.query('SELECT buyer_id, price FROM public.ebook_checkout_orders')).rows)
      .toEqual([{ buyer_id: BUYER_A, price: 7000 }]);
  });

  it('keeps the original order price/product after catalog changes and unpublishing', async () => {
    await createOrder();
    await db.query('UPDATE public.ebook_products SET price = 9000, published = false WHERE id = $1', [PRODUCT]);
    expect(await grant()).toEqual({ ok: true, already: false });
    expect((await db.query('SELECT price, product_id FROM public.ebook_checkout_orders')).rows)
      .toEqual([{ price: 7000, product_id: PRODUCT }]);
    expect((await entitlementRows())[0].product_id).toBe(PRODUCT);
  });
});

describe('ebook order PostgreSQL access controls', () => {
  it.each(['anon', 'authenticated'])('denies %s order access and RPC invocation, including editors', async role => {
    await createOrder();
    const statements = [
      ['SELECT * FROM public.ebook_checkout_orders', []],
      ["INSERT INTO public.ebook_checkout_orders (payment_id, buyer_id, product_id, slug, title, price, currency, store_id) VALUES ($1, $2, $3, 'issue-03', 'Forged', 1, 'KRW', 'our-store')", [NEXT_PAYMENT, BUYER_B, PRODUCT]],
      ['UPDATE public.ebook_checkout_orders SET price = 1', []],
      ['DELETE FROM public.ebook_checkout_orders', []],
      ['TRUNCATE public.ebook_checkout_orders', []],
      ['SELECT public.grant_ebook_checkout_order($1, $2::uuid)', [PAYMENT, BUYER_A]],
    ];
    for (const [sql, parameters] of statements) {
      await expect(asRole(role, () => db.query(sql, parameters), BUYER_B)).rejects.toMatchObject({ code: '42501' });
    }
    expect(await entitlementRows()).toHaveLength(0);
  });

  it('denies service-role UPDATE/DELETE/TRUNCATE while allowing SELECT/INSERT', async () => {
    await createOrder();
    expect((await asRole('service_role', () => db.query('SELECT * FROM public.ebook_checkout_orders'))).rows).toHaveLength(1);
    for (const sql of ['UPDATE public.ebook_checkout_orders SET price = 1', 'DELETE FROM public.ebook_checkout_orders', 'TRUNCATE public.ebook_checkout_orders']) {
      await expect(asRole('service_role', () => db.exec(sql))).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('RLS still hides every order and blocks INSERT even if browser table privileges are accidentally granted', async () => {
    await createOrder();
    await db.exec('GRANT SELECT, INSERT, UPDATE, DELETE ON public.ebook_checkout_orders TO anon, authenticated;');
    try {
      for (const [role, buyer] of [['anon', null], ['authenticated', BUYER_A], ['authenticated', BUYER_B]]) {
        expect((await asRole(role, () => db.query('SELECT * FROM public.ebook_checkout_orders'), buyer)).rows).toEqual([]);
        await expect(asRole(role, () => db.query(`
          INSERT INTO public.ebook_checkout_orders (payment_id, buyer_id, product_id, slug, title, price, currency, store_id)
          VALUES ($1, $2, $3, 'issue-03', 'Forged', 1, 'KRW', 'our-store')
        `, [NEXT_PAYMENT, BUYER_A, PRODUCT]), buyer)).rejects.toMatchObject({ code: '42501' });
        expect((await asRole(role, () => db.query('UPDATE public.ebook_checkout_orders SET price = 1 RETURNING *'), buyer)).rows).toEqual([]);
        expect((await asRole(role, () => db.query('DELETE FROM public.ebook_checkout_orders RETURNING *'), buyer)).rows).toEqual([]);
      }
    } finally {
      await db.exec('REVOKE ALL ON public.ebook_checkout_orders FROM anon, authenticated;');
    }
    expect((await db.query('SELECT price FROM public.ebook_checkout_orders')).rows).toEqual([{ price: 7000 }]);
  });

  it('exposes the granted entitlement only to its buyer through the stubbed existing entitlement policy', async () => {
    await createOrder();
    await grant();
    expect((await asRole('authenticated', () => db.query('SELECT * FROM public.ebook_entitlements'), BUYER_A)).rows).toHaveLength(1);
    expect((await asRole('authenticated', () => db.query('SELECT * FROM public.ebook_entitlements'), BUYER_B)).rows).toEqual([]);
  });
});

describe('ebook order PostgreSQL idempotency and legacy policy', () => {
  it('grants once and leaves the entire entitlement unchanged on repeated RPC calls', async () => {
    await createOrder();
    expect(await grant()).toEqual({ ok: true, already: false });
    const first = await entitlementRows();
    for (let i = 0; i < 3; i += 1) expect(await grant()).toEqual({ ok: true, already: true });
    expect(await entitlementRows()).toEqual(first);
  });

  it.each(['manual', 'smartstore', 'portone'])('preserves existing active %s access, receipt and timestamps', async source => {
    await createOrder();
    const original = (await legacyEntitlement('active', source)).rows;
    expect(await grant()).toEqual({ ok: true, already: true });
    expect(await entitlementRows()).toEqual(original);
  });

  it('never grants an unbound legacy ID or revives a revoked legacy entitlement through the RPC', async () => {
    const original = (await legacyEntitlement()).rows;
    for (const buyer of [BUYER_A, BUYER_B, null]) {
      await expect(grant('legacy-payment', buyer)).rejects.toMatchObject({ code: '42501' });
      await expect(grant('legacy-unused', buyer)).rejects.toMatchObject({ code: '42501' });
    }
    expect(await entitlementRows()).toEqual(original);
    expect((await db.query('SELECT * FROM public.ebook_checkout_orders')).rows).toEqual([]);
  });

  it('reactivates revoked legacy access only with a new bound order and retains the entitlement ID', async () => {
    const original = (await legacyEntitlement()).rows[0];
    await createOrder();
    expect(await grant()).toEqual({ ok: true, already: false });
    expect((await entitlementRows())[0]).toMatchObject({
      id: original.id, created_at: original.created_at, user_id: BUYER_A, product_id: PRODUCT,
      order_ref: PAYMENT, status: 'active', external_status: 'PAID', revoked_at: null, revoke_reason: '',
    });
    await expect(grant('legacy-payment')).rejects.toMatchObject({ code: '42501' });
  });

  it('retains original buyer binding after revoked access is replaced by a later order', async () => {
    await createOrder();
    await grant();
    await db.exec("UPDATE public.ebook_entitlements SET status = 'revoked';");
    await createOrder(NEXT_PAYMENT);
    expect(await grant(NEXT_PAYMENT)).toEqual({ ok: true, already: false });
    await expect(grant(PAYMENT, BUYER_B)).rejects.toMatchObject({ code: '42501' });
    expect((await entitlementRows())[0].order_ref).toBe(NEXT_PAYMENT);
    expect((await db.query('SELECT buyer_id FROM public.ebook_checkout_orders')).rows)
      .toEqual([{ buyer_id: BUYER_A }, { buyer_id: BUYER_A }]);
  });

  it('rejects a receipt conflict belonging to another buyer or product without overwriting grants', async () => {
    await createOrder();
    const original = (await legacyEntitlement('active', 'portone', BUYER_B, PAYMENT)).rows;
    await expect(grant()).rejects.toMatchObject({ code: '23505' });
    expect(await entitlementRows()).toEqual(original);
    await db.query('UPDATE public.ebook_entitlements SET user_id = $1, product_id = $2', [BUYER_A, OTHER_PRODUCT]);
    const differentProduct = await entitlementRows();
    await expect(grant()).rejects.toMatchObject({ code: '23505' });
    expect(await entitlementRows()).toEqual(differentProduct);
  });

  it('replays the actual migration without backfilling legacy rows or changing existing access/orders', async () => {
    await createOrder();
    const orders = (await db.query('SELECT * FROM public.ebook_checkout_orders')).rows;
    const legacy = (await legacyEntitlement()).rows;
    await db.exec(migration);
    await db.exec(migration);
    expect(await entitlementRows()).toEqual(legacy);
    expect((await db.query('SELECT * FROM public.ebook_checkout_orders')).rows).toEqual(orders);
    await expect(asRole('authenticated', () => db.query('SELECT * FROM public.ebook_checkout_orders'), BUYER_A))
      .rejects.toMatchObject({ code: '42501' });
    expect(await grant()).toEqual({ ok: true, already: false });
  });
});

// Only the Supabase transport and provider are substituted here. Every table
// query and grant executes against PGlite under the real service-role privileges.
function databasePaymentHandler() {
  const tables = new Set(['ebook_products', 'ebook_checkout_orders', 'ebook_entitlements']);
  const columns = new Set(['id', 'slug', 'title', 'price', 'published', 'payment_id', 'buyer_id', 'product_id', 'currency', 'store_id', 'user_id', 'status', 'order_ref', 'source']);
  const identifier = value => {
    if (!columns.has(value)) throw new Error('invalid test column');
    return value;
  };
  const rpc = vi.fn(async (name, args) => {
    expect(name).toBe('grant_ebook_checkout_order');
    try { return { data: await grant(args.p_payment_id, args.p_buyer_id), error: null }; }
    catch (error) { return { data: null, error }; }
  });
  const lookupPayment = vi.fn(async paymentId => ({
    status: 200, payment: { id: paymentId, status: 'PAID', amount: { total: 7000 }, currency: 'KRW', storeId: 'our-store', customData: { slug: SLUG } },
  }));
  const admin = {
    auth: { getUser: async token => ({ data: { user: [BUYER_A, BUYER_B].includes(token) ? { id: token } : null } }) },
    rpc,
    from(table) {
      if (!tables.has(table)) throw new Error('invalid test table');
      let select = '*';
      const filters = [];
      const query = {
        select(value) { select = value.split(',').map(column => identifier(column.trim())).join(', '); return query; },
        eq(column, value) { filters.push([identifier(column), value]); return query; },
        async maybeSingle() {
          try {
            const where = filters.map(([column], index) => `${column} = $${index + 1}`).join(' AND ');
            const result = await asRole('service_role', () => db.query(`SELECT ${select} FROM public.${table} WHERE ${where}`, filters.map(([, value]) => value)));
            if (result.rows.length > 1) throw new Error('multiple rows');
            return { data: result.rows[0] || null, error: null };
          } catch (error) { return { data: null, error }; }
        },
        async insert(row) {
          try {
            const keys = Object.keys(row).map(identifier);
            await asRole('service_role', () => db.query(`INSERT INTO public.${table} (${keys.join(', ')}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(', ')})`, Object.values(row)));
            return { error: null };
          } catch (error) { return { error }; }
        },
      };
      return query;
    },
  };
  const handler = createPaymentHandler({ admin, lookupPayment, configured: () => true, storeId: 'our-store', randomUUID: () => PAYMENT.slice(3) });
  async function request(body, buyer = BUYER_A) {
    const response = await handler(new Request('https://example.test/ebook-purchase', {
      method: 'POST', headers: { authorization: `Bearer ${buyer}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  }
  return { request, rpc, lookupPayment };
}

describe('ebook payment handler with actual PostgreSQL storage and RPC', () => {
  it('creates for authenticated A despite forged fields, rejects B, and grants A idempotently at the original price', async () => {
    const { request, rpc, lookupPayment } = databasePaymentHandler();
    const created = await request({ slug: SLUG, userId: BUYER_B, buyer_id: BUYER_B, price: 1 });
    expect(created).toMatchObject({ status: 200, body: { order: { paymentId: PAYMENT, price: 7000 } } });
    await db.query('UPDATE public.ebook_products SET price = 9000, published = false WHERE id = $1', [PRODUCT]);
    const verify = { slug: SLUG, paymentId: PAYMENT, userId: BUYER_A };
    expect((await request(verify, BUYER_B)).status).toBe(403);
    expect(lookupPayment).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect((await request(verify)).body).toEqual({ ok: true, already: false });
    const original = await entitlementRows();
    expect((await request(verify)).body).toEqual({ ok: true, already: true });
    expect(await entitlementRows()).toEqual(original);
    expect((await request(verify, BUYER_B)).status).toBe(403);
  });

  it('blocks revoked/unbound legacy claims even when the mocked provider would report PAID', async () => {
    const original = (await legacyEntitlement()).rows;
    const { request, rpc, lookupPayment } = databasePaymentHandler();
    expect(await request({ slug: SLUG, paymentId: 'legacy-payment' }))
      .toEqual({ status: 409, body: { error: 'legacy payment unbound' } });
    expect((await request({ slug: SLUG, paymentId: 'legacy-payment' }, BUYER_B)).status).toBe(403);
    expect(await request({ slug: SLUG, paymentId: 'legacy-unused', buyer_id: BUYER_A }))
      .toEqual({ status: 409, body: { error: 'legacy payment unbound' } });
    expect(rpc).not.toHaveBeenCalled();
    expect(lookupPayment).not.toHaveBeenCalled();
    expect(await entitlementRows()).toEqual(original);
  });

  it('acknowledges active legacy A without a database update or provider lookup, rejecting B', async () => {
    const original = (await legacyEntitlement('active')).rows;
    const { request, rpc, lookupPayment } = databasePaymentHandler();
    const body = { slug: SLUG, paymentId: 'legacy-payment' };
    expect(await request(body)).toEqual({ status: 200, body: { ok: true, already: true } });
    expect((await request(body, BUYER_B)).status).toBe(403);
    expect(await entitlementRows()).toEqual(original);
    expect(rpc).not.toHaveBeenCalled();
    expect(lookupPayment).not.toHaveBeenCalled();
  });
});
