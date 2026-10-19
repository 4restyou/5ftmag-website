// 5ft.mag — 방문 분석(Plausible) 부트스트랩
//   Sentry 오류 수집은 DSN 이 비어 쓰지 않아 2026-10 에 뺐다(오류는 자체 client_error_logs 로 모은다).
//
// 적용 방법:
//   1. Plausible: plausible.io 가입 → 도메인 등록 → 아래 PLAUSIBLE_DOMAIN 채우기
//
// 보안 메모:
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

  // ─── 2) 운영 진단용 헬퍼 — 어디서든 호출 가능 ───
  window.trackEvent = function (name, props) {
    try {
      if (window.plausible) window.plausible(name, { props });
    } catch (_) {}
  };
  window.reportError = function (err, ctx) {
    console.error('[5ft]', err, ctx || '');
  };
})();
