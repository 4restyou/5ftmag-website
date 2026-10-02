// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { removeStaleFilmPages } from '../../scripts/lib/film-page-cleanup.mjs';

describe('generated film page cleanup', () => {
  it.each([{ slugs: ['visible'] }, { slugs: [] }])('removes hidden/deleted generated details without touching authored pages ($slugs)', async ({ slugs }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'film-cleanup-'));
    try {
      const dirs = ['ko', 'en', 'ja'].map(lang => path.join(root, lang));
      for (const directory of dirs) {
        await fs.mkdir(directory);
        for (const slug of ['visible', 'hidden', 'deleted']) {
          await fs.writeFile(path.join(directory, `${slug}.html`), `<section id="filmReaderPhotos" data-film-slug="${slug}"></section>`);
        }
        await fs.writeFile(path.join(directory, 'guide.html'), '<h1>Authored film guide</h1>');
      }
      expect(await removeStaleFilmPages(dirs, slugs)).toBe((3 - slugs.length) * 3);
      for (const directory of dirs) expect((await fs.readdir(directory)).sort()).toEqual(['guide.html', ...slugs.map(slug => `${slug}.html`)].sort());
      expect(await removeStaleFilmPages(dirs, slugs)).toBe(0);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
