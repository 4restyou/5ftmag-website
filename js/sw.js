// 5ft.mag service worker — PWA 기초.
// 정책: 네트워크 우선, 실패 시 캐시 (HTML 은 stale-while-revalidate).
// 푸시 알림 핸들러는 후속 PR 에서 추가.

const CACHE = '5ft-v1';
const CORE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/pretendard.css',
  '/css/tokens.css',
  '/css/common.css',
  '/img/symbol-b.svg',
  '/img/symbol-w.svg',
  '/img/favicon/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => null)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// 정적 자산은 네트워크 우선, HTML 은 stale-while-revalidate, 외부는 패스.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // POST/admin/Supabase 등 API 는 캐시 안 함
  if (url.pathname.startsWith('/i/') || url.pathname.includes('/admin/')) return;

  const isHtml = req.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('.html') || url.pathname === '/';

  if (isHtml) {
    // stale-while-revalidate
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const cached = await c.match(req);
        const fetchPromise = fetch(req).then((res) => {
          if (res && res.ok) c.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // 기타 정적: 네트워크 우선
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => null);
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
