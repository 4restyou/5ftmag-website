// border-beam 드롭인 — 검색바·입력창·주요 CTA 테두리에 회전 빔.
// 원본: https://github.com/Jakubantalik/border-beam (MIT). CSS 는 css/border-beam.css (생성본).
//
// 제거: 각 페이지의 <script ... border-beam.js> 한 줄과 이 파일 + css/border-beam.css 만 지우면 끝.
// 대상 조정: 아래 SELECTORS 배열만 고치면 된다. 특정 요소 제외는 조상에 class="no-beam".
(function () {
  'use strict';
  if (window.__borderBeamInit) return;
  window.__borderBeamInit = true;

  // currentScript 는 최상위 실행 중에만 유효 → 지금 캡처
  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';

  // 빔을 두를 대상 (검색바 / 입력창 / 주요 CTA)
  var SELECTORS = [
    // 검색바
    '.ft-search-bar', '.mh-search-bar',
    // 입력창 (사용자 대면 폼)
    'input[type="search"]', 'input[type="text"]', 'input[type="email"]', 'input[type="number"]',
    // 주요 CTA 버튼
    '.join-cta', '.me-btn-primary', '.mkt-btn-primary', '.rs-btn-primary',
    '.shop-more-cta-btn', '.wz-reader-cta', '.search-submit'
  ];

  var roots = []; // 빔이 적용된 요소들 (테마 전환 시 토큰 갱신용)

  function token() {
    return 'bb_colorful_' + (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  }

  // 이 스크립트 위치 기준으로 CSS 를 주입 (경로 자동 해석)
  function injectCSS() {
    try {
      var src = SCRIPT_SRC;
      var href = src.replace(/js\/border-beam\.js.*$/, 'css/border-beam.css');
      if (!href || href === src) href = 'css/border-beam.css';
      if (document.querySelector('link[data-border-beam]')) return;
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-border-beam', '');
      document.head.appendChild(link);
    } catch (e) { /* noop */ }
  }

  function skip(el) {
    if (el.dataset.beam != null) return true;                 // 이미 적용
    if (el.closest('[data-beam]')) return true;                // 이미 빔 안
    if (el.closest('.no-beam')) return true;                   // 명시적 제외
    if (el.type === 'hidden') return true;
    var r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 24) return true;            // 너무 작음/숨김
    return false;
  }

  function activate(el) {
    el.dataset.beam = token();
    el.dataset.active = '';
    el.style.setProperty('--beam-strength', '1');
    var bloom = document.createElement('div');
    bloom.setAttribute('data-beam-bloom', '');
    el.appendChild(bloom);
    roots.push(el);
  }

  function applyBeam(el) {
    if (skip(el)) return;
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      // 자식을 못 넣는 요소 → 래퍼로 감싼다
      var cs = window.getComputedStyle(el);
      var wrap = document.createElement('span');
      wrap.className = 'bb-wrap';
      var inline = cs.display === 'inline' || cs.display === 'inline-block';
      wrap.style.display = inline ? 'inline-block' : 'block';
      if (!inline) wrap.style.width = '100%';
      el.parentNode.insertBefore(wrap, el);
      wrap.appendChild(el);
      el.style.width = '100%';
      el.style.borderRadius = 'inherit';
      activate(wrap);
    } else {
      // div / button 등 컨테이너 → 제자리 적용
      activate(el);
    }
  }

  function scan(rootEl) {
    var scope = rootEl || document;
    SELECTORS.forEach(function (sel) {
      var nodes;
      try { nodes = scope.querySelectorAll(sel); } catch (e) { return; }
      Array.prototype.forEach.call(nodes, applyBeam);
    });
  }

  function retheme() {
    var t = token();
    roots.forEach(function (el) { if (el.isConnected) el.dataset.beam = t; });
  }

  var rescanTimer;
  function scheduleScan() {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(function () { scan(document); }, 250);
  }

  function start() {
    injectCSS();
    scan(document);
    // 테마 전환 감지 → 빔 색 토큰 갱신
    new MutationObserver(retheme).observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-theme']
    });
    // 늦게 뜨는(hidden 해제) 검색바·JS 로 주입되는 카드/CTA 감지 → 재스캔 (디바운스)
    new MutationObserver(scheduleScan).observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['hidden']
    });
    window.addEventListener('load', scheduleScan);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
