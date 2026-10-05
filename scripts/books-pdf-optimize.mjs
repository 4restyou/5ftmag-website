// Read-only by default. Preparation and publication are separate, explicit steps.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const project = 'pucpqsfwqouqohwsvmnd';
const base = `https://${project}.supabase.co`;
const args = process.argv.slice(2);
const mode = args[0] || '--audit';
if (!['--audit', '--prepare', '--publish'].includes(mode)) throw new Error('Use --audit, --prepare DIRECTORY, or --publish DIRECTORY');
const dir = resolve(args[1] || '/tmp/5ft-books-pdf-audit');
const only = args[2];
const python = process.env.PDF_QA_PYTHON || 'python3';
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', project, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const key = keys.find(k => k.name === 'service_role')?.api_key;
if (!key || key.startsWith('sb_')) throw new Error('Authenticated operations key unavailable');
const auth = { apikey: key, Authorization: `Bearer ${key}` };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const objectURL = (bucket, path) => `${base}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
async function request(url, options = {}) {
  const r = await fetch(url, { ...options, headers: { ...auth, ...options.headers }, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`Request failed (${r.status})`);
  return r;
}
async function bytesAt(bucket, path) {
  const url = objectURL(bucket, path) + '?verify=' + Date.now();
  return Buffer.from(await (await request(url, { headers: { 'Cache-Control': 'no-cache' } })).arrayBuffer());
}
async function catalog() {
  const rows = await (await request(`${base}/rest/v1/webzine_issues?published=eq.true&select=slug,pdf_path`)).json();
  const products = await (await request(`${base}/rest/v1/ebook_products?published=eq.true&select=slug,pages_path`)).json();
  const files = rows.filter(r => r.pdf_path).map(r => ({ slug: r.slug, bucket: 'webzine', path: r.pdf_path }));
  for (const p of products) for (const name of ['full.pdf', 'preview.pdf']) files.push({ slug: p.slug, bucket: 'ebook-pages', path: `${(p.pages_path || p.slug).replace(/\/+$/, '')}/${name}` });
  for (const f of files) if (!/^[a-z0-9-]+$/.test(f.slug) || f.path.includes('..') || !/^[a-zA-Z0-9_/.-]+\.pdf$/.test(f.path)) throw new Error('Unexpected catalog path');
  return files.filter(f => !only || f.slug === only);
}
await mkdir(dir, { recursive: true, mode: 0o700 });
const manifestPath = join(dir, 'manifest.json');
const writeManifest = records => writeFile(manifestPath, JSON.stringify({ project, updated: new Date().toISOString(), records }, null, 2), { mode: 0o600 });

if (mode === '--publish') {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.project !== project) throw new Error('Wrong project');
  const live = await catalog();
  for (const f of manifest.records.filter(f => !only || f.slug === only)) {
    if (!live.some(x => x.bucket === f.bucket && x.path === f.path)) throw new Error('Catalog changed; stop');
    const optimized = await readFile(f.optimized);
    if (!f.qa?.identical || !f.qa?.pages || hash(optimized) !== f.optimizedHash || optimized.length > f.originalBytes * 1.02) throw new Error('File not approved');
    if (f.linearized && optimized.length > f.originalBytes * 0.99) {
      f.state = 'kept-original'; await writeManifest(manifest.records);
      console.log(`${f.slug}/${f.path.split('/').at(-1)} kept original: already linearized, saving below 1%`); continue;
    }
    const timing = f.benchmark;
    if (!timing || timing.samples < 3 || timing.originalHash !== f.originalHash || timing.optimizedHash !== f.optimizedHash || !(timing.originalMs > 0) || !(timing.optimizedMs > 0)) throw new Error('First-page benchmark required before publication');
    if (timing.optimizedMs > timing.originalMs * 1.05) {
      f.state = 'kept-original-performance'; await writeManifest(manifest.records);
      console.log(`${f.slug}/${f.path.split('/').at(-1)} kept original: first-page preparation regressed`); continue;
    }
    const current = await bytesAt(f.bucket, f.path);
    if (hash(current) === f.optimizedHash) {
      if (!f.backup || hash(await bytesAt(f.bucket, f.backup)) !== f.originalHash) throw new Error('Existing optimized object has no verified backup');
      f.state = 'published-verified'; await writeManifest(manifest.records);
      console.log(`${f.slug}/${f.path.split('/').at(-1)} already optimized; backup verified`); continue;
    }
    if (hash(current) !== f.originalHash) throw new Error('Original changed; do not overwrite');
    f.backup = f.path.replace(/\.pdf$/, `-original-${f.originalHash.slice(0, 12)}.pdf`);
    await writeManifest(manifest.records);
    const backupURL = objectURL(f.bucket, f.backup);
    const exists = await fetch(backupURL, { method: 'HEAD', headers: auth });
    if (!exists.ok) {
      if (![400, 404].includes(exists.status)) throw new Error('Backup check failed');
      await request(backupURL, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false', 'Cache-Control': 'no-cache' }, body: current });
    }
    if (hash(await bytesAt(f.bucket, f.backup)) !== f.originalHash) throw new Error('Backup verification failed');
    f.state = 'backup-verified'; await writeManifest(manifest.records);
    await request(objectURL(f.bucket, f.path), { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'true', 'Cache-Control': 'no-cache' }, body: optimized });
    if (hash(await bytesAt(f.bucket, f.path)) !== f.optimizedHash) throw new Error('Uploaded file verification failed; restore the verified backup');
    const range = await request(objectURL(f.bucket, f.path), { headers: { Range: 'bytes=0-1023' } });
    if (range.status !== 206 || !(await range.text()).includes('/Linearized')) throw new Error('Uploaded file not range-ready');
    f.state = 'published-verified'; await writeManifest(manifest.records);
    console.log(`${f.slug}/${f.path.split('/').at(-1)} published; ${f.qa.pages} pages identical; backup verified`);
  }
} else {
  const records = [];
  for (const f of await catalog()) {
    const started = performance.now();
    const response = await request(objectURL(f.bucket, f.path), { headers: { Range: 'bytes=0-1023' } });
    const header = Buffer.from(await response.arrayBuffer());
    f.rangeSupported = response.status === 206;
    f.linearized = header.includes('/Linearized');
    f.rangeMs = Math.round(performance.now() - started);
    f.originalBytes = Number((response.headers.get('content-range') || '').split('/')[1] || response.headers.get('content-length'));
    f.corsExposed = response.headers.get('access-control-expose-headers');
    if (mode === '--prepare') {
      const fileDir = join(dir, `${f.bucket}-${f.slug}-${f.path.split('/').at(-1).replace('.pdf', '')}`);
      await mkdir(fileDir, { recursive: true, mode: 0o700 });
      f.original = join(fileDir, 'original.pdf'); f.optimized = join(fileDir, 'reading.pdf');
      const original = await bytesAt(f.bucket, f.path);
      f.originalBytes = original.length; f.originalHash = hash(original);
      await writeFile(f.original, original, { mode: 0o600 });
      execFileSync('qpdf', ['--linearize', '--object-streams=generate', '--recompress-flate', '--compression-level=9', f.original, f.optimized], { stdio: ['ignore', 'pipe', 'pipe'] });
      execFileSync('qpdf', ['--check', f.optimized], { stdio: ['ignore', 'pipe', 'pipe'] });
      execFileSync('qpdf', ['--check-linearization', f.optimized], { stdio: ['ignore', 'pipe', 'pipe'] });
      f.qa = JSON.parse(execFileSync(python, ['scripts/verify-pdf-render.py', f.original, f.optimized, fileDir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 }));
      const optimized = await readFile(f.optimized);
      f.optimizedBytes = optimized.length; f.optimizedHash = hash(optimized);
      f.state = 'prepared';
    }
    records.push(f); await writeManifest(records);
    console.log(`${f.slug}/${f.path.split('/').at(-1)} ${(f.originalBytes / 1048576).toFixed(1)} MB; range=${f.rangeSupported}; linearized=${f.linearized}${f.qa ? `; ${f.qa.pages} pages identical; output=${(f.optimizedBytes / 1048576).toFixed(1)} MB` : ''}`);
  }
}
