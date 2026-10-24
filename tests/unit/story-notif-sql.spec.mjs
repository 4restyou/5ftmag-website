// @vitest-environment node
// 기사 게재 알림 마이그레이션(20261024000001)을 pglite 에 적용해 본다.
// 승인된 실린 사진의 주인에게만 한 번 가고, 다시 실행해도 겹치지 않는다.
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATION = readFileSync('supabase/migrations/20261024000001_notify_readers_5000_story.sql', 'utf8');
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
let db;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${A}'), ('${B}'), ('${C}');
    CREATE TABLE public.user_notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id),
      type text NOT NULL CONSTRAINT user_notifications_type_check CHECK (type IN ('submission_approved')),
      related_id uuid, title text NOT NULL, body text, link text, meta jsonb,
      read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.reader_submissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, status text, storage_path text,
      film text, created_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO public.reader_submissions (user_id, status, storage_path, film) VALUES
      ('${A}', 'approved', 'b8196d89-308b-4cdf-903b-9c6a33a0d70b/1789540921540-11d65f25-e604-4d95-b4ce-0d20ab6eb206.jpg', 'Kodak T-Max 400'),
      ('${B}', 'approved', '9b65bf32-4a7f-43c7-b2cc-3193519462e7/1790500224978-dbaabdbc-9f1f-4647-bf4e-faf6193761b5.jpg', 'OptiColour 200'),
      ('${C}', 'rejected', '27b9b3ef-0659-4bd9-a296-6a7fa2f45173/1778594591864-ff5ad96e-0439-437d-82ae-7111e8250eab.jpg', 'Fujifilm 200'),
      ('${C}', 'approved', 'someone/else.jpg', 'Gold 200');`);
  await db.exec(MIGRATION.replace(/NOTIFY pgrst[^;]*;/, ''));
  await db.exec(MIGRATION.replace(/NOTIFY pgrst[^;]*;/, ''));
});
afterAll(() => db?.close());

describe('기사 게재 알림', () => {
  it('승인된 실린 사진의 주인에게만 한 번씩', async () => {
    const { rows } = await db.query(`SELECT user_id, type, link, meta FROM public.user_notifications ORDER BY user_id`);
    expect(rows.map(r => r.user_id)).toEqual([A, B]);
    expect(rows.every(r => r.type === 'submission_in_story' && r.link === '/stories/readers-5000.html')).toBe(true);
    expect(rows[0].meta).toMatchObject({ story: 'readers-5000', title_en: 'Twelve Frames from 5,000' });
  });
});
