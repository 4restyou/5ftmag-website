import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

// Opt-in benchmark against a verified, local copy. No credentials or paid PDFs enter CI.
test('real book first-page preparation and range fallback', async ({ browser }, testInfo) => {
  test.skip(!process.env.BOOK_PDF_BENCH_DIR || testInfo.project.name !== 'chromium-desktop', 'Local PDF benchmark only');
  test.setTimeout(600000);
  const manifest = JSON.parse(readFileSync(join(process.env.BOOK_PDF_BENCH_DIR, 'manifest.json'), 'utf8'));
  const candidates = process.env.BOOK_PDF_CANDIDATES === '1';
  const files = candidates ? manifest.records.filter(f => !f.linearized || f.optimizedBytes <= f.originalBytes * 0.99) : [manifest.records[0]];
  let sources;
  const results = [];
  let sent = 0, requests = 0, ranged = 0;
  const server = createServer((req, res) => {
    if (req.url === '/benchmark.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<link rel="stylesheet" href="/css/webzine.css"><script src="/js/i18n.js"></script><script src="/js/util.js"></script><script src="/js/webzine-reader.js"></script>'); return;
    }
    if (['/css/webzine.css', '/js/i18n.js', '/js/util.js', '/js/webzine-reader.js'].includes(req.url)) {
      res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
      res.end(readFileSync('.' + req.url)); return;
    }
    if (!req.url.endsWith('.pdf')) { res.statusCode = 404; res.end(); return; }
    const name = req.url.includes('original') ? 'original' : 'optimized';
    const body = sources[name];
    const noRange = req.url.includes('no-range');
    const match = !noRange && /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
    const start = match ? Number(match[1]) : 0;
    const end = match ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
    requests++; if (match) ranged++;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges,Content-Length,Content-Range');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', end - start + 1);
    if (!noRange) res.setHeader('Accept-Ranges', 'bytes');
    if (match) { res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`); }
    let pos = start, interval;
    // Same 60 ms latency and ~8 MB/s transfer for every scenario; not a production speed claim.
    const begin = setTimeout(() => {
      res.flushHeaders();
      interval = setInterval(() => {
        if (res.destroyed) { clearInterval(interval); return; }
        const chunk = body.subarray(pos, Math.min(pos + 32768, end + 1));
        sent += chunk.length; res.write(chunk); pos += chunk.length;
        if (pos > end) { clearInterval(interval); res.end(); }
      }, 4);
    }, 60);
    res.on('close', () => { clearTimeout(begin); clearInterval(interval); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    for (const file of files) {
      sources = { original: readFileSync(file.original), optimized: readFileSync(file.optimized) };
      const scenarios = candidates ? ['baseline-original', 'stream-optimized', 'baseline-original', 'stream-optimized', 'baseline-original', 'stream-optimized'] : ['baseline-original', 'stream-optimized', 'range-original', 'range-optimized', 'no-range-optimized'];
      for (const scenario of scenarios) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      page.on('pageerror', e => console.log('benchmark page error:', e.message));
      page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') console.log('benchmark:', msg.text()); });
      if (scenario.startsWith('range')) await page.route('**/js/webzine-reader.js', route => route.fulfill({ contentType: 'text/javascript', body: readFileSync('js/webzine-reader.js', 'utf8').replace('        url,', '        url, disableStream: true, disableAutoFetch: true, rangeChunkSize: 262144,') }));
      await page.goto(`http://127.0.0.1:${port}/benchmark.html`);
      // Warm only the libraries, measuring document preparation separately.
      await page.evaluate(() => window.WebzineReader.prepare());
      console.log(`${scenario}: libraries ready`);
      sent = 0; requests = 0; ranged = 0;
      const url = `http://127.0.0.1:${port}/${scenario}.pdf`;
      const metrics = await page.evaluate(async url => {
        let result;
        await window.WebzineReader.open(url, 'Benchmark', { onMetrics: m => { result = m; } });
        return result;
      }, url);
      expect(metrics.pages).toBe(file.qa.pages);
      await expect(page.locator('.wz-reader canvas').first()).toBeVisible();
      expect(await page.locator('.wz-reader canvas').first().evaluate(c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 !== 3 && v !== 255 && v !== 0))).toBe(true);
      results.push({ slug: file.slug, path: file.path, scenario, ...metrics, bytesSentAtReady: sent, requests, rangeRequests: ranged });
      console.log(`${file.slug}/${file.path.split('/').at(-1)} ${scenario}: ready in ${metrics.total_ms} ms, ${sent} bytes`);
      if (!candidates) await page.screenshot({ path: testInfo.outputPath(`${scenario}.png`) });
      await context.close();
      }
      if (candidates) {
        const median = scenario => { const samples = results.filter(r => r.slug === file.slug && r.path === file.path && r.scenario === scenario).map(r => r.total_ms).sort((a, b) => a - b); return samples[Math.floor(samples.length / 2)]; };
        file.benchmark = { originalMs: median('baseline-original'), optimizedMs: median('stream-optimized'), samples: 3, originalHash: file.originalHash, optimizedHash: file.optimizedHash };
        writeFileSync(join(process.env.BOOK_PDF_BENCH_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
      }
    }
    console.log(JSON.stringify(results, null, 2));
    writeFileSync(join(process.env.BOOK_PDF_BENCH_DIR, 'benchmark.json'), JSON.stringify({ conditions: '60ms latency, 32KiB per 4ms; warm libraries; fresh browser contexts', results }, null, 2));
    if (!candidates) {
      expect(results.find(r => r.scenario === 'range-optimized').rangeRequests).toBeGreaterThan(0);
      expect(results.find(r => r.scenario === 'no-range-optimized').rangeRequests).toBe(0);
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
