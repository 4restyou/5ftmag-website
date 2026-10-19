// @vitest-environment node
// 기사별 성과·요일 시간대 통계 RPC 와 page_dwells.depth 정책을 격리된 Postgres(pglite)에서 돌린다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(path, 'utf8');
const editor = '00000000-0000-4000-8000-000000000001';
const reader = '00000000-0000-4000-8000-000000000002';
const migration = read('supabase/migrations/20261019000002_story_performance_stats.sql');
let db;

async function as(role, uid, action) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid || '']);
  await db.exec(`SET ROLE ${role}`);
  try { return await action(); } finally { await db.exec('RESET ROLE'); }
}
const asEditor = action => as('authenticated', editor, action);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    CREATE TABLE public.profiles(user_id uuid PRIMARY KEY, is_editor boolean NOT NULL DEFAULT false);
    INSERT INTO public.profiles VALUES ('${editor}', true), ('${reader}', false);`);
  const pv = read('supabase/migrations/20260518000001_page_views.sql');
  await db.exec(pv.match(/create table if not exists public\.page_views \([\s\S]*?\n\);/)[0]);
  await db.exec(pv.match(/create or replace function public\._analytics_assert_editor\(\)[\s\S]*?\n\$\$;/)[0]);
  await db.exec(read('supabase/migrations/20260518000003_page_dwells.sql'));
  await db.exec('ALTER TABLE page_views ADD COLUMN tz text, ADD COLUMN lang text;');
  await db.exec(read('supabase/migrations/20261018000002_page_view_daily_rollup.sql')
    .match(/create table if not exists public\.page_view_daily \([\s\S]*?\n\);/)[0]);
  await db.exec(`GRANT INSERT ON page_dwells TO anon, authenticated;
    GRANT USAGE ON SEQUENCE page_dwells_id_seq TO anon, authenticated;`);
  await db.exec(migration);

  await db.exec(`
    INSERT INTO page_view_daily(path, day, views, sessions) VALUES
      ('/stories/foo.html',    current_date - 2,  10, 7),
      ('/en/stories/foo',      current_date - 1,   4, 3),
      ('/ja/stories/foo.html', current_date - 1,   2, 2),
      ('/stories/bar.html',    current_date - 40,  5, 5),
      ('/films.html',          current_date - 1,  99, 9),
      ('/stories/foo.html',    current_date,     100, 100);  -- 오늘 합계는 원본으로 센다
    INSERT INTO page_views(path, session_id, ts) VALUES
      ('/stories/foo.html', 's1', now()),
      ('/stories/foo.html', 's1', now()),
      ('/stories/foo.html', 's9', now() - interval '3 days'),  -- 지난날 원본은 합계표가 맡는다
      ('/stories/../evil',  's2', now());
    INSERT INTO page_dwells(path, session_id, dwell_ms, depth) VALUES
      ('/stories/foo.html',    'a', 1000, 100),
      ('/en/stories/foo.html', 'b', 2000, 60),
      ('/ja/stories/foo',      'c', 3000, 30),
      ('/stories/foo.html',    'd', 4000, null),
      ('/stories/baz.html',    'e', 5000, 80),
      ('/about.html',          'f', 9000, null);
  `);
}, 30_000);
afterAll(async () => { await db?.close(); });

describe('admin_story_performance', () => {
  it('편집부만 통과한다', async () => {
    await expect(as('authenticated', reader, () => db.query('SELECT * FROM admin_story_performance()')))
      .rejects.toThrow('editor only');
    await expect(as('anon', null, () => db.query('SELECT * FROM admin_story_performance()')))
      .rejects.toThrow(/permission denied/);
    await expect(as('anon', null, () => db.query('SELECT * FROM admin_analytics_heatmap()')))
      .rejects.toThrow(/permission denied/);
    await expect(as('authenticated', reader, () => db.query('SELECT * FROM admin_analytics_heatmap()')))
      .rejects.toThrow('editor only');
  });

  it('세 언어판과 .html 유무를 slug 하나로 묶고 기간을 자른다', async () => {
    const { rows } = await asEditor(() => db.query(
      "SELECT * FROM admin_story_performance(current_date - 7, null) ORDER BY slug"));
    const foo = rows.find(r => r.slug === 'foo');
    expect(foo).toMatchObject({ views: 18, sessions: 13, views_ko: 12, views_en: 4, views_ja: 2 });
    expect(rows.find(r => r.slug === 'bar')).toBeUndefined();
    expect(rows.map(r => r.slug)).toEqual(['baz', 'foo']);   // 비기사 경로·이상한 경로는 없다
    const all = await asEditor(() => db.query('SELECT slug, views FROM admin_story_performance() ORDER BY slug'));
    expect(all.rows).toEqual([{ slug: 'bar', views: 5 }, { slug: 'baz', views: 0 }, { slug: 'foo', views: 18 }]);
    const old = await asEditor(() => db.query(
      'SELECT slug, views FROM admin_story_performance(current_date - 50, current_date - 30)'));
    expect(old.rows).toEqual([{ slug: 'bar', views: 5 }]);
  });

  it('체류 평균과 도달 표본을 센다', async () => {
    const { rows } = await asEditor(() => db.query('SELECT * FROM admin_story_performance()'));
    const foo = rows.find(r => r.slug === 'foo');
    expect(foo).toMatchObject({
      avg_dwell_ms: 2500, dwell_samples: 4, depth_samples: 3,
      reach_25: 3, reach_50: 2, reach_75: 1, reach_100: 1,
    });
    expect(rows.find(r => r.slug === 'baz')).toMatchObject({
      views: 0, dwell_samples: 1, depth_samples: 1, reach_75: 1, reach_100: 0,
    });
    const bar = rows.find(r => r.slug === 'bar');
    expect(bar).toMatchObject({ avg_dwell_ms: 0, dwell_samples: 0, depth_samples: 0 });
  });
});

describe('admin_analytics_heatmap', () => {
  it('한국 시간으로 요일·시간을 나누고 기간도 한국 날짜로 자른다', async () => {
    await db.exec(`TRUNCATE page_views;
      INSERT INTO page_views(path, session_id, ts) VALUES
        ('/', 'h1', '2026-10-13 15:30:00+00'),
        ('/', 'h2', '2026-10-13 15:45:00+00'),
        ('/', 'h3', '2026-10-13 14:59:00+00');`);
    // UTC 화 15:30 → 한국 수 00:30, UTC 화 14:59 → 한국 화 23:59
    const { rows } = await asEditor(() => db.query(
      "SELECT * FROM admin_analytics_heatmap('2026-10-13', '2026-10-14') ORDER BY dow, hour"));
    expect(rows).toEqual([{ dow: 2, hour: 23, views: 1 }, { dow: 3, hour: 0, views: 2 }]);
    const wed = await asEditor(() => db.query("SELECT * FROM admin_analytics_heatmap('2026-10-14', '2026-10-14')"));
    expect(wed.rows).toEqual([{ dow: 3, hour: 0, views: 2 }]);
    const tue = await asEditor(() => db.query("SELECT * FROM admin_analytics_heatmap(null, '2026-10-13')"));
    expect(tue.rows).toEqual([{ dow: 2, hour: 23, views: 1 }]);
  });
});

describe('page_dwells.depth 정책과 재실행', () => {
  it('depth 0~100 과 NULL 만 받는다', async () => {
    const insert = depth => as('anon', null, () => db.query(
      'INSERT INTO page_dwells(path, session_id, dwell_ms, depth) VALUES ($1, $2, $3, $4)',
      ['/stories/foo.html', 'p', 1500, depth]));
    await expect(insert(101)).rejects.toThrow(/row-level security/);
    await expect(insert(-1)).rejects.toThrow(/row-level security/);
    await insert(0);
    await insert(100);
    await insert(null);
    await expect(as('anon', null, () => db.query(
      "INSERT INTO page_dwells(path, session_id, dwell_ms) VALUES ('/', 'p', -5)")))
      .rejects.toThrow(/row-level security/);   // 기존 조건도 그대로다
  });

  it('두 번 적용해도 같고 search_path 가 고정돼 있다', async () => {
    await db.exec(migration);
    const policies = await db.query(`SELECT count(*)::int AS n FROM pg_policies
      WHERE tablename = 'page_dwells' AND policyname = 'anon_insert_page_dwells'`);
    expect(policies.rows[0].n).toBe(1);
    const fns = await db.query(`SELECT proname, proconfig, prosecdef FROM pg_proc
      WHERE proname IN ('admin_story_performance', 'admin_analytics_heatmap') ORDER BY proname`);
    expect(fns.rows).toEqual([
      { proname: 'admin_analytics_heatmap', proconfig: ['search_path=public'], prosecdef: true },
      { proname: 'admin_story_performance', proconfig: ['search_path=public'], prosecdef: true },
    ]);
  });
});
