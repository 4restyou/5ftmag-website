// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const source = await fs.readFile('js/films-catalog-loader.js', 'utf8');
const execFileAsync = promisify(execFile);

function loader(listAsObject, fetch = vi.fn(), lang = 'ko') {
  const window = { MagDB: { isReady: () => true, films: { listAsObject } } };
  vm.runInNewContext(source, { window, document: { documentElement: { lang } }, fetch, console, setTimeout });
  return { load: window.FilmsCatalogLoader.load, fetch };
}

describe('public film catalog authority', () => {
  it('does not resurrect a hidden film from the static fallback', async () => {
    const staleFetch = vi.fn(async () => ({ ok: true, json: async () => ({ visible: {}, hidden: {} }) }));
    const { load } = loader(async () => ({ visible: { name: 'Visible' } }), staleFetch);
    const result = await load();
    expect(Object.keys(result.data)).toEqual(['visible']);
    expect(result.source).toBe('db');
    expect(staleFetch).not.toHaveBeenCalled();
  });

  it('honors a successful empty database result', async () => {
    const { load, fetch } = loader(async () => ({}));
    expect((await load()).data).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses static data only when database loading fails', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ offline: { desc: '원문', descEn: 'English' } }) }));
    const { load } = loader(async () => { throw new Error('offline'); }, fetch, 'en');
    const result = await load({ logger: { warn: vi.fn() } });
    expect(result.source).toBe('static');
    expect(result.data.offline.desc).toBe('English');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not turn a missing static file into a valid catalog', async () => {
    const { load } = loader(async () => { throw new Error('offline'); }, async () => ({ ok: false, status: 404 }));
    await expect(load({ logger: { warn: vi.fn() } })).rejects.toThrow('404');
  });
});

describe('film catalog build', () => {
  it.each([
    { rows: [{ slug: 'visible', name: 'Visible' }] },
    { rows: [] },
  ])('replaces stale entries with the successful database response $rows', async ({ rows }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), '5ft-film-build-'));
    const server = http.createServer((req, res) => {
      expect(new URL(req.url, 'http://localhost').searchParams.get('is_hidden')).toBe('eq.false');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(rows));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      await fs.mkdir(path.join(root, 'scripts/lib'), { recursive: true });
      await fs.mkdir(path.join(root, 'data'));
      await fs.copyFile('scripts/build-films.mjs', path.join(root, 'scripts/build-films.mjs'));
      await fs.copyFile('scripts/lib/build-warn.mjs', path.join(root, 'scripts/lib/build-warn.mjs'));
      await fs.writeFile(path.join(root, 'data/films.json'), JSON.stringify({ hidden: {}, deleted: {} }));
      await execFileAsync(process.execPath, [path.join(root, 'scripts/build-films.mjs')], {
        env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${server.address().port}`, SUPABASE_ANON_KEY: 'test' },
      });
      const catalog = JSON.parse(await fs.readFile(path.join(root, 'data/films.json'), 'utf8'));
      expect(Object.keys(catalog)).toEqual(rows.map(row => row.slug));
    } finally {
      await new Promise(resolve => server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
