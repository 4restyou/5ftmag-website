// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';

let db;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE TABLE page_views (path text, session_id text, ts timestamptz DEFAULT now());
    CREATE TABLE page_dwells (path text, session_id text, ts timestamptz DEFAULT now());
    CREATE TABLE app_events (path text, session_id text, ts timestamptz DEFAULT now());
  `);
  await db.exec(await fs.readFile('supabase/migrations/20261003000002_telemetry_write_budget.sql', 'utf8'));
  // 작은 예산으로 실제 트리거의 경계값을 실행한다.
  await db.exec(`DROP TRIGGER page_views_rate_limit ON page_views;
    CREATE TRIGGER page_views_rate_limit BEFORE INSERT ON page_views
    FOR EACH ROW EXECUTE FUNCTION telemetry_rate_limit('2', '4');`);
}, 15000);
beforeEach(async () => { await db.exec('TRUNCATE page_views, page_dwells, app_events, telemetry_write_budgets;'); });
afterAll(async () => { await db?.close(); });

describe('database telemetry write budget', () => {
  it('drops null, empty and overlong session IDs', async () => {
    await db.exec(`INSERT INTO page_views(session_id) VALUES (NULL), (''), ('  '), (repeat('a', 65));`);
    expect((await db.query('SELECT count(*)::int AS count FROM page_views')).rows[0].count).toBe(0);
    expect((await db.query('SELECT count(*)::int AS count FROM telemetry_write_budgets')).rows[0].count).toBe(0);
  });

  it('cannot bypass the table budget by rotating session IDs', async () => {
    await db.exec(`INSERT INTO page_views(session_id) SELECT 'rotating-' || i FROM generate_series(1, 8) AS i;`);
    expect((await db.query('SELECT count(*)::int AS count FROM page_views')).rows[0].count).toBe(4);
    expect((await db.query('SELECT used FROM telemetry_write_budgets')).rows[0].used).toBe(4);
    expect((await db.query('SELECT count(*)::int AS count FROM telemetry_write_budgets')).rows[0].count).toBe(1);
  });

  it('limits one session and normalizes attacker-provided timestamps', async () => {
    await db.exec(`INSERT INTO page_views(session_id, ts) SELECT 'same', '2000-01-01'::timestamptz FROM generate_series(1, 4);`);
    const result = await db.query('SELECT count(*)::int AS count, min(ts) > now() - interval \'1 minute\' AS current_time FROM page_views');
    expect(result.rows[0]).toEqual({ count: 2, current_time: true });
  });

  it('renews the budget on the next server minute', async () => {
    await db.exec(`INSERT INTO telemetry_write_budgets VALUES ('page_views', date_trunc('minute', now()) - interval '1 minute', 4);
      INSERT INTO page_views(session_id) VALUES ('next-minute');`);
    expect((await db.query('SELECT used FROM telemetry_write_budgets')).rows[0].used).toBe(1);
    expect((await db.query('SELECT count(*)::int AS count FROM page_views')).rows[0].count).toBe(1);
  });

  it('keeps budgets private and migration replay safe', async () => {
    await db.exec(await fs.readFile('supabase/migrations/20261003000002_telemetry_write_budget.sql', 'utf8'));
    await db.exec('SET ROLE anon;');
    try { await expect(db.query('SELECT * FROM telemetry_write_budgets')).rejects.toThrow('permission denied'); }
    finally { await db.exec('RESET ROLE;'); }
  });
});
