// @vitest-environment node
// 회원 탈퇴 마이그레이션(20261019000003)을 격리된 Postgres(pglite)에 실제로 적용해 본다.
// 댓글·구매 기록은 auth 사용자를 지워도 남고(작성자·구매자만 비워진다), 개인용 행은 함께 지워진다.
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const MIGRATION = read('supabase/migrations/20261019000004_account_self_delete.sql');
const LEAVER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const EDITOR = '00000000-0000-4000-8000-000000000003';
const PRODUCT = '00000000-0000-4000-8000-000000000010';
const C1 = '00000000-0000-4000-8000-000000000021';
const C2 = '00000000-0000-4000-8000-000000000022';
const PAYMENT = 'eb_00000000-0000-4000-8000-000000000031';
let db;
let blockedBeforeMigration;

async function fkRules() {
  const { rows } = await db.query(`
    SELECT con.conrelid::regclass::text AS tbl, a.attname AS col, con.confdeltype AS rule, a.attnotnull AS notnull
    FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
    WHERE con.contype = 'f' AND con.confrelid = 'auth.users'::regclass
    ORDER BY 1, 2`);
  return rows;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    CREATE PUBLICATION supabase_realtime;`);
  // 실제 스키마: 댓글·좋아요·프로필·공개 뷰(베이스라인) + 지금 운영 중인 뷰·작성자 가드(security_hardening_2)
  await db.exec(read('db/comments-schema.sql'));
  const hardening = read('supabase/migrations/20261002000004_security_hardening_2.sql');
  await db.exec(hardening.match(/CREATE OR REPLACE VIEW public\.comments_with_meta[\s\S]*?REVOKE ALL ON FUNCTION public\.comments_owner_guard\(\) FROM PUBLIC, anon, authenticated;/)[0]);
  const market = read('db/market-schema.sql');
  await db.exec(`CREATE TABLE public.market_listings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);`);
  await db.exec(market.match(/CREATE TABLE IF NOT EXISTS public\.market_reports \([\s\S]*?\n\);/)[0]);
  await db.exec(`
    CREATE TABLE public.ebook_products (id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, title text NOT NULL,
      price integer NOT NULL, published boolean NOT NULL DEFAULT false);
    CREATE TABLE public.ebook_entitlements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES public.ebook_products(id) ON DELETE CASCADE,
      source text NOT NULL DEFAULT 'manual', order_ref text NOT NULL DEFAULT '',
      granted_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
      status text NOT NULL DEFAULT 'active', UNIQUE (user_id, product_id));`);
  await db.exec(read('supabase/migrations/20261003000001_ebook_checkout_orders.sql')
    .split('-- Only the authenticated Edge Function')[0]);

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${LEAVER}', 'leaver@example.test'), ('${OTHER}', 'other@example.test'), ('${EDITOR}', 'ed@example.test');
    UPDATE public.profiles SET display_name = 'Leaver', avatar_url = 'https://x.test/a.jpg' WHERE user_id = '${LEAVER}';
    INSERT INTO public.comments (id, page_id, user_id, body) VALUES
      ('${C1}', 'stories/1', '${LEAVER}', '남길 본문'), ('${C2}', 'stories/1', '${OTHER}', '답글');
    UPDATE public.comments SET parent_id = '${C1}' WHERE id = '${C2}';
    INSERT INTO public.likes (comment_id, user_id) VALUES ('${C2}', '${LEAVER}'), ('${C1}', '${OTHER}');
    INSERT INTO public.market_listings (id, user_id) VALUES ('${PRODUCT}', '${OTHER}');
    INSERT INTO public.market_reports (listing_id, reporter_id, reason, status, resolved_by)
      VALUES ('${PRODUCT}', '${LEAVER}', '사기', 'resolved', '${EDITOR}');
    INSERT INTO public.ebook_products VALUES ('${PRODUCT}', 'issue-01', 'Issue 01', 7000, true);
    INSERT INTO public.ebook_entitlements (user_id, product_id, source, order_ref) VALUES ('${LEAVER}', '${PRODUCT}', 'portone', '${PAYMENT}');
    INSERT INTO public.ebook_checkout_orders (payment_id, buyer_id, product_id, slug, title, price, currency, store_id)
      VALUES ('${PAYMENT}', '${LEAVER}', '${PRODUCT}', 'issue-01', 'Issue 01', 7000, 'KRW', 'store');`);

  // 마이그레이션 전: 결제 주문 장부(NO ACTION)가 auth 사용자 삭제를 막는다
  blockedBeforeMigration = await db.query(`DELETE FROM auth.users WHERE id = '${LEAVER}'`).then(() => null, e => e.message);
  await db.exec(MIGRATION);
}, 30_000);

afterAll(async () => { await db?.close(); });

describe('account self-delete migration', () => {
  it('마이그레이션 전에는 구매 이력이 있는 회원의 auth 삭제가 실패했다', () => {
    expect(blockedBeforeMigration).toMatch(/foreign key/i);
  });

  it('남길 행의 외래키를 SET NULL 로, NOT NULL 을 푼다. 재실행해도 한 개씩', async () => {
    await db.exec(MIGRATION);
    const rules = await fkRules();
    const pick = (tbl, col) => rules.filter(r => r.tbl === tbl && r.col === col);
    for (const [tbl, col] of [['comments', 'user_id'], ['ebook_entitlements', 'user_id'],
      ['ebook_checkout_orders', 'buyer_id'], ['market_reports', 'resolved_by']]) {
      expect(pick(tbl, col), `${tbl}.${col}`).toEqual([{ tbl, col, rule: 'n', notnull: false }]);
    }
    // 개인용 행은 그대로 CASCADE
    expect(pick('likes', 'user_id')[0].rule).toBe('c');
    expect(pick('market_reports', 'reporter_id')[0].rule).toBe('c');
    expect(pick('profiles', 'user_id')[0].rule).toBe('c');
  });

  it('auth 사용자를 지우면 댓글은 남고 작성자만 비며, 공개 뷰에 이름·아바타가 나가지 않는다', async () => {
    await db.exec(`DELETE FROM auth.users WHERE id = '${LEAVER}'`);
    const { rows } = await db.query(`SELECT id, user_id, body, display_name, avatar_url, is_editor, like_count
      FROM public.comments_with_meta ORDER BY id`);
    expect(rows[0]).toEqual({ id: C1, user_id: null, body: '남길 본문', display_name: null, avatar_url: null, is_editor: null, like_count: 1 });
    expect(rows[1]).toMatchObject({ id: C2, user_id: OTHER, like_count: 0 });
    // 답글 스레드는 끊기지 않는다
    expect((await db.query(`SELECT parent_id FROM public.comments WHERE id = '${C2}'`)).rows[0].parent_id).toBe(C1);
  });

  it('구매 기록·결제 장부는 남고 회원 연결만 비며, 개인용 행은 지워진다', async () => {
    const ent = (await db.query('SELECT user_id, order_ref, source FROM public.ebook_entitlements')).rows;
    expect(ent).toEqual([{ user_id: null, order_ref: PAYMENT, source: 'portone' }]);
    const orders = (await db.query('SELECT buyer_id, price FROM public.ebook_checkout_orders')).rows;
    expect(orders).toEqual([{ buyer_id: null, price: 7000 }]);
    const count = async (sql) => (await db.query(sql)).rows[0].n;
    expect(await count(`SELECT count(*)::int AS n FROM public.profiles WHERE user_id = '${LEAVER}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM public.likes WHERE user_id = '${LEAVER}'`)).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM public.market_reports')).toBe(0);
  });

  it('결제 장부는 여전히 고칠 수 없다(외래키가 buyer_id 만 비우는 경우만 통과)', async () => {
    await expect(db.query(`UPDATE public.ebook_checkout_orders SET price = 1`)).rejects.toThrow(/immutable/);
    await expect(db.query(`UPDATE public.ebook_checkout_orders SET buyer_id = '${OTHER}'`)).rejects.toThrow(/immutable/);
    await expect(db.query(`DELETE FROM public.ebook_checkout_orders`)).rejects.toThrow(/immutable/);
  });

  it('편집부가 처리자로 남은 기록도 편집부 계정 삭제를 막지 않는다', async () => {
    await db.exec(`INSERT INTO public.market_reports (listing_id, reporter_id, reason, status, resolved_by)
      VALUES ('${PRODUCT}', '${OTHER}', '중복', 'resolved', '${EDITOR}')`);
    await db.exec(`DELETE FROM auth.users WHERE id = '${EDITOR}'`);
    expect((await db.query('SELECT resolved_by FROM public.market_reports')).rows).toEqual([{ resolved_by: null }]);
  });

  it('작성자 없는 댓글을 로그인 회원이 가져가거나 새로 만들 수 없다', async () => {
    await db.exec('GRANT SELECT, INSERT, UPDATE ON public.comments TO authenticated; GRANT SELECT ON public.profiles TO authenticated;');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [OTHER]);
    await db.exec('SET ROLE authenticated');
    try {
      const taken = await db.query(`UPDATE public.comments SET user_id = '${OTHER}' WHERE id = '${C1}' RETURNING id`);
      expect(taken.rows).toEqual([]);
      await expect(db.query(`INSERT INTO public.comments (page_id, user_id, body) VALUES ('stories/1', NULL, 'x')`))
        .rejects.toThrow(/row-level security/);
    } finally {
      await db.exec('RESET ROLE');
    }
  });
});
