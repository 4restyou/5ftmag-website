// 5ft.mag 익명 페이지뷰·이벤트·클라이언트 오류 수집
(function () {
  'use strict';
  // ════════════════════════════════════════════════
  // 페이지뷰 로그 (Supabase 자가호스트 분석)
  //   anon INSERT 만 허용된 page_views 테이블에 한 줄 기록.
  //   집계는 admin/analytics.html 에서 SECURITY DEFINER RPC 로 열람.
  // ════════════════════════════════════════════════
  const PV_URL = 'https://pucpqsfwqouqohwsvmnd.supabase.co';
  const PV_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1Y3Bxc2Z3cW91cW9od3N2bW5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjYyMDUsImV4cCI6MjA5Mzc0MjIwNX0.adLzT0UrX3e1IbkQ70G6LeFWeKbuGaa0PTL6AmrSBD8';
  const PV_SS_KEY = '5ft_pv_sid';
  // 봇·크롤러 — 가벼운 UA 필터 (정밀하지 않아도 됨, 정확도는 집계 단에서 충분)
  const PV_BOT_RE = /bot|crawler|spider|crawling|preview|fetch|monitor|googlebot|bingbot|yandex|baidu|duckduck|slurp|facebookexternal/i;

  function pvSessionId() {
    try {
      let sid = sessionStorage.getItem(PV_SS_KEY);
      if (!sid) {
        sid = (crypto.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)));
        sessionStorage.setItem(PV_SS_KEY, sid);
      }
      return sid;
    } catch (_) {
      return null;
    }
  }

  function pvUaFamily(ua) {
    if (!ua) return 'other';
    if (/Edg\//i.test(ua))     return 'edge';
    if (/OPR\/|Opera/i.test(ua)) return 'opera';
    if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return 'chrome';
    if (/Firefox\//i.test(ua)) return 'firefox';
    if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'safari';
    if (/MSIE|Trident/i.test(ua)) return 'ie';
    return 'other';
  }

  function pvShouldSkip() {
    // 개발 환경 / 봇 / 어드민 페이지는 집계 제외
    const host = location.hostname;
    if (!host || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return true;
    if (location.protocol === 'file:') return true;
    const ua = navigator.userAgent || '';
    if (PV_BOT_RE.test(ua)) return true;
    if (location.pathname.startsWith('/admin/') || location.pathname.includes('/admin/')) return true;
    if (navigator.webdriver) return true;
    return false;
  }

  function pvTz() {
    try { return (Intl.DateTimeFormat().resolvedOptions().timeZone || '').slice(0, 64); }
    catch (_) { return ''; }
  }

  function pvLang() {
    const l = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    return String(l).slice(0, 32);
  }

  function pvReferrerDomain() {
    if (!document.referrer || document.referrer.startsWith(location.origin)) return '';
    try {
      const u = new URL(document.referrer);
      return u.hostname.replace(/^www\./i, '').toLowerCase().slice(0, 255);
    } catch (_) {
      return '';
    }
  }

  // utm_*, fb/google 광고 클릭 ID 등 트래킹 파라미터 제거 — 같은 페이지가 100가지 변종으로 흩어지는 걸 방지
  const PV_TRACKING_KEYS = new Set([
    'fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'dclid', 'twclid',
    'mc_eid', 'mc_cid', '_hsenc', '_hsmi', 'igshid', 'ref', 'ref_src', 'ref_url',
    'ck_subscriber_id',
  ]);
  function pvCleanPath() {
    const p = location.pathname;
    if (!location.search) return p;
    try {
      const params = new URLSearchParams(location.search);
      const kept = [];
      for (const [k, v] of params) {
        if (k.startsWith('utm_')) continue;
        if (PV_TRACKING_KEYS.has(k.toLowerCase())) continue;
        kept.push([k, v]);
      }
      if (!kept.length) return p;
      const qs = kept.map(([k, v]) => v === '' ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      return p + '?' + qs;
    } catch (_) {
      return p;
    }
  }

  function recordPageView() {
    if (pvShouldSkip()) return;
    const path = pvCleanPath().slice(0, 500);
    const referrer = pvReferrerDomain();
    const payload = {
      path,
      referrer: referrer || null,
      ua_family: pvUaFamily(navigator.userAgent || ''),
      session_id: pvSessionId(),
      tz: pvTz() || null,
      lang: pvLang() || null,
    };
    try {
      fetch(PV_URL + '/rest/v1/page_views', {
        method: 'POST',
        mode: 'cors',
        keepalive: true,
        headers: {
          apikey: PV_KEY,
          Authorization: 'Bearer ' + PV_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(payload),
      }).catch(function () { /* 익명 로그는 실패해도 무시 */ });
    } catch (_) {}

    // 같은 페이지 진입 사이클 동안 한 번만 체류 시간 INSERT
    startDwellTracker(path);
  }

  // ─── 이벤트 로그 (page_views 외 액션 측정) ───
  // window.trackEvent('event_name', { 키: 값 })
  // 이벤트명: [a-z][a-z0-9_]* (DB CHECK 와 동일).
  // properties: 짧은 JSON. 익명 로그라 실패 무시.
  // pvShouldSkip() 조건 (개발/봇/어드민) 이면 송신 안 함.
  function trackEvent(name, properties) {
    if (pvShouldSkip()) return;
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(name)) return;
    const body = {
      event_name: name,
      path: pvCleanPath().slice(0, 500),
      session_id: pvSessionId(),
      ua_family: pvUaFamily(navigator.userAgent || ''),
      properties: (properties && typeof properties === 'object') ? properties : null,
    };
    try {
      fetch(PV_URL + '/rest/v1/app_events', {
        method: 'POST',
        mode: 'cors',
        keepalive: true,
        headers: {
          apikey: PV_KEY,
          Authorization: 'Bearer ' + PV_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(body),
      }).catch(function () {});
    } catch (_) {}
  }
  window.trackEvent = trackEvent;

  // ─── 클라이언트 에러 로그 (Sentry 미연결 시 최소 운영 감지)
  const ERROR_LOG_MAX_PER_PAGE = 5;
  let errorLogCount = 0;
  const ERROR_IGNORES = [
    /ResizeObserver loop/i,
    /^Script error\.?$/i,
    /NetworkError when attempting to fetch resource/i,
    // 인앱 브라우저(인스타·카카오·네이버 등)가 페이지에 inject 한 native bridge.
    // 호스트 스크립트의 문제가 아니라 inject 코드가 부재 환경에서 throw 하는 케이스.
    /window\.webkit\.messageHandlers/i,
    /__gCrWeb/i,
    /KAKAO\b/,
    // 안드로이드 IAB (Instagram 등) — "Java object is gone" 패턴으로 lifecycle 종료
    /Java object is gone/i,
    /Error invoking [A-Za-z]+:/i,
    // iOS 인스타·페이스북 인앱 브라우저가 주입하는 PCM 브리지 콜백.
    // 호스트 코드가 아니라 inject 스크립트가 부재 환경에서 throw 하는 케이스.
    /_pcmBridge/i,
  ];
  // source URL 기반 무시 — extension 또는 native bridge 의 inject 스크립트
  const ERROR_IGNORE_SOURCES = [
    /^iabjs:\/\//i,                  // Instagram / Facebook in-app browser JS
    /chrome-extension:\/\//i,
    /moz-extension:\/\//i,
    /safari-extension:\/\//i,
  ];

  function shouldSkipErrorLog(message, source) {
    if (pvShouldSkip()) return true;
    if (errorLogCount >= ERROR_LOG_MAX_PER_PAGE) return true;
    const msg = String(message || '');
    if (ERROR_IGNORES.some(re => re.test(msg))) return true;
    const src = String(source || '');
    if (src && ERROR_IGNORE_SOURCES.some(re => re.test(src))) return true;
    return false;
  }

  // 에러 페이로드에서 흘러올 수 있는 민감 정보 마스킹.
  // stack 에는 인라인 핸들러 클로저의 사용자 입력이 묻어오는 경우가 있어,
  // 송신 전에 한 번 걸러낸다.
  function maskErrorPII(s) {
    if (!s) return s;
    return String(s)
      .replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, '[email]')
      .replace(/\b0\d{1,2}-?\d{3,4}-?\d{4}\b/g, '[phone]')
      .replace(/\b(?:Bearer|bearer)\s+[A-Za-z0-9\-._~+/=]+/g, 'Bearer [token]')
      .replace(/eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, '[jwt]');
  }

  function recordClientError(payload) {
    const rawMessage = String(payload?.message || 'Unknown client error');
    const message = maskErrorPII(rawMessage).slice(0, 1000);
    if (shouldSkipErrorLog(message, payload?.source)) return;
    errorLogCount += 1;
    const body = {
      path: pvCleanPath().slice(0, 500),
      message,
      source: payload?.source ? String(payload.source).slice(0, 500) : null,
      lineno: Number.isFinite(payload?.lineno) ? payload.lineno : null,
      colno: Number.isFinite(payload?.colno) ? payload.colno : null,
      stack: payload?.stack ? maskErrorPII(String(payload.stack)).slice(0, 4000) : null,
      ua_family: pvUaFamily(navigator.userAgent || ''),
      session_id: pvSessionId(),
    };
    try {
      fetch(PV_URL + '/rest/v1/client_error_logs', {
        method: 'POST',
        mode: 'cors',
        keepalive: true,
        headers: {
          apikey: PV_KEY,
          Authorization: 'Bearer ' + PV_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(body),
      }).catch(function () {});
    } catch (_) {}
  }

  window.addEventListener('error', function (event) {
    recordClientError({
      message: event.message || event.error?.message,
      source: event.filename || '',
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack || '',
    });
  });

  window.addEventListener('unhandledrejection', function (event) {
    const reason = event.reason;
    const msg = reason?.message || String(reason || '');
    // CSS @view-transition 활성 시 페이지 이동 중 다음 navigation 이 진행 중 transition 을
    // skip/abort 시키는 건 정상. promise 가 reject 되지만 진짜 에러가 아니라서 로깅 제외.
    if (/Transition was (skipped|aborted)|Skipping view transition/i.test(msg)) return;
    recordClientError({
      message: msg || 'Unhandled promise rejection',
      source: 'unhandledrejection',
      stack: reason?.stack || '',
    });
  });

  window.reportClientError = recordClientError;

  // 일부 인앱 브라우저는 <picture> 의 WebP source 요청이 실패했을 때
  // img fallback 으로 자연스럽게 내려가지 않는 경우가 있어, 원본 src 로 한 번 더 복구한다.
  document.addEventListener('error', function (event) {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset.fallbackTried === '1') return;
    const picture = img.closest('picture');
    const fallbackSrc = img.getAttribute('src');
    if (!picture || !fallbackSrc) return;
    img.dataset.fallbackTried = '1';
    picture.querySelectorAll('source').forEach(source => source.remove());
    img.src = fallbackSrc;
  }, true);

  // ─── 체류 시간 트래커 (page_dwells) ───
  // foreground 시간만 누적해서 페이지 떠날 때 1회 INSERT.
  function startDwellTracker(path) {
    let activeAt = (document.visibilityState === 'visible') ? performance.now() : null;
    let accumulatedMs = 0;
    let sent = false;
    const sid = pvSessionId();

    function flush() {
      if (sent) return;
      if (activeAt != null) {
        accumulatedMs += performance.now() - activeAt;
        activeAt = null;
      }
      const ms = Math.round(accumulatedMs);
      // 1초 미만 / 4시간 초과는 의미 없는 표본
      if (ms < 1000 || ms > 14400000) return;
      sent = true;
      try {
        fetch(PV_URL + '/rest/v1/page_dwells', {
          method: 'POST',
          mode: 'cors',
          keepalive: true,
          headers: {
            apikey: PV_KEY,
            Authorization: 'Bearer ' + PV_KEY,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ path, session_id: sid, dwell_ms: ms }),
        }).catch(function () {});
      } catch (_) {}
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        if (activeAt == null && !sent) activeAt = performance.now();
      } else if (activeAt != null) {
        accumulatedMs += performance.now() - activeAt;
        activeAt = null;
        // 모바일은 hidden 후 종종 pagehide 가 안 와서 여기서 보냄
        flush();
      }
    }

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
  }


  window.SiteTelemetry = { recordPageView, trackEvent, reportClientError: recordClientError };
})();
