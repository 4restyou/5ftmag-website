// @vitest-environment node
// 20261019000001: 투고 INSERT 의 theme_month·storage_path 검사, 승인 사진 수정 시 검토 대기, 승인 사진 파일 삭제 막기
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(path, 'utf8');
const owner = '00000000-0000-4000-8000-000000000011';
const victim = '00000000-0000-4000-8000-000000000012';
const editor = '00000000-0000-4000-8000-000000000013';
const migration = read('supabase/migrations/20261019000001_submission_guard_hardening.sql');
let db;

async function asUser(uid, action) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.exec('SET ROLE authenticated');
  try { return await action(); } finally { await db.exec('RESET ROLE'); }
}
const insert = (uid, path, theme = null) => asUser(uid, () => db.query(
  `INSERT INTO reader_submissions(user_id, storage_path, status, consent_publish, theme_month)
   VALUES ($1, $2, 'pending', true, $3) RETURNING id`, [uid, path, theme]));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    INSERT INTO auth.users VALUES ('${owner}'), ('${victim}'), ('${editor}');
    CREATE TABLE public.profiles(user_id uuid PRIMARY KEY, is_editor boolean NOT NULL DEFAULT false);
    INSERT INTO public.profiles VALUES ('${owner}', false), ('${victim}', false), ('${editor}', true);
    CREATE SCHEMA storage;
    CREATE TABLE storage.objects(bucket_id text, name text);
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
      SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
    $$;
    GRANT USAGE ON SCHEMA storage TO authenticated;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, DELETE ON storage.objects TO authenticated;
    CREATE POLICY "read all" ON storage.objects FOR SELECT TO authenticated USING (true);`);
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
  // 시험용 행은 보호 트리거를 깔기 전에 넣는다
  await db.exec(`INSERT INTO reader_submissions(id,user_id,storage_path,status,consent_publish)
    VALUES ('${victim}','${victim}','${victim}/v.jpg','approved',true);
    INSERT INTO storage.objects VALUES ('reader-submissions','${victim}/v.jpg'), ('reader-submissions','${victim}/draft.jpg');`);
  await db.exec(read('supabase/migrations/20261003000004_reader_owner_update.sql'));
  await db.exec(migration);
  await db.exec(migration); // 재실행 안전
}, 30_000);
afterAll(async () => { await db?.close(); });

describe('reader submission guard hardening', () => {
  it('accepts a normal insert into the own folder with a theme name', async () => {
    expect((await insert(owner, `${owner}/a.jpg`, 'Vol.03')).rows).toHaveLength(1);
  });
  it('blocks HTML in theme_month', async () => {
    await expect(insert(owner, `${owner}/b.jpg`, '<iframe srcdoc="x">')).rejects.toThrow(/theme_month/);
  });
  it('blocks using another member\'s photo path', async () => {
    await expect(insert(owner, `${victim}/v.jpg`)).rejects.toThrow(/본인 폴더/);
    await expect(insert(owner, `${owner}/../${victim}/v.jpg`)).rejects.toThrow(/본인 폴더/);
  });
  it('moves an approved photo back to pending when its owner edits it', async () => {
    const r = await asUser(victim, () => db.query('UPDATE reader_submissions SET caption=$1 WHERE id=$2 RETURNING status, reviewed_at', ['광고', victim]));
    expect(r.rows).toEqual([{ status: 'pending', reviewed_at: null }]);
    // 편집부가 다시 승인한다(다음 시험을 위해)
    await asUser(editor, () => db.query("UPDATE reader_submissions SET status='approved' WHERE id=$1", [victim]));
  });
  it('lets editors edit an approved photo without sending it back', async () => {
    const r = await asUser(editor, () => db.query('UPDATE reader_submissions SET film=$1 WHERE id=$2 RETURNING status', ['Kodak Gold 200', victim]));
    expect(r.rows).toEqual([{ status: 'approved' }]);
  });
  it('blocks the owner from deleting a file an approved submission uses, but not other own files', async () => {
    const used = await asUser(victim, () => db.query(`DELETE FROM storage.objects WHERE name=$1 RETURNING name`, [`${victim}/v.jpg`]));
    expect(used.rows).toEqual([]);
    const draft = await asUser(victim, () => db.query(`DELETE FROM storage.objects WHERE name=$1 RETURNING name`, [`${victim}/draft.jpg`]));
    expect(draft.rows).toEqual([{ name: `${victim}/draft.jpg` }]);
  });
});
