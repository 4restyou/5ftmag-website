// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { CORE_SQL, JOB_COMMAND, JOB_NAME, JOB_SCHEDULE, JOB_SQL, MIGRATION_SQL, RUN_SQL, verifyRunEvidence } from '../../scripts/ops-health.mjs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261003000003_log_retention_schedule.sql');
const tables = [
  ['page_views', '20260518000001_page_views.sql', 'ts', 365, "path = '/'"],
  ['page_dwells', '20260518000003_page_dwells.sql', 'ts', 365, "path = '/', dwell_ms = 100"],
  ['app_events', '20260614000003_app_events.sql', 'ts', 90, "event_name = 'sheet_opened'"],
  ['client_error_logs', '20260519000002_client_error_logs.sql', 'ts', 30, "path = '/', message = 'synthetic'"],
  ['push_subscriptions', '20260614000001_push_subscriptions.sql', 'last_seen_at', 30,
    "user_id = '00000000-0000-0000-0000-000000000001', p256dh = 'synthetic', auth = 'synthetic'"],
];

describe('R12 retention migration on isolated Postgres', () => {
  let db;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
      INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001');`);
    for (const [table, file] of tables) {
      const ddl = read(`supabase/migrations/${file}`).match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`, 'i'))?.[0];
      expect(ddl, `${table} uses its real schema DDL`).toBeTruthy();
      await db.exec(ddl);
    }
    await db.exec(sql);
  }, 30_000);
  afterAll(async () => { await db?.close(); });

  it('replays without cron and keeps a clear missing-schedule warning', async () => {
    const notices = [];
    await db.exec(sql, { onNotice: notice => notices.push(notice) });
    const result = await db.query(CORE_SQL);
    expect(result.rows[0].evidence).toEqual({ cron_installed: false, function_secure: true });
    expect(sql).toContain('RAISE WARNING');
    expect(sql).toContain('R12 RETENTION NOT SCHEDULED');
    expect(notices.some(notice => notice.severity === 'WARNING' && notice.message.includes('R12 RETENTION NOT SCHEDULED'))).toBe(true);
    expect(sql).not.toMatch(/EXCEPTION\s+WHEN/i);
  });

  it('denies anon and authenticated, including editors, but allows service_role', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role};`);
      try {
        await expect(db.query('SELECT ops_private.purge_operational_logs()')).rejects.toThrow(/permission denied/);
      } finally { await db.exec('RESET ROLE;'); }
    }
    await db.exec('SET ROLE service_role;');
    try { await db.query('SELECT ops_private.purge_operational_logs()'); }
    finally { await db.exec('RESET ROLE;'); }
    expect(sql).not.toContain('_analytics_assert_editor');
  });

  it('deletes only strictly expired logs and inactive push, preserving exact cutoffs and business rows', async () => {
    await db.exec('BEGIN;');
    try {
      for (const [table, , column, days, assignments] of tables) {
        const pairs = assignments.split(', ').map(part => part.split(' = '));
        const columns = pairs.map(([key]) => key);
        const values = pairs.map(([, value]) => value);
        if (table === 'push_subscriptions') columns.push('endpoint');
        for (const [label, offset] of [['expired', "- interval '1 second'"], ['boundary', ''], ['recent', "+ interval '1 second'"]]) {
          const rowValues = [...values];
          if (table === 'push_subscriptions') rowValues.push(`'https://synthetic.invalid/${label}'`);
          await db.exec(`INSERT INTO public.${table} (${columns.join(', ')}, ${column})
            VALUES (${rowValues.join(', ')}, now() - interval '${days} days' ${offset});`);
        }
      }
      for (const table of ['reader_submissions', 'messages', 'ebook_checkout_orders']) {
        await db.exec(`CREATE TABLE public.${table} (id int PRIMARY KEY); INSERT INTO public.${table} VALUES (1);`);
      }
      await db.query('SELECT ops_private.purge_operational_logs()');
      await db.query('SELECT ops_private.purge_operational_logs()');
      for (const [table, , column, days] of tables) {
        const result = await db.query(`SELECT count(*)::int AS kept,
          bool_and(${column} >= now() - interval '${days} days') AS within_policy FROM public.${table}`);
        expect(result.rows[0]).toEqual({ kept: 2, within_policy: true });
      }
      for (const table of ['reader_submissions', 'messages', 'ebook_checkout_orders']) {
        expect((await db.query(`SELECT id FROM public.${table}`)).rows).toEqual([{ id: 1 }]);
      }
    } finally { await db.exec('ROLLBACK;'); }
    expect([...sql.matchAll(/DELETE FROM public\.(\w+)/g)].map(match => match[1])).toEqual(tables.map(([table]) => table));
  });

  it('rolls back all purge deletes when a later table fails', async () => {
    await db.exec("INSERT INTO public.page_views (path, ts) VALUES ('/', now() - interval '366 days');");
    await db.exec('ALTER TABLE public.push_subscriptions RENAME TO push_subscriptions_unavailable;');
    try {
      await expect(db.query('SELECT ops_private.purge_operational_logs()')).rejects.toThrow(/does not exist/);
      expect((await db.query('SELECT count(*)::int AS n FROM public.page_views')).rows[0].n).toBe(1);
    } finally {
      await db.exec('ALTER TABLE public.push_subscriptions_unavailable RENAME TO push_subscriptions; DELETE FROM public.page_views;');
    }
  });

  it('upserts exactly one named postgres job and removes only foreign-owner same-name duplicates', async () => {
    // A scheduler API fixture, not an actual pg_cron worker. The full DO block still executes.
    await db.exec(`CREATE SCHEMA cron;
      CREATE TABLE cron.job (
        jobid bigserial PRIMARY KEY, jobname text, username text DEFAULT current_user,
        schedule text, command text, active boolean DEFAULT true, database text DEFAULT current_database(),
        UNIQUE (jobname, username)
      );
      CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$
        INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c)
        ON CONFLICT (jobname, username) DO UPDATE SET schedule = excluded.schedule, command = excluded.command, active = true
        RETURNING jobid;
      $$;
      CREATE FUNCTION cron.unschedule(id bigint) RETURNS boolean LANGUAGE sql AS $$
        WITH removed AS (DELETE FROM cron.job WHERE jobid = id RETURNING jobid)
        SELECT EXISTS (SELECT 1 FROM removed);
      $$;
      INSERT INTO cron.job (jobname, username, schedule, command) VALUES
        ('${JOB_NAME}', 'service_role', '* * * * *', 'SELECT 1;'),
        ('unrelated-job', 'service_role', '* * * * *', 'SELECT 1;');`);
    await db.exec(sql);
    const before = (await db.query('SELECT jobid FROM cron.job WHERE jobname = $1', [JOB_NAME])).rows[0].jobid;
    await db.exec(`UPDATE cron.job SET active = false, schedule = '* * * * *' WHERE jobname = '${JOB_NAME}';`);
    await db.exec(sql);
    const jobs = (await db.query('SELECT * FROM cron.job WHERE jobname = $1', [JOB_NAME])).rows;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ jobid: before, username: 'postgres', active: true, schedule: JOB_SCHEDULE, command: JOB_COMMAND });
    expect((await db.query("SELECT count(*)::int AS n FROM cron.job WHERE jobname = 'unrelated-job'")).rows[0].n).toBe(1);
  });

  it('executes the health metadata SQL in read-only transactions without invoking purge', async () => {
    await db.exec(`CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY);
      INSERT INTO supabase_migrations.schema_migrations VALUES ('20261003000003');
      CREATE TABLE cron.job_run_details (runid bigserial PRIMARY KEY, jobid bigint, status text, start_time timestamptz, end_time timestamptz);
      INSERT INTO cron.job_run_details (jobid, status, start_time, end_time)
        SELECT jobid, 'succeeded', now() - interval '1 minute', now() FROM cron.job WHERE jobname = '${JOB_NAME}';
      INSERT INTO public.page_views (path, ts) VALUES ('/', now() - interval '366 days');`);
    await db.exec('BEGIN READ ONLY;');
    try {
      expect((await db.query(MIGRATION_SQL)).rows[0].evidence).toEqual({ recorded: true });
      expect((await db.query(JOB_SQL)).rows[0].evidence).toEqual({
        count: 1, full_visibility: true, matches: true, utc: true, launcher_enabled: true,
      });
      const run = (await db.query(RUN_SQL)).rows[0].evidence;
      expect(verifyRunEvidence(run).status).toBe('pass');
      expect((await db.query('SELECT count(*)::int AS n FROM public.page_views')).rows[0].n).toBe(1);
    } finally { await db.exec('ROLLBACK;'); }
    await db.exec("UPDATE cron.job_run_details SET start_time = now() - interval '27 hours', end_time = now() - interval '27 hours';");
    expect(verifyRunEvidence((await db.query(RUN_SQL)).rows[0].evidence).status).toBe('fail');
  });
});
