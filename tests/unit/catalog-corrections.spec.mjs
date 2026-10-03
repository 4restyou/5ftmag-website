// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20261003000005_catalog_corrections.sql', 'utf8');
let db;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE webzine_issues(slug text PRIMARY KEY,title text,updated_at timestamptz,cover_path text,pdf_path text);
    CREATE TABLE repair_shops(name text,url text,address text);
    INSERT INTO webzine_issues VALUES
      ('vol-6','Kodak Ektarchrome E100',null,'vol-6/cover.jpg','vol-6/book.pdf'),
      ('vol-05','Lomography Color Nagative Series',null,'vol-5/cover.jpg','vol-5/book.pdf'),
      ('vol-04','Illford Delta Series',null,'vol-4/cover.jpg','vol-4/book.pdf'),
      ('vol-10','Kodak Ektar 100',null,'vol-10/cover.jpg','vol-10/book.pdf');
    INSERT INTO repair_shops VALUES
      ('폴라존','홈페이지 http://www.polazone.com/','Existing address'),
      ('Other shop','https://example.com/','Other address');`);
});
afterAll(async () => { await db?.close(); });
it('corrects only confirmed names and URL without replacing historic assets', async () => {
  await db.exec(sql);
  expect((await db.query('SELECT slug,title FROM webzine_issues ORDER BY slug')).rows).toEqual([
    { slug: 'vol-04', title: 'Ilford Delta Series' },
    { slug: 'vol-05', title: 'Lomography Color Negative Series' },
    { slug: 'vol-10', title: 'Kodak Ektar 100' },
    { slug: 'vol-6', title: 'Kodak Ektachrome E100' },
  ]);
  expect((await db.query("SELECT cover_path,pdf_path FROM webzine_issues WHERE slug='vol-6'")).rows[0]).toEqual({ cover_path: 'vol-6/cover.jpg', pdf_path: 'vol-6/book.pdf' });
  expect((await db.query("SELECT url,address FROM repair_shops WHERE name='폴라존'")).rows[0]).toEqual({ url: 'https://polazone.com/', address: 'Existing address' });
  expect((await db.query("SELECT url FROM repair_shops WHERE name='Other shop'")).rows[0].url).toBe('https://example.com/');
});
it('replays without changing timestamps or overwriting a later editorial correction', async () => {
  await db.exec(sql);
  const before = (await db.query('SELECT slug,updated_at FROM webzine_issues ORDER BY slug')).rows;
  await db.exec(sql);
  expect((await db.query('SELECT slug,updated_at FROM webzine_issues ORDER BY slug')).rows).toEqual(before);
  await db.exec("UPDATE webzine_issues SET title='Editorial edition' WHERE slug='vol-6'; UPDATE repair_shops SET url='https://polazone.com/new' WHERE name='폴라존';");
  await db.exec(sql);
  expect((await db.query("SELECT title FROM webzine_issues WHERE slug='vol-6'")).rows[0].title).toBe('Editorial edition');
  expect((await db.query("SELECT url FROM repair_shops WHERE name='폴라존'")).rows[0].url).toBe('https://polazone.com/new');
});
