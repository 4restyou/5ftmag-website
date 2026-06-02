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

  window.MagUtil = Object.freeze({
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
  });
})();
