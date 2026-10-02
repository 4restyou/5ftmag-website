import fs from 'node:fs/promises';
import path from 'node:path';

export async function removeStaleFilmPages(directories, slugs) {
  const expected = new Set(slugs.map(slug => `${slug}.html`));
  let removed = 0;
  for (const directory of directories) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.html') || expected.has(entry.name)) continue;
      const file = path.join(directory, entry.name);
      const html = await fs.readFile(file, 'utf8');
      // Only generated film details belong to this builder; leave hand-written pages alone.
      if (!html.includes('id="filmReaderPhotos"') || !html.includes('data-film-slug="')) continue;
      await fs.unlink(file);
      removed++;
    }
  }
  return removed;
}
