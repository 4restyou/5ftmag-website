// 5ft.mag — 분석 + 에러 모니터링 부트스트랩
//   현재는 placeholder. 운영자가 외부 서비스에 가입한 후 아래 자리를 채우면 활성화.
//
// 적용 방법:
//   1. Plausible: plausible.io 가입 → 도메인 등록 → 아래 PLAUSIBLE_DOMAIN 채우기
//   2. Sentry: sentry.io 가입 → Project 생성 → DSN 받아 SENTRY_DSN 채우기
//
// 보안 메모:
//   Sentry DSN 은 공개돼도 되는 token 이라 클라이언트에 둬도 안전.
//   Plausible 은 광고·트래킹 쿠키 없음 — 개인정보처리방침에 명시한 그대로.

(function () {
  'use strict';

  // ─── 1) Plausible (서버 보유 데이터 X · 쿠키 X · 개인정보 X) ───
  const PLAUSIBLE_DOMAIN = '5ftmag.com';  // plausible.io 에 이 도메인 등록 필요
  if (PLAUSIBLE_DOMAIN) {
    const s = document.createElement('script');
    s.defer = true;
    s.setAttribute('data-domain', PLAUSIBLE_DOMAIN);
    s.src = 'https://plausible.io/js/script.js';
    document.head.appendChild(s);
  }

  // ─── 2) Sentry (JS 에러 + 성능 모니터링) ───
  const SENTRY_DSN = '';  // ← 예: 'https://abc123@oXXX.ingest.sentry.io/YYY'
  const SENTRY_ENV = location.hostname === 'www.5ftmag.com' ? 'production' : 'preview';
  if (SENTRY_DSN) {
    const loader = document.createElement('script');
    loader.async = true;
    // Sentry Loader Script — DSN 만 채우면 자동으로 SDK 받아 init
    loader.src = `https://js.sentry-cdn.com/${encodeURIComponent(SENTRY_DSN.split('@')[0].split('//')[1] || '')}.min.js`;
    loader.crossOrigin = 'anonymous';
    document.head.appendChild(loader);
    // 글로벌 에러 catch — Sentry SDK 가 로드되면 자동 캡처
    window.addEventListener('error', (e) => {
      if (window.Sentry?.captureException && e.error) window.Sentry.captureException(e.error);
    });
    window.addEventListener('unhandledrejection', (e) => {
      if (window.Sentry?.captureException && e.reason) window.Sentry.captureException(e.reason);
    });
    // 환경 태그 — 로드 후 init 끝나면 setContext
    window.sentryOnLoad = function () {
      try {
        window.Sentry.init({
          dsn: SENTRY_DSN,
          environment: SENTRY_ENV,
          tracesSampleRate: 0.1,
          // 일반 OAuth 콜백 노이즈 무시
          ignoreErrors: ['ResizeObserver loop limit exceeded'],
        });
      } catch (_) {}
    };
  }

  // ─── 3) 운영 진단용 헬퍼 — 어디서든 호출 가능 ───
  window.trackEvent = function (name, props) {
    try {
      if (window.plausible) window.plausible(name, { props });
    } catch (_) {}
  };
  window.reportError = function (err, ctx) {
    try {
      if (window.Sentry?.captureException) {
        if (ctx) window.Sentry.setContext('5ft', ctx);
        window.Sentry.captureException(err);
      }
    } catch (_) {}
    console.error('[5ft]', err, ctx || '');
  };
})();
