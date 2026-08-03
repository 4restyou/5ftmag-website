// 5ft.mag 공통 유틸 — escapeHtml / escapeAttr 등 자주 중복되던 함수를 한 곳에 둔다.
// 사용처에서는 IIFE 안에 `const escapeHtml = window.MagUtil.escapeHtml;` 같이
// alias 로 받아 쓰면 호출 위치 변경 없이 정의만 통합된다.
//
// site-common.js 보다 먼저 로드돼야 한다 (page-specific js 가 site-common.js 로드 시점에
// 이미 정의돼 있다고 가정하므로). HTML 의 script 태그 순서 유지 필수.

(function () {
  'use strict';

  // HTML 안에 텍스트로 안전하게 박을 때 사용 (&<>"' 만 entity 화).
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]);
    });
  }

  // HTML 속성값에 박을 때 사용. 현재 구현은 escapeHtml 과 동일하지만,
  // 시맨틱 분리를 위해 별도 함수로 노출한다 (필요 시 향후 발산 가능).
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  // 필름·카메라 라벨 정규화 — 공백/하이픈/언더스코어/괄호/슬래시/점/+ 제거 + 소문자.
  // 검색·alias 매칭에서 "Portra 400" / "portra400" / "PORTRA-400" 을 같은 키로 묶는다.
  // 한글은 그대로 보존 (포트라 400 / 포트라400 도 같이 정규화됨).
  function normalizeFilmLabel(s) {
    return String(s ?? '').toLowerCase().replace(/[\s\-_+()/.]+/g, '');
  }

  function seoulTodayIso(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date || new Date());
    const byType = Object.fromEntries(parts.map(function (part) { return [part.type, part.value]; }));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }

  // published=true 여도 한국 시간 기준 게시일 전에는 공개 화면에 노출하지 않는다.
  function isPublishedContent(item, todayIso) {
    if (!item || item.published === false) return false;
    const date = String(item.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return true;
    const today = typeof todayIso === 'string' ? todayIso : seoulTodayIso();
    return date <= today;
  }

  // 가격 표기 통합. 페이지마다 따로 구현돼 같은 금액이 다르게 보이던 것을 하나로.
  //   opts.empty    — 값이 없거나 0 이하일 때 표시 (기본 '')
  //   opts.keepText — 숫자가 아닌 값("가격 협의" 등)을 원문 그대로 살릴지 (기본 false)
  // keepText 경로는 사용자 입력이므로 escapeHtml 로 감싼다.
  function formatPrice(value, opts) {
    const empty = opts && 'empty' in opts ? opts.empty : '';
    const keepText = !!(opts && opts.keepText);
    const raw = String(value ?? '').trim();
    if (!raw) return empty;
    const n = Number(raw.replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(n) || n <= 0) return keepText ? escapeHtml(raw) : empty;
    return n.toLocaleString('ko-KR') + '원';
  }

  window.MagUtil = Object.freeze({
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    normalizeFilmLabel: normalizeFilmLabel,
    seoulTodayIso: seoulTodayIso,
    isPublishedContent: isPublishedContent,
    formatPrice: formatPrice,
  });
})();
