// 5ft.mag PWA 등록·모바일 업로드 FAB
(function () {
  'use strict';
  // ── PWA service worker 등록 ──
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    // /sw.js (사이트 루트) — 스코프가 / 라야 ready 가 모든 페이지에서 resolve.
    // /js/sw.js 에 두면 스코프가 /js/ 로 잡혀 push.subscribe() 가 영원 대기.
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err => console.warn('[sw]', err.message));
    // 옛 /js/sw.js 등록이 남아있으면 정리.
    navigator.serviceWorker.getRegistrations?.().then(regs => {
      regs.forEach(r => {
        if (r.active?.scriptURL?.endsWith('/js/sw.js')) r.unregister().catch(() => {});
      });
    }).catch(() => {});
  }

  const FORCE_DESKTOP_KEY = '5ft-force-desktop';
  function isForceDesktop() {
    try { return localStorage.getItem(FORCE_DESKTOP_KEY) === '1'; } catch { return false; }
  }
  function setForceDesktop(on) {
    try {
      if (on) localStorage.setItem(FORCE_DESKTOP_KEY, '1');
      else localStorage.removeItem(FORCE_DESKTOP_KEY);
    } catch {}
    // viewport 변경 — PC 화면 시뮬레이션은 viewport scale 만으로는 한계가 있으나
    // 모바일 분기 (window.MagMobile) 가 이 플래그 보고 모바일 홈 렌더 안 함.
    document.documentElement.classList.toggle('force-desktop', on);
    if (on) {
      // 1100 정도면 데스크탑 레이아웃 거의 다 발동
      const meta = document.querySelector('meta[name=viewport]');
      if (meta) meta.setAttribute('content', 'width=1100');
    } else {
      const meta = document.querySelector('meta[name=viewport]');
      if (meta) meta.setAttribute('content', 'width=device-width, initial-scale=1.0');
    }
  }
  // 'PC 화면으로 보기' 기능 제거 — 이전에 켜둔 사용자는 다음 로드 때 모바일로 복귀.
  if (isForceDesktop()) setForceDesktop(false);

  // PWA standalone (홈 화면 추가 후) 감지 — 앱 모드에선 chrome 단순화.
  function isStandalonePwa() {
    try {
      return window.navigator.standalone === true
        || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    } catch { return false; }
  }
  if (isStandalonePwa()) {
    document.documentElement.classList.add('is-standalone-pwa');
  }

  // 모바일 사진 올리기 FAB — films·me·홈에서만 노출.
  // data-action="open-submission" 클릭 위임은 reader-submissions.js 가 이미 처리.
  // 로그인 안 한 사용자도 일단 모달 트리거 → 모달 내부에서 로그인 분기.
  function shouldShowUploadFab() {
    if (isForceDesktop()) return false;
    if (!window.matchMedia || !window.matchMedia('(max-width: 640px)').matches) return false;
    const path = location.pathname;
    // 모바일 홈(/) + films.html — 두 곳 모두에서 노출.
    // 홈은 PR #485 단순화 이후 Articles / Photo 섹션을 숨겨서 readers-cta 의 "내 사진 올리기"
    // 가 한참 아래에 있다. 모바일에서 빠른 접근을 위해 FAB 유지.
    if (path === '/' || path === '/index.html') return true;
    if (/^\/films\.html$/.test(path)) return true;
    return false;
  }

  function injectUploadFab() {
    if (!shouldShowUploadFab()) return;
    if (document.getElementById('mhUploadFab')) return;
    const fab = document.createElement('button');
    fab.id = 'mhUploadFab';
    fab.type = 'button';
    fab.dataset.action = 'open-submission';
    fab.setAttribute('aria-label', '사진 올리기');
    fab.style.cssText = [
      'position:fixed', 'right:20px', 'bottom:calc(32px + env(safe-area-inset-bottom, 0px))',
      'z-index:900',
      'width:60px', 'height:60px', 'border-radius:50%',
      'border:none', 'background:#ffd400', 'color:#111', 'cursor:pointer',
      'display:flex', 'align-items:center', 'justify-content:center',
      'box-shadow:0 8px 24px rgba(0,0,0,0.3), 0 2px 6px rgba(0,0,0,0.15)',
      'transition:transform .15s, opacity .15s',
    ].join(';');
    fab.innerHTML = `
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/>
        <circle cx="12" cy="13" r="4"/>
        <circle cx="18" cy="9" r="0.6" fill="currentColor" stroke="none"/>
      </svg>
    `;
    fab.addEventListener('mouseenter', () => { fab.style.transform = 'scale(1.05)'; });
    fab.addEventListener('mouseleave', () => { fab.style.transform = 'scale(1)'; });
    fab.addEventListener('click', () => { try { window.trackEvent?.('fab_clicked', { kind: 'upload' }); } catch (_) {} });
    document.body.appendChild(fab);
  }

  window.MagPwa = {
    isForceDesktop,
    setForceDesktop,
    FORCE_DESKTOP_KEY,
  };

  function bootPwa() {
    registerServiceWorker();
    injectUploadFab();
  }


  function boot() { registerServiceWorker(); injectUploadFab(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
