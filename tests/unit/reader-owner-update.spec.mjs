// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(path, 'utf8');
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const editor = '00000000-0000-4000-8000-000000000003';
const migration = read('supabase/migrations/20261003000004_reader_owner_update.sql');
let db, blockedBeforeMigration;

async function asUser(uid, action) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.exec('SET ROLE authenticated');
  try { return await action(); } finally { await db.exec('RESET ROLE'); }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    INSERT INTO auth.users VALUES ('${owner}'), ('${other}'), ('${editor}');
    CREATE TABLE public.profiles(user_id uuid PRIMARY KEY, is_editor boolean NOT NULL DEFAULT false);
    INSERT INTO public.profiles VALUES ('${owner}', false), ('${other}', false), ('${editor}', true);`);
  const schema = read('db/reader-submissions-schema.sql');
  await db.exec(schema.match(/CREATE TABLE IF NOT EXISTS public\.reader_submissions \([\s\S]*?\n\);/)[0]);
  await db.exec(`ALTER TABLE reader_submissions ADD COLUMN featured_at timestamptz;
    ALTER TABLE reader_submissions ADD COLUMN featured_note text;
    ALTER TABLE reader_submissions ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON profiles TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON reader_submissions TO authenticated;`);
  for (const name of ['own submissions readable', 'editors read all', 'authenticated can submit', 'editors review']) {
    await db.exec(schema.match(new RegExp(`CREATE POLICY "${name}"[\\s\\S]*?;`))[0]);
  }
  await db.exec(`INSERT INTO reader_submissions(id,user_id,storage_path,status,consent_publish)
    VALUES ('${owner}','${owner}','${owner}/a.jpg','pending',true),
           ('${other}','${other}','${other}/b.jpg','approved',true);`);
  await db.exec(read('supabase/migrations/20261002000003_submissions_featured_guard.sql'));
  blockedBeforeMigration = await asUser(owner, () => db.query('UPDATE reader_submissions SET caption=$1 WHERE id=$2 RETURNING id', ['Before', owner]));
  await db.exec(migration);
}, 30_000);
afterAll(async () => { await db?.close(); });

describe('reader owner update policy and immutable fields', () => {
  it('reproduces the missing-policy failure then restores own metadata editing', async () => {
    expect(blockedBeforeMigration.rows).toEqual([]);
    const result = await asUser(owner, () => db.query(`UPDATE reader_submissions
      SET submitter_name='Author', instagram='@author', film='Kodak', camera='Leica M3', caption='Saved note'
      WHERE id=$1 RETURNING id, caption`, [owner]));
    expect(result.rows).toEqual([{ id: owner, caption: 'Saved note' }]);
  });
  it('is replay safe and fixes the definer search path', async () => {
    await db.exec(migration);
    expect((await db.query(`SELECT count(*)::int AS n FROM pg_policies
      WHERE tablename='reader_submissions' AND policyname='own submissions updatable'`)).rows[0].n).toBe(1);
    const config = (await db.query("SELECT proconfig FROM pg_proc WHERE oid='reader_submissions_owner_guard()'::regprocedure")).rows[0].proconfig;
    expect(config).toContain('search_path=public, pg_temp');
  });
  it('does not let a member update another owner', async () => {
    expect((await asUser(owner, () => db.query('UPDATE reader_submissions SET caption=$1 WHERE id=$2 RETURNING id', ['Forged', other]))).rows).toEqual([]);
  });
  it('allows metadata correction on an approved own submission without changing approval', async () => {
    expect((await asUser(other, () => db.query('UPDATE reader_submissions SET caption=$1 WHERE id=$2 RETURNING status', ['Own approved edit', other]))).rows).toEqual([{ status: 'approved' }]);
  });
  it.each([
    ['id', `'${editor}'`], ['user_id', `'${other}'`], ['storage_path', "'changed.jpg'"],
    ['status', "'approved'"], ['rejection_reason', "'Forged'"], ['reviewed_at', 'now()'],
    ['reviewed_by', `'${editor}'`], ['theme_month', "'2026-10'"], ['consent_publish', 'false'],
    ['featured_at', 'now()'], ['featured_note', "'Forged'"], ['created_at', "now() - interval '1 day'"],
  ])('blocks owner edits to %s', async (column, value) => {
    await expect(asUser(owner, () => db.query(`UPDATE reader_submissions SET ${column}=${value} WHERE id=$1`, [owner]))).rejects.toThrow(/만 수정/);
  });
  it('protects newly added server fields without widening the metadata allowlist', async () => {
    await db.exec('ALTER TABLE reader_submissions ADD COLUMN server_flag boolean DEFAULT false');
    await expect(asUser(owner, () => db.query('UPDATE reader_submissions SET server_flag=true WHERE id=$1', [owner]))).rejects.toThrow(/만 수정/);
    expect((await asUser(owner, () => db.query('UPDATE reader_submissions SET caption=NULL WHERE id=$1 RETURNING id', [owner]))).rows).toEqual([{ id: owner }]);
  });
  it('keeps editor approval and selection workflows available', async () => {
    expect((await asUser(editor, () => db.query(`UPDATE reader_submissions SET status='approved',
      reviewed_by=$1, reviewed_at=now(), featured_at=now(), featured_note='Editorial pick'
      WHERE id=$2 RETURNING status,featured_note`, [editor, owner]))).rows).toEqual([{ status: 'approved', featured_note: 'Editorial pick' }]);
  });
  it.each(["status='approved'", 'featured_at=now()', "featured_note='Forged'", 'reviewed_at=now()', `reviewed_by='${editor}'`, "rejection_reason='Forged'"])(
    'still rejects editor-only values on member INSERT: %s', async assignment => {
      const [field, value] = assignment.split('=');
      await expect(asUser(owner, () => db.query(`INSERT INTO reader_submissions(user_id,storage_path,consent_publish,${field})
        VALUES ($1,'test.jpg',true,${value})`, [owner]))).rejects.toThrow();
    });
});
