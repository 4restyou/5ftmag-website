// 5ft.mag — Lucide 호환 inline SVG 아이콘 사전
//   인라인 SVG 가 곳곳에 흩어져 있어 비례 일관성 ↓. 자주 쓰는 10종을 한곳에서.
//
// 사용:
//   <span class="icon"></span>  +  el.appendChild(window.icon('heart'))
//   또는 innerHTML: el.innerHTML = window.iconHTML('heart')
//
// 모든 아이콘은:
//   - viewBox="0 0 24 24"
//   - stroke="currentColor"  → color CSS 로 색 제어
//   - stroke-width="1.6"     → 기본. 호출 측에서 변경 가능
//   - fill="none"            → 아웃라인 only (active 상태에서 fill 부여)
//
// 기반: lucide.dev 의 경로 데이터 일부 (MIT)

(function () {
  'use strict';

  const PATHS = {
    'heart':       '<path d="M12 21s-7.5-4.5-9.5-9.5C1 7.5 4 4.5 7.5 4.5c2 0 3.6 1 4.5 2.5.9-1.5 2.5-2.5 4.5-2.5 3.5 0 6.5 3 5 7-2 5-9.5 9.5-9.5 9.5z"/>',
    'bookmark':    '<path d="M6 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4-6 4Z"/>',
    'share':       '<circle cx="6" cy="12" r="2.6"/><circle cx="17" cy="6" r="2.6"/><circle cx="17" cy="18" r="2.6"/><line x1="8.3" y1="10.7" x2="14.7" y2="7.2"/><line x1="8.3" y1="13.3" x2="14.7" y2="16.8"/>',
    'close':       '<path d="M6 6l12 12M18 6L6 18"/>',
    'menu':        '<path d="M5 7h14M5 12h14M5 17h14"/>',
    'search':      '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    'plus':        '<path d="M12 5v14M5 12h14"/>',
    'minus':       '<path d="M5 12h14"/>',
    'check':       '<path d="m5 12 5 5L20 7"/>',
    'arrow-right': '<path d="M5 12h14M13 5l7 7-7 7"/>',
    'arrow-left':  '<path d="M19 12H5M11 19l-7-7 7-7"/>',
    'chevron-down':'<path d="m6 9 6 6 6-6"/>',
    'chevron-up':  '<path d="m6 15 6-6 6 6"/>',
    'image':       '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    'photo-empty': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 16 5-5 5 5 4-4 4 4"/>',
    'film':        '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 9h4M2 15h4M18 9h4M18 15h4M6 3v18M18 3v18"/>',
    'edit':        '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    'trash':       '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/>',
    'alert':       '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    'info':        '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    'sun':         '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v3M12 18.5v3M4.5 4.5l2.1 2.1M17.4 17.4l2.1 2.1M2.5 12h3M18.5 12h3M4.5 19.5l2.1-2.1M17.4 6.6l2.1-2.1"/>',
    'moon':        '<path d="M20.5 14.2A7.8 7.8 0 0 1 9.8 3.5 8.7 8.7 0 1 0 20.5 14.2Z"/>',
  };

  function iconHTML(name, opts = {}) {
    const path = PATHS[name];
    if (!path) return '';
    const size  = opts.size  || 20;
    const width = opts.strokeWidth || 1.6;
    return (
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ` +
      `fill="none" stroke="currentColor" stroke-width="${width}" ` +
      `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
    );
  }
  function icon(name, opts) {
    const tpl = document.createElement('template');
    tpl.innerHTML = iconHTML(name, opts).trim();
    return tpl.content.firstChild;
  }

  window.iconHTML = iconHTML;
  window.icon = icon;
  window.ICONS = PATHS;
})();
