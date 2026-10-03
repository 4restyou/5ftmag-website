// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SEOUL = '\uC11C\uC6B8';
const BUSAN = '\uBD80\uC0B0';
const LANGS = ['', 'en', 'ja'];
const BUILDERS = [
  { script: 'build-labs.mjs', file: 'labs.json', key: 'labs', table: 'labs', type: 'film-lab' },
  { script: 'build-repairs.mjs', file: 'repairs.json', key: 'repairs', table: 'repair_shops', type: 'camera-repair' },
];

async function sandbox() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), '5ft-catalog-build-')));
  const write = async (file, content) => {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  };
  const read = file => fs.readFile(path.join(root, file), 'utf8');
  for (const file of [
    'scripts/build-labs.mjs', 'scripts/build-repairs.mjs', 'scripts/build-lab-pages.mjs',
    'scripts/lib/site-shell.mjs', 'scripts/lib/build-warn.mjs',
  ]) await write(file, await fs.readFile(path.join(ROOT, file), 'utf8'));
  await write('data/site-shell.json', JSON.stringify({
    navigation: [], footerLinks: [], footer: { publisher: 'Fixture', copyright: 'Fixture' },
    en: { publish: true }, ja: { publish: true },
  }));
  await write('css/lab-region.css', 'main { display: block; }');
  for (const lang of LANGS) {
    await write(path.join(lang, 'labs.html'), `<!DOCTYPE html><html><head>
      <link rel="canonical" href="https://www.5ftmag.com/${lang ? `${lang}/` : ''}labs.html">
      <script src="/js/i18n.js?v=fixture"></script></head><body>
      <p>AUTHORED-BEFORE</p>
      <!-- LAB-INDEX:START -->STALE-LAB<!-- LAB-INDEX:END -->
      <!-- REPAIR-INDEX:START -->STALE-REPAIR<!-- REPAIR-INDEX:END -->
      <p>AUTHORED-AFTER</p></body></html>`);
    await write(path.join(lang, 'about.html'), '<script src="/js/i18n.js?v=fixture"></script>');
  }
  await write('data/labs.json', JSON.stringify({ labs: [{ name: 'Saved lab', region: SEOUL }] }));
  await write('data/repairs.json', JSON.stringify({ repairs: [{ name: 'Saved repair', region: BUSAN }] }));
  const requests = [];
  const responses = { labs: { body: [] }, repair_shops: { body: [] } };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    requests.push({ pathname: url.pathname, search: url.searchParams });
    const result = responses[url.pathname.split('/').pop()];
    response.writeHead(result?.status || 200, { 'Content-Type': 'application/json' });
    response.end(result?.raw ?? JSON.stringify(result?.body ?? { unexpected: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const run = async script => {
    try {
      const result = await exec(process.execPath, [path.join(root, 'scripts', script)], {
        cwd: root, timeout: 10_000,
        env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${server.address().port}`, SUPABASE_ANON_KEY: 'synthetic-test-key' },
      });
      return { ...result, code: 0 };
    } catch (error) {
      if (typeof error.code !== 'number') throw error;
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  };
  return {
    root, write, read, run, responses, requests,
    async close() {
      await new Promise(resolve => server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

async function successfulRun(env, script) {
  const result = await env.run(script);
  expect(result.code, result.stderr).toBe(0);
  return result;
}

const block = (html, marker) => html.match(new RegExp(`<!-- ${marker}:START -->([\\s\\S]*?)<!-- ${marker}:END -->`))?.[1];

describe('catalog build scripts in isolated directories', () => {
  it('omits malformed and executable website URLs without dropping shops', async () => {
    const env = await sandbox();
    try {
      await env.write('data/labs.json', JSON.stringify({ labs: [
        { name: 'Valid lab', region: SEOUL, url: 'https://example.org/lab' },
        { name: 'Unsafe lab', region: SEOUL, url: 'javascript:alert(1)' },
      ] }));
      await env.write('data/repairs.json', JSON.stringify({ repairs: [
        { name: 'Malformed shop', region: SEOUL, url: '홈페이지 http://www.polazone.com/' },
        { name: 'Credential URL', region: SEOUL, url: 'https://user:pass@example.org/' },
      ] }));
      await successfulRun(env, 'build-lab-pages.mjs');
      for (const lang of LANGS) {
        const page = await env.read(path.join(lang, 'labs/seoul.html'));
        expect(page).toContain('Valid lab');
        expect(page).toContain('Unsafe lab');
        expect(page).toContain('Malformed shop');
        expect(page).toContain('href="https://example.org/lab"');
        expect(page).not.toContain('javascript:');
        expect(page).not.toContain('polazone.com');
        expect(page).not.toContain('user:pass');
        expect(page).not.toMatch(/[\t ]+\n/);
      }
    } finally { await env.close(); }
  });
  it.each(BUILDERS)('$script publishes authoritative [] and replays it instead of keeping stale rows', async builder => {
    const env = await sandbox();
    try {
      await successfulRun(env, builder.script);
      const empty = await env.read(`data/${builder.file}`);
      expect(JSON.parse(empty)).toEqual({ source: `supabase:public.${builder.table}`, type: builder.type, count: 0, [builder.key]: [] });
      await successfulRun(env, builder.script);
      expect(await env.read(`data/${builder.file}`)).toBe(empty);
      env.responses[builder.table] = { status: 503 };
      const failure = await successfulRun(env, builder.script);
      expect(failure.stderr).toContain('::warning::');
      expect(await env.read(`data/${builder.file}`)).toBe(empty);
      for (const request of env.requests) {
        expect(request.pathname).toBe(`/rest/v1/${builder.table}`);
        expect(request.search.get('is_hidden')).toBe('eq.false');
        expect(request.search.get('order')).toBe('sort_order.asc,name.asc');
      }
    } finally { await env.close(); }
  });

  it.each(BUILDERS)('$script preserves only valid snapshots during HTTP/JSON/shape failures and otherwise fails closed', async builder => {
    const env = await sandbox();
    try {
      const file = `data/${builder.file}`;
      const good = await env.read(file);
      for (const response of [{ status: 503 }, { raw: '{broken' }, { body: { error: 'not an array' } }, { body: [null] }]) {
        env.responses[builder.table] = response;
        await env.write(file, good);
        expect((await successfulRun(env, builder.script)).stderr).toContain('::warning::');
        expect(await env.read(file)).toBe(good);
      }
      for (const empty of ['[]\n', JSON.stringify({ [builder.key]: [] })]) {
        await env.write(file, empty);
        await successfulRun(env, builder.script);
        expect(await env.read(file)).toBe(empty);
      }
      for (const invalid of [null, '{broken', '{}', 'null', JSON.stringify({ [builder.key]: [null] })]) {
        if (invalid === null) await fs.rm(path.join(env.root, file));
        else await env.write(file, invalid);
        const result = await env.run(builder.script);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('no valid');
        if (invalid !== null) expect(await env.read(file)).toBe(invalid);
        else await expect(env.read(file)).rejects.toMatchObject({ code: 'ENOENT' });
      }
    } finally { await env.close(); }
  });

  it('refreshes multilingual indexes, removes generated/legacy regions at zero, and preserves authored pages on replay', async () => {
    const env = await sandbox();
    try {
      env.responses.labs = { body: [{ name: 'Live lab', region: SEOUL, prices: {}, scan_res: '4000px', name_en: 'English lab' }] };
      env.responses.repair_shops = { body: [{ name: 'Live repair', region: BUSAN }, { name: 'Unclassified repair', region: null }] };
      await successfulRun(env, 'build-labs.mjs');
      await successfulRun(env, 'build-repairs.mjs');
      expect(JSON.parse(await env.read('data/labs.json')).labs[0]).toMatchObject({ scanRes: '4000px', nameEn: 'English lab' });
      await successfulRun(env, 'build-lab-pages.mjs');
      const authored = '<h1>Authored guide</h1>';
      for (const lang of LANGS) {
        const index = await env.read(path.join(lang, 'labs.html'));
        expect(block(index, 'LAB-INDEX')).toContain(lang ? 'English lab' : 'Live lab');
        expect(block(index, 'REPAIR-INDEX')).toContain('Live repair');
        expect(block(index, 'REPAIR-INDEX')).toContain('Unclassified repair');
        expect(await env.read(path.join(lang, 'labs/busan.html'))).toContain('Live repair');
        await env.write(path.join(lang, 'labs/guide.html'), authored);
        // Known region filename and a near-template shape are not enough to delete an authored page.
        await env.write(path.join(lang, 'labs/sejong.html'), `<link rel="canonical" href="https://www.5ftmag.com/${lang ? `${lang}/` : ''}labs/sejong.html"><main class="lab-region">${authored}</main>`);
      }
      // Existing regional pages have no ownership marker; exercise their compatibility path.
      const legacy = (await env.read('labs/seoul.html')).replace('<!-- Generated by scripts/build-lab-pages.mjs -->\n', '');
      await env.write('labs/seoul.html', legacy);
      env.responses.labs = { body: [] };
      await successfulRun(env, 'build-labs.mjs');
      await successfulRun(env, 'build-lab-pages.mjs');
      for (const lang of LANGS) {
        await expect(env.read(path.join(lang, 'labs/seoul.html'))).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await env.read(path.join(lang, 'labs/busan.html'))).toContain('Live repair');
        expect(block(await env.read(path.join(lang, 'labs.html')), 'LAB-INDEX')).not.toContain('lab-index-region');
      }
      env.responses.repair_shops = { body: [] };
      await successfulRun(env, 'build-repairs.mjs');
      // Also accept the legacy bare-array representation as an authoritative empty source.
      await env.write('data/repairs.json', '[]\n');
      await successfulRun(env, 'build-lab-pages.mjs');
      const indexes = [];
      for (const lang of LANGS) {
        const index = await env.read(path.join(lang, 'labs.html'));
        indexes.push(index);
        for (const marker of ['LAB-INDEX', 'REPAIR-INDEX']) {
          expect(block(index, marker)).toContain('0');
          expect(block(index, marker)).not.toMatch(/lab-index-region|Live |Unclassified|Saved |STALE/);
        }
        expect(index).toContain('AUTHORED-BEFORE');
        expect(index).toContain('AUTHORED-AFTER');
        expect((await fs.readdir(path.join(env.root, lang, 'labs'))).sort()).toEqual(['guide.html', 'sejong.html']);
        expect(await env.read(path.join(lang, 'labs/guide.html'))).toBe(authored);
        expect(await env.read(path.join(lang, 'labs/sejong.html'))).toContain(authored);
      }
      await successfulRun(env, 'build-lab-pages.mjs');
      for (const [i, lang] of LANGS.entries()) expect(await env.read(path.join(lang, 'labs.html'))).toBe(indexes[i]);
      env.responses.labs = { status: 503 };
      env.responses.repair_shops = { status: 503 };
      await successfulRun(env, 'build-labs.mjs');
      await successfulRun(env, 'build-repairs.mjs');
      await successfulRun(env, 'build-lab-pages.mjs');
      for (const [i, lang] of LANGS.entries()) {
        expect(await env.read(path.join(lang, 'labs.html'))).toBe(indexes[i]);
        expect((await fs.readdir(path.join(env.root, lang, 'labs'))).sort()).toEqual(['guide.html', 'sejong.html']);
      }
    } finally { await env.close(); }
  });

  it('keeps a region when its last lab is hidden but a visible repair shop remains', async () => {
    const env = await sandbox();
    try {
      await env.write('data/labs.json', '[]');
      await env.write('data/repairs.json', JSON.stringify({ repairs: [{ name: 'Only repair', region: SEOUL }] }));
      await successfulRun(env, 'build-lab-pages.mjs');
      for (const lang of LANGS) {
        const page = await env.read(path.join(lang, 'labs/seoul.html'));
        expect(page).toContain('Only repair');
        expect(page).toContain('lab-region-repairs');
        expect(block(await env.read(path.join(lang, 'labs.html')), 'LAB-INDEX')).not.toContain('lab-index-region');
      }
    } finally { await env.close(); }
  });

  it('fails page generation before any output mutation if either snapshot is missing/invalid; never revives a seed', async () => {
    const env = await sandbox();
    try {
      await successfulRun(env, 'build-lab-pages.mjs');
      const outputs = LANGS.flatMap(lang => ['labs.html', 'labs/seoul.html', 'labs/busan.html'].map(file => path.join(lang, file)));
      const before = await Promise.all(outputs.map(env.read));
      for (const builder of BUILDERS) {
        const file = `data/${builder.file}`;
        const good = await env.read(file);
        for (const invalid of [null, '{broken', '{}', JSON.stringify({ [builder.key]: [null] })]) {
          if (invalid === null) await fs.rm(path.join(env.root, file));
          else await env.write(file, invalid);
          const result = await env.run('build-lab-pages.mjs');
          expect(result.code).toBe(1);
          expect(result.stderr).toContain('refusing seed fallback or page cleanup');
          expect(await Promise.all(outputs.map(env.read))).toEqual(before);
          await env.write(file, good);
        }
      }
    } finally { await env.close(); }
  });
});
