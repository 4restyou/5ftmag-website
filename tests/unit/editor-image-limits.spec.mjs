// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { PGlite } from '@electric-sql/pglite';

let dom;
afterEach(() => dom?.window.close());
function setup() {
  dom = new JSDOM('', { url: 'https://5ftmag.com/', runScripts: 'outside-only' });
  const upload = vi.fn(async () => ({ error: null }));
  const from = vi.fn(() => ({ upload, getPublicUrl: () => ({ data: { publicUrl: 'https://example.test/image.webp' } }) }));
  const client = { storage: { from }, auth: { onAuthStateChange() {} } };
  dom.window.supabase = { createClient: () => client };
  dom.window.MagDBCommerce = { create: () => ({}) };
  dom.window.eval(readFileSync('js/db-client.js', 'utf8'));
  return { db: dom.window.MagDB, upload, from };
}
it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s at the exact size limit', async type => {
  const { db, upload, from } = setup();
  expect((await db.films.uploadCanThumbnail('film', { name: 'photo.webp', type, size: 5 * 1024 * 1024 })).error).toBeNull();
  expect((await db.articles.uploadMedia('draft/photo.webp', { type, size: 10 * 1024 * 1024 })).error).toBeNull();
  expect(from.mock.calls).toEqual([['film-thumbnails'], ['film-thumbnails'], ['article-media']]);
  expect(upload).toHaveBeenCalledTimes(2);
});
it.each(['text/html', 'image/svg+xml', 'application/pdf', ''])('rejects %s before a storage request', async type => {
  const { db, upload } = setup();
  expect((await db.films.uploadCanThumbnail('film', { name: 'photo.jpg', type, size: 100 })).error.code).toBe('UNSUPPORTED_TYPE');
  expect((await db.articles.uploadMedia('draft/photo.jpg', { type, size: 100 })).error.code).toBe('UNSUPPORTED_TYPE');
  expect(upload).not.toHaveBeenCalled();
});
it('rejects oversized and empty uploads without changing stored files', async () => {
  const { db, upload } = setup();
  expect((await db.films.uploadCanThumbnail('film', { name: 'photo.jpg', type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 })).error.code).toBe('FILE_TOO_LARGE');
  expect((await db.articles.uploadMedia('draft/photo.jpg', { type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 })).error.code).toBe('FILE_TOO_LARGE');
  expect((await db.articles.uploadMedia('draft/photo.jpg', { type: 'image/jpeg', size: 0 })).error.code).toBe('UNSUPPORTED_TYPE');
  expect(upload).not.toHaveBeenCalled();
});
it('fills only missing bucket settings and preserves other buckets and custom limits', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,file_size_limit bigint,allowed_mime_types text[],public boolean);
      INSERT INTO storage.buckets VALUES ('article-media',NULL,NULL,true),('film-thumbnails',NULL,NULL,true),('ebook-pages',NULL,NULL,false);`);
    const sql = readFileSync('supabase/migrations/20261003000006_editor_image_limits.sql', 'utf8');
    await db.exec(sql);
    const rows = (await db.query('SELECT * FROM storage.buckets ORDER BY id')).rows;
    expect(rows[0]).toMatchObject({ id: 'article-media', file_size_limit: 10 * 1024 * 1024, public: true, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] });
    expect(rows[1]).toMatchObject({ id: 'ebook-pages', file_size_limit: null, allowed_mime_types: null, public: false });
    expect(rows[2]).toMatchObject({ id: 'film-thumbnails', file_size_limit: 5 * 1024 * 1024, public: true });
    await db.exec("UPDATE storage.buckets SET file_size_limit=1024,allowed_mime_types=ARRAY['image/webp'] WHERE id='film-thumbnails';");
    await db.exec(sql);
    expect((await db.query("SELECT file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='film-thumbnails'")).rows[0]).toEqual({ file_size_limit: 1024, allowed_mime_types: ['image/webp'] });
  } finally { await db.close(); }
}, 15000);
