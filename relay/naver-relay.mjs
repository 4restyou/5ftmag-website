#!/usr/bin/env node
// 5ft.mag — 네이버 커머스 API 고정 IP 중계 서버.
//
// 왜 필요한가: 커머스 API 는 등록된 IP 에서만 호출을 허용하는데,
// Supabase 엣지 함수는 고정 IP 가 없다. 이 서버가 고정 IP VPS 에서 돌며
// 엣지 함수(ebook-redeem)의 요청을 api.commerce.naver.com 으로만 전달한다.
//
// 보안:
//   - X-Relay-Key 공유 시크릿이 맞아야만 처리 (불일치 403)
//   - 전달 대상은 api.commerce.naver.com 하나로 고정 (열린 프록시 아님)
//   - TLS 는 앞단 Caddy(reverse_proxy)가 처리
//
// 실행: RELAY_KEY=시크릿 node naver-relay.mjs   (기본 포트 8787)
// 헬스체크: GET /healthz → ok

import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const KEY = process.env.RELAY_KEY || '';
const UPSTREAM = 'https://api.commerce.naver.com';

if (!KEY) {
  console.error('RELAY_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (req.method !== 'POST' || req.url !== '/forward') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  if (req.headers['x-relay-key'] !== KEY) {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'forbidden' }));
    return;
  }

  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch { payload = null; }
  const path = String(payload?.path || '');
  const method = String(payload?.method || 'GET').toUpperCase();
  if (!path.startsWith('/') || !['GET', 'POST'].includes(method)) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad request' }));
    return;
  }

  const headers = {};
  if (payload.contentType) headers['content-type'] = String(payload.contentType);
  if (payload.authorization) headers['authorization'] = String(payload.authorization);

  try {
    const upstream = await fetch(UPSTREAM + path, {
      method,
      headers,
      body: method === 'POST' ? String(payload.body ?? '') : undefined,
    });
    const text = await upstream.text();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: upstream.status, body: text }));
  } catch (e) {
    console.error('[relay] upstream error:', e.message);
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream failed' }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`naver-relay listening on 127.0.0.1:${PORT}`);
});
