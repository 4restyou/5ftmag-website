import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = resolve('.');
const PORT = Number(process.env.QA_VISUAL_PORT || 4173);
const DEBUG_PORT = Number(process.env.QA_CHROME_DEBUG_PORT || 9333);
const OUT_DIR = join(tmpdir(), '5ft-visual-qa');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const TARGETS = [
  { name: 'home-desktop', path: '/index.html', width: 1440, height: 1200 },
  { name: 'home-mobile', path: '/index.html', width: 390, height: 1200 },
  { name: 'films-desktop', path: '/films.html', width: 1440, height: 1200 },
  { name: 'films-mobile', path: '/films.html', width: 390, height: 1200 },
  { name: 'stories-desktop', path: '/stories.html', width: 1440, height: 1200 },
  { name: 'stories-mobile', path: '/stories.html', width: 390, height: 1200 },
  { name: 'lomo-article-desktop', path: '/stories/lomo-mca.html', width: 1552, height: 900 },
  { name: 'lomo-article-mobile', path: '/stories/lomo-mca.html', width: 390, height: 1200 },
  { name: 'china-article-desktop', path: '/stories/ch-revival.html', width: 1552, height: 900 },
  { name: 'china-article-mobile', path: '/stories/ch-revival.html', width: 390, height: 1200 },
  { name: 'market-desktop', path: '/market.html', width: 1440, height: 1200 },
  { name: 'market-mobile', path: '/market.html', width: 390, height: 1200 },
];

function chromePath() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find(p => existsSync(p));
}

function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    const rawPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = resolve(join(ROOT, rawPath));
    if (!file.startsWith(ROOT) || !existsSync(file)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolveServer(server));
  });
}

async function waitForJson(endpoint, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      return await fetch(endpoint).then(r => r.json());
    } catch (_) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  throw new Error(`Chrome DevTools endpoint not ready: ${endpoint}`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolveMsg, rejectMsg } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rejectMsg(new Error(msg.error.message)) : resolveMsg(msg.result);
  });
  return new Promise(resolveWs => {
    ws.addEventListener('open', () => {
      resolveWs({
        send(method, params = {}) {
          const id = ++seq;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveMsg, rejectMsg) => pending.set(id, { resolveMsg, rejectMsg }));
        },
        close() { ws.close(); },
      });
    }, { once: true });
  });
}

async function waitForLoad(client) {
  await client.send('Runtime.evaluate', {
    expression: `document.readyState === 'complete' ? true : new Promise(resolve => window.addEventListener('load', () => resolve(true), { once: true }))`,
    awaitPromise: true,
  });
  await new Promise(r => setTimeout(r, 450));
}

async function runTarget(client, target) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: target.width,
    height: target.height,
    deviceScaleFactor: 1,
    mobile: target.width <= 600,
  });
  await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${target.path}` });
  await waitForLoad(client);

  const { result } = await client.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const root = document.documentElement;
      const vw = root.clientWidth;
      const sw = root.scrollWidth;
      const brokenImages = [...document.images]
        .filter(img => (img.getAttribute('src') || img.getAttribute('srcset')) && img.complete && img.naturalWidth === 0)
        .map(img => img.currentSrc || img.src)
        .slice(0, 10);
      return {
        viewport: vw,
        scrollWidth: sw,
        title: document.title,
        brokenImages,
      };
    })()`,
  });

  const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = join(OUT_DIR, `${target.name}.png`);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));

  const value = result.value;
  const problems = [];
  if (value.scrollWidth > value.viewport + 1) {
    problems.push(`horizontal overflow ${value.scrollWidth}px > ${value.viewport}px`);
  }
  if (value.brokenImages.length) {
    problems.push(`broken images: ${value.brokenImages.join(', ')}`);
  }
  return { ...target, screenshot: file, ...value, problems };
}

mkdirSync(OUT_DIR, { recursive: true });
const chrome = chromePath();
if (!chrome) {
  console.warn('Chrome not found; visual QA skipped.');
  process.exit(0);
}

let server;
let proc;
try {
  server = await startServer();
  const userDataDir = join(tmpdir(), `5ft-chrome-${Date.now()}`);
  proc = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: 'ignore' });

  const tabs = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json`);
  const page = tabs.find(t => t.type === 'page') || tabs[0];
  const client = await connect(page.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  const results = [];
  for (const target of TARGETS) {
    results.push(await runTarget(client, target));
  }
  client.close();

  let failed = false;
  console.log('\nVisual QA');
  for (const r of results) {
    const status = r.problems.length ? '✗' : '✓';
    console.log(`  ${status} ${r.name} ${r.viewport}px screenshot=${r.screenshot}`);
    for (const p of r.problems) console.log(`    - ${p}`);
    failed ||= r.problems.length > 0;
  }
  if (failed) process.exit(1);
} finally {
  if (proc) proc.kill();
  if (server) server.close();
}
