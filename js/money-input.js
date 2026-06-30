'use strict';

// 금액 입력 천단위 구분 — admin 폼 공용.
// 대상: <input data-money>  (type="text" inputmode="numeric" 권장)
//   - 입력하는 동안 1,000 단위 콤마 자동 삽입 (정수만)
//   - 저장 시 MoneyInput.parse(value) 로 정수 복원 (콤마 제거)
//   - 폼에 값 채울 때 MoneyInput.format(number) 로 표시
//
// window.MoneyInput = { parse, format, enhance, initAll }

(function () {
  function parse(v) {
    const digits = String(v == null ? '' : v).replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : null;
  }
  function format(v) {
    const n = parse(v);
    return n == null ? '' : n.toLocaleString('en-US'); // 1,000 단위 콤마
  }

  function enhance(el) {
    if (!el || el.__moneyBound) return;
    el.__moneyBound = true;
    el.addEventListener('input', function () {
      // 콤마 재삽입하면서 캐럿 위치(앞쪽 숫자 개수 기준) 보존
      const caret = el.selectionStart || 0;
      const digitsBefore = el.value.slice(0, caret).replace(/[^\d]/g, '').length;
      el.value = format(el.value);
      let pos = 0, seen = 0;
      while (pos < el.value.length && seen < digitsBefore) {
        if (/\d/.test(el.value[pos])) seen++;
        pos++;
      }
      try { el.setSelectionRange(pos, pos); } catch (_) {}
    });
    el.value = format(el.value);
  }

  function initAll(root) {
    (root || document).querySelectorAll('input[data-money]').forEach(enhance);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initAll(document); });
  } else {
    initAll(document);
  }

  window.MoneyInput = { parse, format, enhance, initAll };
})();
