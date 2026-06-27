// 5ft.mag 공통 헤더/테마/메뉴 핸들러
// 모든 페이지 <head> 에서 FOUC 방지용 1줄로 테마 초기 적용:
//   <script>document.documentElement.dataset.theme=localStorage.getItem('5ftTheme')||'light';</script>
// 모든 페이지 <body> 끝에 이 파일을 로드:
//   <script src="./js/site-common.js"></script>  (또는 ../js/site-common.js)

(function () {
  'use strict';

  const THEME_KEY = '5ftTheme';

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

  // ════════════════════════════════════════════════
  // 테마 버튼 SVG 업데이트
  // ════════════════════════════════════════════════
  function updateThemeButton(btn) {
    if (!btn) return;
    const isDark = document.documentElement.dataset.theme === 'dark';
    btn.setAttribute('aria-label', isDark ? '라이트 모드로 전환' : '다크 모드로 전환');
    btn.setAttribute('aria-pressed', String(isDark));
    btn.setAttribute('type', 'button');
    btn.innerHTML = isDark
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"></circle><path d="M12 2.5v3M12 18.5v3M4.5 4.5l2.1 2.1M17.4 17.4l2.1 2.1M2.5 12h3M18.5 12h3M4.5 19.5l2.1-2.1M17.4 6.6l2.1-2.1"></path></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.2A7.8 7.8 0 0 1 9.8 3.5 8.7 8.7 0 1 0 20.5 14.2Z"></path></svg>';
  }

  // ════════════════════════════════════════════════
  // 햄버거 버튼 SVG 업데이트
  // ════════════════════════════════════════════════
  function updateMenuButton(btn, nav) {
    if (!btn || !nav) return;
    const isOpen = nav.classList.contains('open');
    btn.setAttribute('aria-label', isOpen ? '메뉴 닫기' : '메뉴 열기');
    btn.setAttribute('aria-expanded', String(isOpen));
    btn.setAttribute('aria-controls', nav.id || 'mobileNav');
    btn.setAttribute('type', 'button');
    btn.innerHTML = isOpen
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"></path></svg>';
  }

  // ════════════════════════════════════════════════
  // 글 끝 SHARE 영역의 "링크 복사" 버튼
  // ════════════════════════════════════════════════
  function setCopyButtonState(btn, text) {
    if (!btn) return;
    const original = btn.dataset.copyLabel || btn.textContent;
    btn.dataset.copyLabel = original;
    btn.textContent = text;
    window.clearTimeout(btn._copyTimer);
    btn._copyTimer = window.setTimeout(function () {
      btn.textContent = btn.dataset.copyLabel || original;
    }, 1600);
  }

  function copyWithTextarea(text = window.location.href) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    let ok = false;
    try { ok = document.execCommand('copy'); }
    catch { ok = false; }
    ta.remove();
    return ok;
  }

  async function copyTextToClipboard(text) {
    const value = String(text ?? '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (_) {}
    }
    // execCommand fallback is kept for older in-app browsers/WebViews.
    return copyWithTextarea(value);
  }
  window.copyTextToClipboard = copyTextToClipboard;

  const PUBLIC_SHARE_ORIGIN = 'https://5ftmag.com';
  function isInternalShareHost(hostname) {
    return /(^|\.)5ftmag\.com$/i.test(hostname)
      || /\.netlify\.app$/i.test(hostname)
      || hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '::1';
  }

  function prettyShareUrl(input = window.location.href) {
    let url;
    try { url = new URL(input, window.location.origin); }
    catch (_) { return String(input || ''); }
    if (!isInternalShareHost(url.hostname)) return url.toString();

    const cleanPath = url.pathname.replace(/\/index\.html$/i, '/');
    const film = url.searchParams.get('film') || url.searchParams.get('slug');
    const camera = url.searchParams.get('camera');
    const contributor = url.searchParams.get('contributor');
    const marketId = url.searchParams.get('id');

    if (/\/films\.html$/i.test(cleanPath)) {
      if (camera) return `${PUBLIC_SHARE_ORIGIN}/camera/${encodeURIComponent(camera)}`;
      if (contributor) return `${PUBLIC_SHARE_ORIGIN}/contributor/${encodeURIComponent(contributor)}`;
      if (film) return `${PUBLIC_SHARE_ORIGIN}/film/${encodeURIComponent(film)}`;
      return `${PUBLIC_SHARE_ORIGIN}/films`;
    }
    if (/\/market\.html$/i.test(cleanPath)) {
      if (marketId) return `${PUBLIC_SHARE_ORIGIN}/market/${encodeURIComponent(marketId)}`;
      return `${PUBLIC_SHARE_ORIGIN}/market`;
    }

    const withoutHtml = cleanPath.replace(/\.html$/i, '');
    const query = url.searchParams.toString();
    return PUBLIC_SHARE_ORIGIN + withoutHtml + (query ? `?${query}` : '') + url.hash;
  }
  window.prettyShareUrl = prettyShareUrl;

  function copyCurrentLink(btn) {
    copyTextToClipboard(prettyShareUrl(window.location.href)).then(function (ok) {
      setCopyButtonState(btn, ok ? '복사 완료' : '복사 실패');
    });
  }
  // 글로벌로도 노출 (기존 onclick="copyLink()" 호환)
  window.copyLink = copyCurrentLink;

  // ════════════════════════════════════════════════
  // 글 상세 author 이름을 author archive로 연결
  // ════════════════════════════════════════════════
  const AUTHOR_LINKS = {
    '5ft.mag 편집부': '../authors/5ftmag.html',
    'Film Social Club': '../authors/film-social-club.html',
    'Shin Noguchi': '../authors/shin-noguchi.html',
    'Brisnap TV': '../authors/brisnap-tv.html',
    '김현아': '../authors/kim-hyuna.html',
    '명수경': '../authors/myeong-sugyeong.html',
    '강혜원': '../authors/kang-hyewon.html',
    '윤동규': '../authors/yoon-donggyu.html',
    '심규동': '../authors/shim-kyudong.html',
  };

  function linkArticleAuthor() {
    const el = document.querySelector('.article-author .author-name');
    if (!el || el.querySelector('a')) return;
    const text = el.textContent.trim();
    const key = Object.keys(AUTHOR_LINKS).find(function (name) {
      return text.includes(name);
    });
    if (!key) return;
    const link = document.createElement('a');
    link.href = AUTHOR_LINKS[key];
    link.className = 'author-link';
    link.textContent = text;
    el.textContent = '';
    el.appendChild(link);
  }

  // ════════════════════════════════════════════════
  // 초기화
  // ════════════════════════════════════════════════
  // ════════════════════════════════════════════════
  // 전체 검색 단축키 (⌘K / Ctrl+K) — cmdk 결만 살짝.
  //   - 어디서든 ⌘K 누르면 /search.html 로 이동 (이미 거기면 input 포커스).
  //   - 입력창에 있을 땐 ESC 로 빠져나가도록 살짝 도움 — 단축키만 글로벌, 인터셉트는 최소.
  //   - 헤더의 #headerSearchBtn 옆에 작은 ⌘K kbd 칩을 inject (있을 때만, 한 번만).
  // ════════════════════════════════════════════════
  function setupGlobalSearchShortcut() {
    if (document.documentElement.dataset.searchShortcutBound === '1') return;
    document.documentElement.dataset.searchShortcutBound = '1';

    const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
    const onSearchPage = /\/search\.html$/.test(location.pathname);

    // 키 칩 inject — 헤더 돋보기 아이콘 옆에. 데스크탑에서만 노출 (모바일은 헤더 좁음).
    const btn = document.getElementById('headerSearchBtn');
    if (btn && !btn.querySelector('.kbd-hint')) {
      const kbd = document.createElement('span');
      kbd.className = 'kbd-hint';
      kbd.setAttribute('aria-hidden', 'true');
      kbd.textContent = isMac ? '⌘K' : 'Ctrl K';
      btn.appendChild(kbd);
      btn.setAttribute('aria-keyshortcuts', isMac ? 'Meta+K' : 'Control+K');
    }

    document.addEventListener('keydown', (e) => {
      // ⌘K (Mac) / Ctrl+K — 입력 중인 textarea/contenteditable 에서도 가로챈다.
      if (e.key === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (onSearchPage) {
          const input = document.getElementById('searchQ');
          if (input) { input.focus(); input.select(); }
        } else {
          location.href = '/search.html';
        }
      }
    });
  }


  function init() {
    // 테마: head에서 이미 적용됐지만, 안전하게 재확인
    if (!document.documentElement.dataset.theme) {
      document.documentElement.dataset.theme = localStorage.getItem(THEME_KEY) || 'light';
    }

    // 페이지뷰 로깅 — 한 페이지당 한 번
    recordPageView();

    // 스크롤 등장 + 글 읽기 진행바
    initScrollReveal();
    initReadingProgress();

    // 전체 검색 단축키 (⌘K / Ctrl+K) — cmdk 결을 살짝.
    setupGlobalSearchShortcut();


    // 공지 배너 + 인앱 브라우저 안내 (admin 페이지 제외)
    if (!/\/admin\//.test(location.pathname)) {
      setupAnnouncementBar();
      setupInAppBrowserNotice();
    }

    const themeBtn = document.getElementById('themeBtn');
    const menuBtn = document.getElementById('menuBtn');
    const mobileNav = document.getElementById('mobileNav');

    updateThemeButton(themeBtn);
    updateMenuButton(menuBtn, mobileNav);

    // 테마 토글 (회전 + 페이드 모핑)
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        const html = document.documentElement;
        const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
        html.dataset.theme = next;
        localStorage.setItem(THEME_KEY, next);
        // CSS keyframe animation 트리거
        themeBtn.classList.remove('is-switching');
        void themeBtn.offsetWidth;
        themeBtn.classList.add('is-switching');
        // 애니메이션 중간 (회전 50% 지점) 에서 svg 교체 → 모핑 느낌
        setTimeout(() => updateThemeButton(themeBtn), 200);
        setTimeout(() => themeBtn.classList.remove('is-switching'), 480);
      });
    }

    // 햄버거 메뉴 토글
    if (menuBtn && mobileNav) {
      menuBtn.addEventListener('click', function () {
        const opened = mobileNav.classList.toggle('open');
        document.body.classList.toggle('modal-open', opened);
        updateMenuButton(menuBtn, mobileNav);
      });

      // 네비게이션 링크 클릭 시 메뉴 닫기
      mobileNav.addEventListener('click', function (event) {
        if (event.target.closest('a')) {
          mobileNav.classList.remove('open');
          document.body.classList.remove('modal-open');
          updateMenuButton(menuBtn, mobileNav);
        }
      });
    }

    // 글 끝 SHARE 영역 "링크 복사" 버튼 이벤트 위임
    // (기존 inline onclick="copyLink()" 도 동작하지만, data-action 패턴도 지원)
    document.addEventListener('click', function (e) {
      const t = e.target.closest('[data-action="copy-link"]');
      if (t) { e.preventDefault(); copyCurrentLink(t); }
    });

    linkArticleAuthor();
    setupAuthNav();
    setupNotifications();
    setupArticleScrap();
    setupArticleShare();
    setupFavoritePulse();
    injectFooterLegalLinks();
    injectSkipLink();
    setAriaCurrentOnNav();
    loadAnalyticsOnce();
  }

  // ════════════════════════════════════════════════
  // 접근성 — Skip to main content 링크
  //   Tab 처음 누르면 화면 최상단에 "본문으로 건너뛰기" 노출.
  //   스크린리더/키보드 사용자가 매 페이지 매번 nav 반복 안 듣고 본문으로 이동.
  // ════════════════════════════════════════════════
  function injectSkipLink() {
    if (document.querySelector('.skip-link')) return;
    // 본문 후보 — <article> 또는 <main> 또는 첫 <section>
    const main = document.querySelector('article, main, [role="main"], section');
    if (!main) return;
    if (!main.id) main.id = 'main';
    const a = document.createElement('a');
    a.className = 'skip-link';
    a.href = '#' + main.id;
    a.textContent = '본문으로 건너뛰기';
    document.body.insertBefore(a, document.body.firstChild);
  }

  // 현재 페이지 nav 링크에 aria-current="page" — 스크린리더에게 위치 안내
  function setAriaCurrentOnNav() {
    const here = location.pathname.replace(/\/index\.html$/, '/');
    document.querySelectorAll('.main-nav a, .mobile-nav a').forEach(a => {
      try {
        const url = new URL(a.href, location.origin);
        if (url.origin !== location.origin) return;
        const ap = url.pathname.replace(/\/index\.html$/, '/');
        if (ap === here) a.setAttribute('aria-current', 'page');
      } catch (_) {}
    });
  }

  // js/analytics.js (Plausible + Sentry bootstrapper) + js/icons.js 한 번만 로드
  let _aux = false;
  function loadAnalyticsOnce() {
    if (_aux) return;
    _aux = true;
    const base = /\/(stories|admin|authors|legal)\//.test(location.pathname) ? '../' : './';
    [['analytics.js', '20260515-bootstrap'], ['icons.js', '20260515-icons']].forEach(([f, v]) => {
      const s = document.createElement('script');
      s.defer = true;
      s.src = `${base}js/${f}?v=${v}`;
      document.head.appendChild(s);
    });
  }

  // ════════════════════════════════════════════════
  // Toast — alert() 대체. 단순 정보 노출 용도.
  //   showToast('저장됐어요')                        — default
  //   showToast('실패했어요', { type: 'danger' })     — 강조
  //   showToast('처리 중…', { type: 'info', duration: 0 })  — 수동 dismiss 만
  // 반환: dismiss() 함수
  // ════════════════════════════════════════════════
  let _toastHost = null;
  function ensureToastHost() {
    if (_toastHost && document.body.contains(_toastHost)) return _toastHost;
    _toastHost = document.createElement('div');
    _toastHost.className = 'ft-toast-host';
    _toastHost.setAttribute('aria-live', 'polite');
    _toastHost.setAttribute('aria-atomic', 'true');
    document.body.appendChild(_toastHost);
    return _toastHost;
  }
  function showToast(msg, opts = {}) {
    const { type = 'default', duration = 2200 } = opts;
    const host = ensureToastHost();
    const el = document.createElement('div');
    el.className = `ft-toast ft-toast-${type}`;
    el.textContent = String(msg ?? '');
    el.setAttribute('role', type === 'danger' ? 'alert' : 'status');
    host.appendChild(el);
    // 들어올 때 animation
    requestAnimationFrame(() => el.classList.add('is-in'));
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return; dismissed = true;
      el.classList.remove('is-in');
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 400);
    };
    if (duration > 0) setTimeout(dismiss, duration);
    el.addEventListener('click', dismiss);
    return dismiss;
  }
  window.showToast = showToast;

  // ════════════════════════════════════════════════
  // 접근성 — focus trap + sr 안내
  //   createFocusTrap(modal): 모달 안에서 Tab 순환. cleanup 함수 반환.
  //   srAnnounce(text): aria-live="polite" 영역에 메시지 송신.
  // ════════════════════════════════════════════════
  const FOCUSABLE_SEL = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  function focusableIn(modal) {
    return Array.from(modal.querySelectorAll(FOCUSABLE_SEL))
      .filter(el => !el.hidden && el.offsetParent !== null);
  }
  function createFocusTrap(modal) {
    if (!modal || modal.dataset.focusTrapped === '1') return () => {};
    modal.dataset.focusTrapped = '1';
    const prevFocus = document.activeElement;
    setTimeout(() => {
      const items = focusableIn(modal);
      if (items.length) items[0].focus();
    }, 0);
    function onKey(e) {
      if (e.key !== 'Tab') return;
      const items = focusableIn(modal);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    modal.addEventListener('keydown', onKey);
    return function release() {
      modal.removeEventListener('keydown', onKey);
      delete modal.dataset.focusTrapped;
      try { prevFocus?.focus?.(); } catch (_) {}
    };
  }
  window.createFocusTrap = createFocusTrap;

  let _srHost = null;
  function srAnnounce(text) {
    if (!_srHost) {
      _srHost = document.createElement('div');
      _srHost.setAttribute('aria-live', 'polite');
      _srHost.setAttribute('aria-atomic', 'true');
      _srHost.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);';
      document.body.appendChild(_srHost);
    }
    _srHost.textContent = '';
    setTimeout(() => { _srHost.textContent = String(text || ''); }, 30);
  }
  window.srAnnounce = srAnnounce;

  // 원본 alert 백업 — 아래 monkey-patch / notify 폴백에서 모두 참조
  const _origAlert = window.alert.bind(window);

  function inferToastType(text, fallback = 'default') {
    const s = String(text ?? '');
    if (/실패|오류|거부|에러|못했어요|중단|시간 초과|불가|잘못|만료|삭제하지 못|저장하지 못|처리 실패|복사 실패/.test(s)) return 'danger';
    if (/접수|완료|저장|등록|로그인|승인|성공|복사 완료|새 알림|들어왔어요/.test(s)) return 'info';
    return fallback;
  }

  // notify(msg, type) — showToast 있으면 toast, 없으면 alert
  window.notify = function (msg, type) {
    const inferred = type || inferToastType(msg);
    if (typeof window.showToast === 'function') return window.showToast(msg, { type: inferred });
    _origAlert(String(msg ?? ''));
  };

  // ════════════════════════════════════════════════
  // alert() 자동 토스트화 (monkey-patch)
  //   기존 코드의 alert('실패…') 들을 일괄 변환하지 않고도 토스트로 라우팅.
  //   confirm/prompt 는 입력 받는 동기 동작이라 건드리지 않음.
  // ════════════════════════════════════════════════
  window.alert = function (msg) {
    const text = String(msg ?? '');
    // 알림 톤 추정 — 메시지 어조로 type 결정
    const type = inferToastType(text);
    if (typeof window.showToast === 'function') {
      return window.showToast(text, { type, duration: type === 'danger' ? 3500 : 2400 });
    }
    return _origAlert(text);
  };

  // ════════════════════════════════════════════════
  // 법무 페이지 링크 — 모든 페이지 푸터에 동적 inject
  //   기존 footer-links 4개 (Shop/IG/이메일/4rest) 다음 자리에
  //   "이용약관 · 개인정보 · 저작권" 3개 추가
  // ════════════════════════════════════════════════
  function injectFooterLegalLinks() {
    const links = document.querySelector('.footer-links');
    if (!links) return;
    if (links.querySelector('[data-legal]')) return; // 이미 inject 됨
    const base = /\/(stories|admin|authors|legal)\//.test(location.pathname) ? '../' : './';
    const entries = [
      ['이용약관', base + 'legal/terms.html'],
      ['개인정보', base + 'legal/privacy.html'],
      ['저작권',  base + 'legal/copyright.html'],
    ];
    entries.forEach(([label, href]) => {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      a.setAttribute('data-legal', '1');
      links.appendChild(a);
    });
  }

  // ════════════════════════════════════════════════
  // Auth nav — 로그인 상태/편집부 여부에 따라 헤더에 항목 inject
  //   기본 헤더 마크업은 28개 페이지에 중복돼 있어서 DOM 변경은 여기서만 함.
  //   - 비로그인: "로그인"
  //   - 로그인  : 데스크톱은 계정 메뉴, 모바일은 "내 정보" + "로그아웃"
  //   - 편집부  : 데스크톱 계정 메뉴/모바일 메뉴 안에 "관리" 추가
  //   - Shop ↗ 다음 자리에 노출 (메인 nav + 모바일 nav 모두)
  // ════════════════════════════════════════════════
  function isStoryPath() { return /\/stories\//.test(location.pathname); }
  function isAdminPath() { return /\/admin\//.test(location.pathname); }
  function authPathTo(name) {
    // me.html · admin/submissions.html 로의 상대 경로 계산
    if (isStoryPath() || isAdminPath()) {
      return '../' + name;
    }
    return name;
  }
  // Supabase JS v2 가 localStorage 의 'sb-<ref>-auth-token' 에 세션을 저장.
  // db-client 의 session() 폴링(최대 3.6초)을 기다리지 않고 즉시 로그인 여부를 추정.
  function hasLocalSupabaseSession() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
          const raw = localStorage.getItem(k);
          if (raw && raw !== 'null' && raw.length > 10) return true;
        }
      }
    } catch (_) {}
    return false;
  }
  function readEditorCache() {
    try { return localStorage.getItem('5ft-is-editor') === '1'; } catch (_) { return false; }
  }
  function writeEditorCache(on) {
    try { on ? localStorage.setItem('5ft-is-editor', '1') : localStorage.removeItem('5ft-is-editor'); } catch (_) {}
  }

  async function setupAuthNav() {
    const mainNav = document.querySelector('.main-nav');
    const mobileNav = document.getElementById('mobileNav');
    if (!mainNav && !mobileNav) return;

    // 1) 즉시 렌더: localStorage 의 Supabase 토큰 존재 여부로 0ms 에 추정
    const guessLoggedIn = hasLocalSupabaseSession();
    const guessEditor   = guessLoggedIn && readEditorCache();
    renderAuthNav({ mainNav, mobileNav, loggedIn: guessLoggedIn, isEditor: guessEditor });

    // 2) db-client 준비 대기 (최대 3초)
    for (let i = 0; i < 60; i++) {
      if (window.MagDB && window.MagDB.isReady()) break;
      await new Promise(r => setTimeout(r, 50));
    }
    let session = null;
    let isEditor = false;
    if (window.MagDB && window.MagDB.isReady()) {
      try {
        session = await window.MagDB.auth.getSession();
        if (session && window.MagDB.profiles && typeof window.MagDB.profiles.getMine === 'function') {
          const profile = await window.MagDB.profiles.getMine();
          isEditor = !!(profile && profile.is_editor);
        }
      } catch (_) { /* silent — 익명/오프라인 모두 OK */ }
    }
    writeEditorCache(!!session && isEditor);
    // 3) 추정값과 실제값이 다르면 보정
    if (!!session !== guessLoggedIn || isEditor !== guessEditor) {
      renderAuthNav({ mainNav, mobileNav, loggedIn: !!session, isEditor });
    }
    if (window.MagDB && window.MagDB.auth && typeof window.MagDB.auth.onChange === 'function' && !document.documentElement.dataset.authNavBound) {
      document.documentElement.dataset.authNavBound = '1';
      window.MagDB.auth.onChange(async (_event, nextSession) => {
        let nextIsEditor = false;
        if (nextSession && window.MagDB.profiles && typeof window.MagDB.profiles.getMine === 'function') {
          try {
            const profile = await window.MagDB.profiles.getMine();
            nextIsEditor = !!(profile && profile.is_editor);
          } catch (_) { /* keep anonymous fallback */ }
        }
        writeEditorCache(!!nextSession && nextIsEditor);
        renderAuthNav({ mainNav, mobileNav, loggedIn: !!nextSession, isEditor: nextIsEditor });
      });
    }
  }
  function renderAuthNav({ mainNav, mobileNav, loggedIn, isEditor }) {
    // 기존 inject 항목 제거 (auth 상태 바뀌었을 때 재호출 가능)
    document.querySelectorAll('[data-nav-auth]').forEach(el => el.remove());
    const meHref    = authPathTo('me.html');
    const adminHref = authPathTo('admin/submissions.html');
    const items = [];
    if (!loggedIn) {
      items.push({ label: '로그인', action: 'auth-login' });
    } else {
      if (isEditor) items.push({ label: '관리', href: adminHref });
      items.push({ label: '내 정보', href: meHref });
      items.push({ label: '로그아웃', action: 'auth-logout' });
    }
    function accountIconSvg() {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    }
    // 메인 nav (Shop 다음에 끼움 — Shop 은 .ext 클래스로 식별)
    if (mainNav) {
      const shopLi = mainNav.querySelector('.ext')?.parentElement || null;
      if (!loggedIn) {
        const li = document.createElement('li');
        li.setAttribute('data-nav-auth', '1');
        const a = document.createElement('a');
        a.href = '#';
        a.dataset.action = 'auth-login';
        a.textContent = '로그인';
        li.appendChild(a);
        if (shopLi && shopLi.parentNode === mainNav) shopLi.parentNode.insertBefore(li, shopLi.nextSibling);
        else mainNav.appendChild(li);
      } else {
        const li = document.createElement('li');
        li.setAttribute('data-nav-auth', '1');
        li.className = 'nav-account';
        const menuItems = [
          { label: '내 정보', href: meHref },
          ...(isEditor ? [{ label: '관리', href: adminHref }] : []),
          { label: '로그아웃', action: 'auth-logout' },
        ];
        li.innerHTML = `
          <button type="button" class="icon-btn nav-account-btn" data-action="nav-account-toggle" aria-label="계정 메뉴 열기" aria-expanded="false">
            ${accountIconSvg()}
          </button>
          <div class="nav-account-menu" role="menu" hidden>
            ${menuItems.map(it => it.href
              ? `<a href="${it.href}" role="menuitem">${it.label}</a>`
              : `<button type="button" data-action="${it.action}" role="menuitem">${it.label}</button>`
            ).join('')}
          </div>
        `;
        if (shopLi && shopLi.parentNode === mainNav) shopLi.parentNode.insertBefore(li, shopLi.nextSibling);
        else mainNav.appendChild(li);
      }
    }
    // 모바일 nav (Shop 링크 뒤에 끼움)
    if (mobileNav) {
      const shopA = mobileNav.querySelector('a[href*="smartstore"]') || null;
      items.forEach(it => {
        const a = document.createElement('a');
        a.setAttribute('data-nav-auth', '1');
        if (it.href) a.href = it.href;
        else { a.href = '#'; a.dataset.action = it.action; }
        a.textContent = it.label;
        if (shopA && shopA.nextSibling) shopA.parentNode.insertBefore(a, shopA.nextSibling);
        else mobileNav.appendChild(a);
      });
    }
  }
  function closeAccountMenus(except) {
    document.querySelectorAll('.nav-account').forEach(root => {
      if (except && root === except) return;
      const btn = root.querySelector('.nav-account-btn');
      const menu = root.querySelector('.nav-account-menu');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (menu) menu.hidden = true;
    });
  }
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-action="nav-account-toggle"]');
    if (toggle) {
      e.preventDefault();
      const root = toggle.closest('.nav-account');
      const menu = root?.querySelector('.nav-account-menu');
      if (!root || !menu) return;
      const open = menu.hidden;
      closeAccountMenus(root);
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    if (!e.target.closest('.nav-account')) closeAccountMenus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAccountMenus();
  });
  // 로그인 액션 위임
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action="auth-login"]');
    if (!t) return;
    e.preventDefault();
    if (!window.MagDB || !window.MagDB.isReady()) {
      window.notify?.('잠시 후 다시 시도해주세요.', 'info');
      return;
    }
    // 현재 페이지로 복귀 (site-common.js · db-client.js 의 origin restore 가 처리)
    window.MagDB.auth.signInWithGoogle(window.location.href.split('#')[0]);
  });
  // 로그아웃 액션 위임 — onChange 가 헤더 재렌더를 처리
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action="auth-logout"]');
    if (!t) return;
    e.preventDefault();
    if (!window.MagDB || !window.MagDB.isReady()) {
      window.notify?.('잠시 후 다시 시도해주세요.', 'info');
      return;
    }
    try {
      await window.MagDB.auth.signOut();
      writeEditorCache(false);
      window.notify?.('로그아웃 되었습니다.', 'info');
    } catch (err) {
      window.notify?.('로그아웃 실패: ' + (err?.message || '잠시 후 다시 시도'), 'danger');
    }
  });

  // ════════════════════════════════════════════════
  // 사용자 알림 (in-app) — 헤더 종 아이콘 + 드롭다운
  //   로그인 사용자에게만 .nav-right 에 종 버튼 inject.
  //   클릭 시 드롭다운 패널 표시. 실시간 INSERT 토스트.
  // ════════════════════════════════════════════════
  function bellIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z"/><path d="M10 18a2 2 0 0 0 4 0"/></svg>';
  }
  // 종 버튼만 헤더에 보장 — DB·로그인 준비와 무관하게 항상 노출.
  function injectNotifBell() {
    const navRight = document.querySelector('.nav-right');
    if (!navRight) return null;
    const existing = document.getElementById('notifBell');
    if (existing) return existing;
    const themeBtn = document.getElementById('themeBtn');
    const bell = document.createElement('button');
    bell.id = 'notifBell';
    bell.type = 'button';
    bell.className = 'icon-btn notif-bell';
    bell.setAttribute('aria-label', '알림 열기');
    bell.setAttribute('aria-expanded', 'false');
    bell.innerHTML = bellIconSvg() + '<span class="notif-badge" id="notifBadge" hidden></span>';
    if (themeBtn) navRight.insertBefore(bell, themeBtn);
    else navRight.appendChild(bell);
    return bell;
  }

  async function setupNotifications() {
    const navRight = document.querySelector('.nav-right');
    if (!navRight) return;
    // 종은 항상 먼저 띄운다(아래 DB 대기·세션 확인과 무관하게).
    const bell = injectNotifBell();
    if (!bell) return;
    if (document.documentElement.dataset.notifBound === '1') return;

    // db-client 준비 대기 (종은 이미 떠 있음)
    for (let i = 0; i < 60; i++) {
      if (window.MagDB && window.MagDB.isReady()) break;
      await new Promise(r => setTimeout(r, 50));
    }
    const ready = !!(window.MagDB && window.MagDB.isReady());
    let session = null;
    if (ready) { try { session = await window.MagDB.auth.getSession(); } catch (_) {} }

    // auth 변화 시 패널만 다시 구성 — 종 자체는 유지. onChange 한 번만 바인딩.
    if (ready && typeof window.MagDB.auth.onChange === 'function' && !document.documentElement.dataset.notifAuthBound) {
      document.documentElement.dataset.notifAuthBound = '1';
      window.MagDB.auth.onChange((_event, _next) => {
        const panel = document.getElementById('notifPanel');
        if (panel) panel.remove();
        document.documentElement.dataset.notifBound = '';
        setupNotifications();
      });
    }

    document.documentElement.dataset.notifBound = '1';

    // 비로그인(또는 DB 미준비) — 종을 누르면 로그인 안내 패널만 노출
    if (!session) {
      const guestPanel = document.createElement('div');
      guestPanel.id = 'notifPanel';
      guestPanel.className = 'notif-panel';
      guestPanel.setAttribute('role', 'dialog');
      guestPanel.setAttribute('aria-label', '알림');
      guestPanel.hidden = true;
      guestPanel.innerHTML = `
        <div class="notif-panel-head">
          <span class="notif-panel-title">알림</span>
        </div>
        <div class="notif-panel-guest">
          <p class="notif-panel-guest-title">로그인하면 알림을 받을 수 있어요</p>
          <p class="notif-panel-guest-body">댓글 답글 · 사진 승인 · 새 글 알림.<br/>기기에 푸시로도 받을 수 있어요.</p>
          <button type="button" class="notif-panel-guest-btn" data-action="auth-login">Google로 로그인</button>
        </div>`;
      document.body.appendChild(guestPanel);
      bell.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = guestPanel.hidden;
        guestPanel.hidden = !open;
        bell.setAttribute('aria-expanded', String(open));
      });
      document.addEventListener('click', (e) => {
        if (guestPanel.hidden) return;
        if (guestPanel.contains(e.target) || bell.contains(e.target)) return;
        guestPanel.hidden = true;
        bell.setAttribute('aria-expanded', 'false');
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !guestPanel.hidden) { guestPanel.hidden = true; bell.setAttribute('aria-expanded', 'false'); }
      });
      return;
    }

    // 로그인 사용자 — 정식 패널
    const panel = document.createElement('div');
    panel.id = 'notifPanel';
    panel.className = 'notif-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '알림');
    panel.hidden = true;
    panel.innerHTML = `
      <div class="notif-panel-head">
        <span class="notif-panel-title">알림</span>
        <button type="button" class="notif-panel-allread" id="notifAllRead">전체 읽음</button>
      </div>
      <div class="notif-panel-push" id="notifPushRow" hidden>
        <div class="notif-panel-push-summary">
          <span class="notif-panel-push-label">기기에 푸시 알림 받기</span>
          <button type="button" class="notif-panel-push-toggle" id="notifPushToggle" aria-pressed="false">켜기</button>
        </div>
        <div class="notif-panel-push-detail" id="notifPushDetail" hidden>
          <p class="notif-panel-push-help">댓글 답글 · 사진 승인 · 새 글이 OS 알림으로 와요. 언제든 끌 수 있어요.</p>
          <div class="notif-panel-push-actions">
            <button type="button" class="notif-panel-push-confirm" id="notifPushConfirm">지금 켜기</button>
            <button type="button" class="notif-panel-push-cancel" id="notifPushCancel">나중에</button>
          </div>
        </div>
      </div>
      <div class="notif-panel-list" id="notifList">
        <div class="notif-panel-empty">불러오는 중…</div>
      </div>`;
    document.body.appendChild(panel);

    // 푸시 토글 — Notification + PushManager 지원 시만 노출
    setupPushToggle();

    function updateBadge(n) {
      const badge = document.getElementById('notifBadge');
      const bellBtn = document.getElementById('notifBell');
      if (!badge) return;
      if (n > 0) {
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.hidden = false;
        if (bellBtn) bellBtn.classList.add('has-unread');
      } else {
        badge.hidden = true;
        if (bellBtn) bellBtn.classList.remove('has-unread');
      }
    }
    async function refreshBadge() {
      try {
        // 헤더 배지에는 알림 + 편집부 메시지 안읽음 카운트를 합쳐 표시.
        // 회원에게도 편집부에게도 같은 종 아이콘 하나로 통합 안내.
        const [n, m] = await Promise.all([
          window.MagDB.notifications.unreadCount().catch(() => 0),
          // 편집부면 회원이 보낸 미응답 메시지 카운트, 회원이면 편집부가 보낸 미확인 카운트.
          (async () => {
            try {
              const prof = await window.MagDB.profiles.getMine();
              if (prof?.is_editor) return await window.MagDB.messages.unreadCountForAdmin();
              return await window.MagDB.messages.unreadCount();
            } catch (_) { return 0; }
          })(),
        ]);
        updateBadge((n || 0) + (m || 0));
      } catch (_) {}
    }
    function fmtAgo(iso) {
      const d = new Date(iso);
      const diff = Math.floor((Date.now() - d.getTime()) / 1000);
      if (diff < 60) return '방금 전';
      if (diff < 3600)   return Math.floor(diff / 60) + '분 전';
      if (diff < 86400)  return Math.floor(diff / 3600) + '시간 전';
      if (diff < 604800) return Math.floor(diff / 86400) + '일 전';
      return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
    }
    function escapeHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function safeInternalHref(value) {
      const raw = String(value || '').trim();
      if (!raw || raw === '#') return '#';
      try {
        const url = new URL(raw, window.location.origin);
        if (url.origin !== window.location.origin) return '#';
        return `${url.pathname}${url.search}${url.hash}` || '#';
      } catch (_) {
        return '#';
      }
    }
    async function openPanel() {
      panel.hidden = false;
      bell.setAttribute('aria-expanded', 'true');
      const list = document.getElementById('notifList');
      list.innerHTML = '<div class="notif-panel-empty">불러오는 중…</div>';
      const rows = await window.MagDB.notifications.list({ limit: 30 });
      if (!rows.length) {
        list.innerHTML = '<div class="notif-panel-empty">새 알림이 없어요.</div>';
        return;
      }
      list.innerHTML = rows.map(n => `
        <a class="notif-item${n.read_at ? '' : ' is-unread'}" href="${escapeHtml(safeInternalHref(n.link))}" data-id="${escapeHtml(n.id)}">
          <div class="notif-item-title">${escapeHtml(n.title)}</div>
          ${n.body ? `<div class="notif-item-body">${escapeHtml(n.body)}</div>` : ''}
          <div class="notif-item-time">${fmtAgo(n.created_at)}</div>
        </a>`).join('');
      // 알림을 누르면 사용자가 알림함을 확인한 것으로 보고 전체 읽음 처리 후 이동.
      // 링크 이동이 먼저 일어나면 비동기 markRead 요청이 취소될 수 있어 여기서 순서를 보장한다.
      list.querySelectorAll('.notif-item').forEach(el => {
        el.addEventListener('click', async (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
          e.preventDefault();
          const href = el.getAttribute('href') || '#';
          if (document.querySelector('#notifList .notif-item.is-unread')) {
            updateBadge(0);
            document.querySelectorAll('#notifList .notif-item.is-unread').forEach(item => item.classList.remove('is-unread'));
            const { error } = await window.MagDB.notifications.markAllRead();
            if (error) {
              refreshBadge();
            }
          }
          if (href && href !== '#') {
            window.location.href = href;
          } else {
            closePanel();
          }
        });
      });
    }
    function closePanel() {
      panel.hidden = true;
      bell.setAttribute('aria-expanded', 'false');
    }
    bell.addEventListener('click', (e) => {
      e.stopPropagation();
      if (panel.hidden) openPanel(); else closePanel();
    });
    document.addEventListener('click', (e) => {
      if (panel.hidden) return;
      if (panel.contains(e.target) || bell.contains(e.target)) return;
      closePanel();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) closePanel();
    });
    document.getElementById('notifAllRead').addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.MagDB.notifications.markAllRead();
      refreshBadge();
      // 패널이 열려있으면 list 의 is-unread 클래스 모두 제거
      document.querySelectorAll('#notifList .notif-item.is-unread').forEach(el => el.classList.remove('is-unread'));
    });

    // 초기 뱃지
    refreshBadge();

    // 실시간 — 새 알림 도착 시 뱃지 + 토스트
    try {
      await window.MagDB.realtime.subscribeNotifications((n) => {
        refreshBadge();
        if (typeof window.showToast === 'function') {
          window.showToast(n.title || '새 알림', { type: 'info', duration: 4200 });
        }
      });
    } catch (_) {}
  }

  // 푸시 알림 켜기/끄기 — 알림 패널 헤더 아래 행
  async function setupPushToggle() {
    const row = document.getElementById('notifPushRow');
    const btn = document.getElementById('notifPushToggle');
    if (!row || !btn) return;
    if (!window.MagDB?.push?.isSupported?.()) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    // iOS 는 PWA(홈 화면 추가) 에서만 푸시 지원 — 일반 Safari 에서는 가려둠
    const ua = navigator.userAgent || '';
    const isIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const standalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (isIos && !standalone) {
      row.hidden = false;
      btn.disabled = true;
      btn.textContent = 'iOS는 홈 화면 추가 후';
      btn.setAttribute('aria-disabled', 'true');
      return;
    }
    row.hidden = false;

    async function reflect() {
      const active = await window.MagDB.push.isActive();
      btn.textContent = active ? '끄기' : '켜기';
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('is-on', active);
    }
    reflect();

    const detail = document.getElementById('notifPushDetail');
    const confirmBtn = document.getElementById('notifPushConfirm');
    const cancelBtn = document.getElementById('notifPushCancel');

    async function doSubscribe() {
      btn.classList.add('is-busy');
      try {
        const result = await window.MagDB.push.subscribe();
        if (result?.error) showToast(result.error.message || '푸시 알림 구독 실패', { type: 'danger', duration: 6000 });
        else showToast('푸시 알림을 켰어요.', { type: 'info', duration: 2400 });
      } catch (e) {
        showToast(`[핸들러 예외] ${e?.message || e}`, { type: 'danger', duration: 6000 });
      } finally {
        btn.classList.remove('is-busy');
        reflect();
        if (detail) detail.hidden = true;
      }
    }

    btn.addEventListener('click', async () => {
      if (btn.classList.contains('is-busy')) return;
      const active = await window.MagDB.push.isActive();
      if (active) {
        // 켜진 상태 → 즉시 끄기 (확인 없이)
        btn.classList.add('is-busy');
        try {
          await window.MagDB.push.unsubscribe();
          showToast('푸시 알림을 껐어요.', { type: 'info', duration: 2400 });
        } finally {
          btn.classList.remove('is-busy');
          reflect();
        }
        return;
      }
      // 켜기 — 즉시 권한 요청 대신 안내 카드 펴기 (contextual opt-in)
      if (detail) detail.hidden = !detail.hidden;
    });

    if (confirmBtn) confirmBtn.addEventListener('click', doSubscribe);
    if (cancelBtn) cancelBtn.addEventListener('click', () => { if (detail) detail.hidden = true; });

    // SW 가 push subscription 을 재발급한 경우 (pushsubscriptionchange) 동기화
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', async (e) => {
        if (e.data?.type === 'push-resubscribed') {
          try { await window.MagDB.push.subscribe(); } catch (_) {}
          reflect();
        }
      });
    }
  }

  // ════════════════════════════════════════════════
  // Article scrap — 글 페이지에 "스크랩" 토글 버튼 자동 inject
  //   - 모든 stories/*.html 에 중복된 share-bar 마크업 그대로 두고
  //     site-common.js 가 페이지 로드 후 share-bar 첫 자리에 버튼 삽입
  //   - 글 식별자는 <section data-comments data-page-id="stories/<id>"> 에서 추출
  // ════════════════════════════════════════════════
  function setupFavoritePulse() {
    if (document.documentElement.dataset.favPulseBound === '1') return;
    document.documentElement.dataset.favPulseBound = '1';
    document.addEventListener('click', (e) => {
      const fav = e.target.closest('.film-fav, .article-fav, .lightbox-fav, .photo-lb-fav');
      if (!fav) return;
      fav.classList.remove('is-pulsing');
      // reflow 강제 → 같은 클래스 재추가 시 애니메이션이 재시작되도록
      void fav.offsetWidth;
      fav.classList.add('is-pulsing');
      setTimeout(() => fav.classList.remove('is-pulsing'), 420);
    }, true); // capture phase — 다른 핸들러의 stopPropagation 영향 받지 않음
  }

  function bookmarkIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4-6 4Z"/></svg>';
  }
  async function setupArticleScrap() {
    const cmt = document.querySelector('[data-comments][data-page-id]');
    if (!cmt) return;
    const pageId = cmt.dataset.pageId || '';
    if (!pageId.startsWith('stories/')) return;
    const articleId = pageId.replace(/^stories\//, '');
    if (!articleId) return;
    const shareBar = document.querySelector('.share-bar');
    if (!shareBar) return;

    // 버튼 inject — SHARE 라벨 바로 다음 자리
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'article-fav';
    btn.dataset.articleId = articleId;
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', '스크랩 추가');
    btn.innerHTML = bookmarkIconSvg() + '<span class="article-fav-label">스크랩</span>';
    const shareLabel = shareBar.querySelector('.share-label');
    if (shareLabel && shareLabel.nextSibling) {
      shareBar.insertBefore(btn, shareLabel.nextSibling);
    } else {
      shareBar.insertBefore(btn, shareBar.firstChild);
    }

    // 초기 상태 — db 준비 후 본인 즐겨찾기 확인
    let isFav = false;
    for (let i = 0; i < 60; i++) {
      if (window.MagDB && window.MagDB.isReady()) break;
      await new Promise(r => setTimeout(r, 50));
    }
    if (window.MagDB && window.MagDB.isReady()) {
      try {
        const sess = await window.MagDB.auth.getSession();
        if (sess) {
          const ids = await window.MagDB.favorites.idsForType('article');
          isFav = ids.has(articleId);
        }
      } catch (_) {}
    }
    setArticleFavState(btn, isFav);

    btn.addEventListener('click', async () => {
      if (btn.classList.contains('is-busy')) return;
      if (!window.MagDB || !window.MagDB.isReady()) {
        window.notify?.('잠시 후 다시 시도해주세요.', 'info');
        return;
      }
      const sess = await window.MagDB.auth.getSession();
      if (!sess) {
        if (!confirm('스크랩은 로그인이 필요해요. Google로 로그인할까요?')) return;
        window.MagDB.auth.signInWithGoogle(window.location.href.split('#')[0]);
        return;
      }
      const wasFav = btn.classList.contains('is-fav');
      setArticleFavState(btn, !wasFav);
      btn.classList.add('is-busy');
      const { error } = await window.MagDB.favorites.toggle('article', articleId, wasFav);
      btn.classList.remove('is-busy');
      if (error) {
        setArticleFavState(btn, wasFav);
        window.notify?.('처리 실패: ' + (error.message || '잠시 후 다시 시도'), 'danger');
      }
    });
  }
  function setArticleFavState(btn, on) {
    btn.classList.toggle('is-fav', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? '스크랩 해제' : '스크랩 추가');
    const label = btn.querySelector('.article-fav-label');
    if (label) label.textContent = on ? '스크랩됨' : '스크랩';
  }

  // ════════════════════════════════════════════════
  // 글 끝 SHARE 영역에 네이티브 공유 버튼만 자동 inject.
  //   링크 복사/Instagram은 HTML에 있고, X·카카오스토리 웹 공유는 UI를 단순화하기 위해 제외한다.
  // ════════════════════════════════════════════════
  function setupArticleShare() {
    const shareBar = document.querySelector('.share-bar');
    if (!shareBar || shareBar.dataset.shareEnhanced === '1') return;
    shareBar.dataset.shareEnhanced = '1';

    const shareUrl = prettyShareUrl(window.location.href.split('#')[0]);
    const title = (document.querySelector('.article-title')?.textContent || document.title || '5ft magazine').trim();
    const frag = document.createDocumentFragment();

    // 네이티브 공유 (모바일) — navigator.share 지원 시 우선 노출
    if (navigator.share) {
      const nativeBtn = document.createElement('button');
      nativeBtn.type = 'button';
      nativeBtn.className = 'share-channel share-channel--native';
      nativeBtn.textContent = '공유하기';
      nativeBtn.addEventListener('click', () => {
        navigator.share({ title, url: shareUrl }).catch(() => {});
      });
      frag.appendChild(nativeBtn);
    }
    shareBar.appendChild(frag);
  }

  // ════════════════════════════════════════════════
  // 스크롤 등장 — [data-reveal] 요소가 뷰포트에 들어오면 fade+slide-in.
  // 동적으로 렌더되는 카드까지 잡기 위해 MutationObserver 로 자동 재무장.
  // IntersectionObserver 미지원 또는 모션 줄임 선호 시 비활성(콘텐츠 그대로 노출).
  // ════════════════════════════════════════════════
  function initScrollReveal() {
    if (!('IntersectionObserver' in window)) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.documentElement.classList.add('js-reveal');

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          io.unobserve(entry.target);
        }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    function arm() {
      document.querySelectorAll('[data-reveal]:not([data-reveal-armed])').forEach((el) => {
        el.setAttribute('data-reveal-armed', '');
        io.observe(el);
      });
    }
    arm();

    let scheduled = false;
    const mo = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; arm(); });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // ════════════════════════════════════════════════
  // 글 읽기 진행바 — .article-body 가 있는 글 페이지에서만 상단 2px 바를 채운다.
  // ════════════════════════════════════════════════
  function initReadingProgress() {
    const article = document.querySelector('.article-body');
    if (!article) return;

    const bar = document.createElement('div');
    bar.className = 'reading-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);

    let ticking = false;
    function update() {
      ticking = false;
      const total = article.offsetHeight - window.innerHeight;
      const scrolled = -article.getBoundingClientRect().top;
      const ratio = total > 0 ? Math.min(Math.max(scrolled / total, 0), 1) : 0;
      bar.style.transform = `scaleX(${ratio})`;
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  // ════════════════════════════════════════════════
  // 공지 배너 — 활성 공지가 있으면 헤더 아래 마퀴로 표시.
  // localStorage 에 dismiss 한 ID 가 있으면 표시하지 않는다.
  // ════════════════════════════════════════════════
  const DISMISS_KEY = '5ftDismissedAnnouncements';
  function getDismissed() {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); }
    catch { return new Set(); }
  }
  function addDismissed(id) {
    try {
      const s = getDismissed(); s.add(id);
      // 누적 방지: 최근 50개만 보관
      const arr = Array.from(s).slice(-50);
      localStorage.setItem(DISMISS_KEY, JSON.stringify(arr));
    } catch {}
  }
  // 본문에서 `**굵게**` 만 <strong> 으로. 다른 HTML 은 모두 escape (XSS 방지).
  function renderAnnouncementBody(raw) {
    const escaped = String(raw || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    return escaped.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  }
  async function setupAnnouncementBar() {
    // MagDB / supabase 가 늦게 로드되는 페이지(index.html 처럼 site-common.js
    // 가 db-client.js 보다 먼저 defer 로 선언된 경우) 대비 polling.
    for (let i = 0; i < 50; i++) {
      if (window.MagDB && window.MagDB.announcements && window.MagDB.isReady && window.MagDB.isReady()) break;
      await new Promise(r => setTimeout(r, 100));
    }
    if (!window.MagDB || !window.MagDB.announcements) return;
    const { data } = await window.MagDB.announcements.current();
    if (!data) return;
    if (getDismissed().has(data.id)) return;
    const header = document.querySelector('body > header');
    if (!header) return;

    const bar = document.createElement('div');
    bar.className = 'announcement-bar';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `
      <div class="announcement-bar-inner">
        <div class="announcement-bar-track" aria-live="polite">
          <span class="announcement-bar-text"></span>
        </div>
        <button type="button" class="announcement-bar-close" aria-label="공지 닫기">×</button>
      </div>
    `;
    bar.querySelector('.announcement-bar-text').innerHTML = renderAnnouncementBody(data.body);
    header.insertAdjacentElement('afterend', bar);

    // 텍스트가 트랙보다 짧으면 마퀴 비활성 (가운데 정렬로 보임)
    requestAnimationFrame(() => {
      const text = bar.querySelector('.announcement-bar-text');
      const track = bar.querySelector('.announcement-bar-track');
      if (text.offsetWidth <= track.offsetWidth) bar.classList.add('is-static');
      else {
        // 텍스트 길이에 비례한 duration (느린 속도, 픽셀당 약 25ms)
        const distance = text.offsetWidth + track.offsetWidth;
        text.style.animationDuration = Math.max(12, distance / 40) + 's';
      }
    });

    bar.querySelector('.announcement-bar-close').addEventListener('click', () => {
      addDismissed(data.id);
      bar.classList.add('is-closing');
      setTimeout(() => bar.remove(), 220);
    });
  }

  // ════════════════════════════════════════════════
  // 인앱 브라우저 안내 — Naver / KakaoTalk / Instagram / Facebook / Line / Daum / Band 등
  // 인앱 웹뷰에서 Google OAuth 가 차단되므로 외부 브라우저 사용 안내.
  // 한 번 닫으면 localStorage 에 기록해 다시 안 뜸.
  // ════════════════════════════════════════════════
  const INAPP_DISMISS_KEY = '5ftInAppNoticeDismissed';
  function isInAppBrowser() {
    const ua = navigator.userAgent || '';
    return /NAVER|KAKAOTALK|Instagram|FBAN|FBAV|Line\/|Daum|BAND|Twitter/i.test(ua);
  }
  function setupInAppBrowserNotice() {
    if (!isInAppBrowser()) return;
    try { if (localStorage.getItem(INAPP_DISMISS_KEY) === '1') return; } catch {}
    const header = document.querySelector('body > header');
    if (!header) return;
    const bar = document.createElement('div');
    bar.className = 'inapp-notice-bar';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `
      <div class="inapp-notice-inner">
        <span class="inapp-notice-text"><strong>Google 로그인이 차단되었나요?</strong> 인앱 브라우저에선 Google 정책상 차단돼요. 우측 메뉴(⋮ 또는 ⋯) → <strong>Chrome · Safari 등 외부 브라우저로 열기</strong>를 눌러주세요.</span>
        <button type="button" class="inapp-notice-close" aria-label="안내 닫기">×</button>
      </div>
    `;
    header.insertAdjacentElement('afterend', bar);
    bar.querySelector('.inapp-notice-close').addEventListener('click', () => {
      try { localStorage.setItem(INAPP_DISMISS_KEY, '1'); } catch {}
      bar.classList.add('is-closing');
      setTimeout(() => bar.remove(), 220);
    });
  }


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
    fab.addEventListener('click', () => { try { trackEvent('fab_clicked', { kind: 'upload' }); } catch (_) {} });
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); bootPwa(); });
  } else {
    init();
    bootPwa();
  }
})();
