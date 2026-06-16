// 5ft.mag service worker — PWA 기초.
// 정책:
//   - HTML: network-first (3초 타임아웃) + 실패 시 캐시 fallback
//     배포 직후 즉시 새 HTML 받게. stale-while-revalidate 의 "2번 새로고침 후 갱신"
//     UX 결함 해소. 오프라인 시는 캐시로 그대로 동작.
//   - 정적 자산 (JS/CSS/이미지): 네트워크 우선 + 캐시 fallback (캐시 키로 버스트됨)
// 푸시 알림 핸들러 포함.

const CACHE = '5ft-v2-network-first';
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

// network-first 의 타임아웃 — 느린 네트워크라도 3초 안에 안 오면 캐시 fallback.
function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('sw timeout')), ms);
    fetch(req).then(res => { clearTimeout(t); resolve(res); })
              .catch(err => { clearTimeout(t); reject(err); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // POST/admin/Supabase 등 API 는 캐시 안 함
  if (url.pathname.startsWith('/i/') || url.pathname.includes('/admin/')) return;

  const isHtml = req.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('.html') || url.pathname === '/';

  if (isHtml) {
    // network-first — 새 배포는 즉시 반영, 네트워크 끊겼을 때만 캐시.
    e.respondWith((async () => {
      try {
        const res = await fetchWithTimeout(req, 3000);
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => null);
        }
        return res;
      } catch (_) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw new Error('network failed and no cache');
      }
    })());
    return;
  }

  // 기타 정적: 네트워크 우선 + 캐시 fallback
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

// ════════════════════════════════════════════════════════════
// Web Push — send-push edge function 이 보낸 페이로드를 OS 알림으로.
// payload 구조: { title, body, link, tag }  (모두 옵션)
// ════════════════════════════════════════════════════════════
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: '5ft magazine', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || '5ft magazine';
  const options = {
    body: data.body || '',
    icon: '/img/favicon/icon-180.png',
    badge: '/img/favicon/icon-32.png',
    tag: data.tag || undefined,
    data: { link: data.link || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // 이미 열린 같은 origin 탭이 있으면 focus + 해당 페이지로 이동
    for (const c of allClients) {
      if (c.url.startsWith(self.location.origin)) {
        await c.focus();
        try { c.navigate(link); } catch (_) {}
        return;
      }
    }
    // 없으면 새 창
    if (self.clients.openWindow) await self.clients.openWindow(link);
  })());
});

// 브라우저가 구독을 강제로 회수했을 때 (Chromium pushsubscriptionchange).
// 새 구독을 만들어 endpoint 를 서버에 다시 등록해야 알림이 계속 도착한다.
// 이 핸들러는 SW 컨텍스트라 fetch 로 직접 등록만 시도하고, 실패 시 다음 사이트 방문 시
// 클라이언트가 보강한다.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const sub = event.newSubscription || await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
      });
      // 같은 origin client 에게 알려서 DB 갱신을 부탁
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of allClients) c.postMessage({ type: 'push-resubscribed', endpoint: sub.endpoint });
    } catch (_) { /* 다음 방문 때 보강 */ }
  })());
});
