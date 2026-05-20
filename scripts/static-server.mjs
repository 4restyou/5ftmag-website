// Playwright webServer 용 정적 파일 서버 — 외부 의존 없는 최소 구현
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve('.');
const PORT = Number(process.argv[2] || 4399);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  let p = decodeURIComponent(url.pathname);
  p = p.replace(/^\/(film|camera|contributor|market|stories|authors|legal)\/(css|js|img|data)\//, '/$2/');
  p = p.replace(/^\/(film|camera|contributor|market|stories|authors|legal)\/pretendard\.css$/, '/pretendard.css');
  if (/^\/film\/[^/]+$/.test(p) || /^\/camera\/[^/]+$/.test(p) || /^\/contributor\/[^/]+$/.test(p)) {
    p = '/films.html';
  } else if (/^\/market\/[^/]+$/.test(p)) {
    p = '/market.html';
  } else if (/^\/stories\/[^/.]+$/.test(p)) {
    p = `${p}.html`;
  } else if (/^\/authors\/[^/.]+$/.test(p)) {
    p = `${p}.html`;
  } else if (p === '/films') {
    p = '/films.html';
  } else if (p === '/stories') {
    p = '/stories.html';
  } else if (p === '/market') {
    p = '/market.html';
  } else if (p === '/about') {
    p = '/about.html';
  } else if (p === '/me') {
    p = '/me.html';
  }
  if (p === '/' || p.endsWith('/')) p = (p + 'index.html').replace('//', '/');
  const file = resolve(join(ROOT, p));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404); res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`static-server on http://127.0.0.1:${PORT}`));
