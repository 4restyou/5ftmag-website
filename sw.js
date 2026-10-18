// 5ft.mag service worker — PWA 기초.
// 정책:
//   - HTML: network-first (0.8초 타임아웃) + 실패 시 캐시 fallback
//     배포 직후 즉시 새 HTML 받게. stale-while-revalidate 의 "2번 새로고침 후 갱신"
//     UX 결함 해소. 오프라인 시는 캐시로 그대로 동작.
//     3초를 기다리던 때는 느린 회선에서 홈 화면 앱이 2~3초 빈 화면으로 떴다. 늦으면 캐시를 먼저
//     보여 주고, 네트워크 응답은 끝까지 받아 캐시를 갱신한다(다음 실행에 반영).
//     타임아웃이 지나도 캐시가 없으면 오류로 끝내지 않고 네트워크 응답을 끝까지 기다린다.
//   - 정적 자산 (JS/CSS): ?v= 가 붙은 것은 cache-first(내용이 바뀌면 주소가 바뀐다).
//     같은 파일의 옛 버전은 새 버전을 담을 때 지운다. ?v= 가 없는 CSS 는 캐시를 바로 쓰고 뒤에서 갱신한다.
//   - 그 밖(data/*.json 등): 네트워크 우선 + 캐시 fallback (새 글이 늦게 보이지 않게 기다린다)
//   - Pretendard 글꼴(jsdelivr, 버전 고정): cache-first. 화면 그리기를 막는 CSS 라 매번 받지 않는다.
//   - 이미지: 캐시에 담지 않는다 (/img/* 는 HTTP immutable 캐시가 맡는다, 무한 누적 방지)
//   - 캐시 이름을 바꾸면 activate 에서 옛 캐시를 통째로 지운다.
// 푸시 알림 핸들러 포함.

const CACHE = '5ft-v3-20261002';
const HTML_TIMEOUT_MS = 800;
const FONT_PREFIX = '/gh/orioncactus/pretendard@v1.3.9/';
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

// network-first 의 타임아웃 — 3초 안에 안 오면 캐시가 있을 때만 캐시로 답한다.
// 캐시가 없으면 같은 네트워크 요청을 끝까지 기다린다(느린 회선에서 처음 여는 페이지).
function networkFirst(req, ms) {
  const net = fetch(req);
  return new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(async () => {
      const cached = await caches.match(req).catch(() => null);
      if (cached && !settled) { settled = true; resolve(cached); }
    }, ms);
    net.then((res) => {
      clearTimeout(t);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => null);
      }
      if (!settled) { settled = true; resolve(res); }
    }).catch(async (err) => {
      clearTimeout(t);
      if (settled) return;
      settled = true;
      const cached = await caches.match(req).catch(() => null);
      if (cached) resolve(cached); else reject(err);
    });
  });
}

function isImage(url, req) {
  return url.pathname.startsWith('/img/') || req.destination === 'image'
    || /\.(?:png|jpe?g|webp|avif|gif|svg|ico|heic)$/i.test(url.pathname);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith(FONT_PREFIX)) {
    e.respondWith(cacheFirst(req));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // POST/admin/Supabase 등 API 는 캐시 안 함
  if (url.pathname.startsWith('/i/') || url.pathname.includes('/admin/')) return;
  // 이미지는 캐시에 담지 않는다 (브라우저 HTTP 캐시가 처리). 미리 담아 둔 로고만 오프라인용으로 꺼내 쓴다.
  if (isImage(url, req)) {
    if (CORE.includes(url.pathname)) e.respondWith(caches.match(req).then((c) => c || fetch(req)));
    return;
  }

  const isHtml = req.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('.html') || url.pathname === '/';

  if (isHtml) {
    // network-first — 새 배포는 즉시 반영, 느리거나 끊겼을 때만 캐시.
    e.respondWith(networkFirst(req, HTML_TIMEOUT_MS));
    return;
  }

  // 버전이 붙은 정적 자산은 캐시 먼저
  if (url.searchParams.has('v')) {
    e.respondWith(cacheFirst(req, true));
    return;
  }
  // 버전 없는 CSS(pretendard.css 등)는 화면 그리기를 막으므로 캐시를 바로 쓰고 뒤에서 갱신한다
  if (url.pathname.endsWith('.css')) {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 기타(data/*.json 등): 네트워크 우선 + 캐시 fallback
  e.respondWith(
    fetch(req).then((res) => {
      const type = res && res.headers.get('content-type') || '';
      if (res && res.ok && !type.startsWith('image/')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => null);
      }
      return res;
    }).catch(async (err) => {
      const cached = await caches.match(req);
      if (cached) return cached;
      throw err;
    })
  );
});

// 캐시가 있으면 바로 쓰고, 네트워크로 받은 새 내용은 다음 번을 위해 담아 둔다.
async function staleWhileRevalidate(req) {
  const cached = await caches.match(req).catch(() => null);
  const net = fetch(req).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => null);
    }
    return res;
  });
  if (cached) { net.catch(() => null); return cached; }
  return net;
}

// 캐시에 있으면 바로, 없으면 받아서 담는다. dropOld: 같은 경로의 다른 ?v= 항목을 지운다.
async function cacheFirst(req, dropOld = false) {
  const cached = await caches.match(req).catch(() => null);
  if (cached) return cached;
  const res = await fetch(req);
  // 글꼴 CSS 는 @import(no-cors)라 opaque 응답으로 온다. 그것도 담는다.
  if (res && (res.ok || res.type === 'opaque')) {
    const copy = res.clone();
    caches.open(CACHE).then(async (c) => {
      if (dropOld) {
        const path = new URL(req.url).pathname;
        const keys = await c.keys();
        await Promise.all(keys.filter((k) => k.url !== req.url && new URL(k.url).pathname === path).map((k) => c.delete(k)));
      }
      await c.put(req, copy);
    }).catch(() => null);
  }
  return res;
}

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
  const link = normalizeNotificationLink(data.link);
  const options = {
    body: data.body || '',
    icon: '/img/favicon/icon-180.png',
    badge: '/img/favicon/icon-32.png',
    tag: link,
    data: { link },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

function normalizeNotificationLink(value) {
  try {
    const url = new URL(String(value || '/'), self.location.origin);
    if (url.origin !== self.location.origin) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (_) {
    return '/';
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = normalizeNotificationLink(event.notification.data?.link);
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
