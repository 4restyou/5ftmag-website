// 공통 상태 컴포넌트 — 로딩 / 빈 / 에러 를 사이트 전역에서 같은 마크업·톤으로.
//   window.MagState.loading(opts)  → 스켈레톤 또는 텍스트 로딩 HTML 문자열
//   window.MagState.empty(opts)    → 빈 상태 HTML (안내 + 선택적 다음 행동 버튼)
//   window.MagState.error(opts)    → 에러 HTML (안내 + 다시 시도 버튼)
//   window.MagState.bindAction(scope, action, handler) → data-state-action 버튼에 핸들러 연결
//
// 의도적으로 의존성 없이 순수 문자열을 돌려줘, 각 페이지의 grid.innerHTML 에 그대로 꽂을 수 있게 한다.
(function () {
  'use strict';

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
  }

  // 로딩: 스켈레톤 카드 n개 (skeleton 클래스는 common.css). variant 로 썸네일 비율 선택.
  function loading(opts) {
    const o = opts || {};
    const count = o.count || 6;
    const variant = o.variant || 'wide'; // wide | square | 4x3
    const thumbCls = variant === 'square' ? 'skeleton-thumb--square'
      : variant === 'wide' ? 'skeleton-thumb--wide' : '';
    const card = `<div class="mag-state-skeleton" aria-hidden="true">`
      + `<div class="skeleton skeleton-thumb ${thumbCls}"></div>`
      + `<div class="skeleton skeleton-line" style="width:70%"></div>`
      + `<div class="skeleton skeleton-line" style="width:40%"></div>`
      + `</div>`;
    return `<div class="mag-state mag-state--loading" role="status" aria-live="polite">`
      + `<span class="sr-only">${esc(o.label || '불러오는 중…')}</span>`
      + card.repeat(count)
      + `</div>`;
  }

  // 빈 상태: 안내 + (선택) 다음 행동 버튼. action 이 있으면 data-state-action 으로 표시.
  function empty(opts) {
    const o = opts || {};
    const title = o.title || '아직 표시할 내용이 없어요.';
    const desc = o.desc ? `<p class="mag-state-desc">${esc(o.desc)}</p>` : '';
    const cta = o.actionLabel
      ? `<button type="button" class="mag-state-btn" data-state-action="${esc(o.action || 'reset')}">${esc(o.actionLabel)}</button>`
      : '';
    return `<div class="mag-state mag-state--empty">`
      + `<p class="mag-state-title">${esc(title)}</p>`
      + desc + cta
      + `</div>`;
  }

  // 에러 상태: 안내 + 다시 시도 버튼 (기본 라벨 '다시 시도').
  function error(opts) {
    const o = opts || {};
    const title = o.title || '불러오지 못했어요.';
    const desc = o.desc ? `<p class="mag-state-desc">${esc(o.desc)}</p>`
      : `<p class="mag-state-desc">네트워크 상태를 확인한 뒤 다시 시도해 주세요.</p>`;
    const retry = o.noRetry ? ''
      : `<button type="button" class="mag-state-btn" data-state-action="${esc(o.action || 'retry')}">${esc(o.actionLabel || '다시 시도')}</button>`;
    return `<div class="mag-state mag-state--error" role="alert">`
      + `<p class="mag-state-title">${esc(title)}</p>`
      + desc + retry
      + `</div>`;
  }

  // scope 안의 data-state-action="<action>" 버튼 클릭에 handler 연결 (1회성 위임).
  function bindAction(scope, action, handler) {
    if (!scope) return;
    const btn = scope.querySelector(`[data-state-action="${action}"]`);
    if (btn) btn.addEventListener('click', handler, { once: true });
  }

  window.MagState = { loading, empty, error, bindAction };
})();
