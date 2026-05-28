'use strict';

// 5ft.mag 웹진 책장 — 발행된 호의 표지를 그리드로, 호버 시 입체 틸트.
// 표지 클릭은 현재 PDF 원본을 새 탭으로 연다(플립북 뷰어는 다음 단계).
(function () {
  const shelf = document.getElementById('wzShelf');
  if (!shelf) return;

  function db() { return window.MagDB; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function render(issues) {
    if (!issues.length) { shelf.innerHTML = '<p class="wz-empty">아직 발행된 웹진이 없어요.</p>'; return; }
    shelf.innerHTML = issues.map(it => {
      const href = it.pdf_path ? esc(db().webzine.publicUrl(it.pdf_path)) : '#';
      const cover = it.cover_path
        ? `<span class="wz-book-cover"><img src="${esc(db().webzine.publicUrl(it.cover_path))}" alt="${esc(it.title)} 표지" loading="lazy" /></span>`
        : `<span class="wz-book-cover is-text"><span>${esc(it.title)}</span></span>`;
      return `<a class="wz-book" href="${href}" target="_blank" rel="noopener" data-tilt>
        ${cover}
        <span class="wz-book-meta">
          ${it.issue_label ? `<span class="wz-book-issue">${esc(it.issue_label)}</span>` : ''}
          <span class="wz-book-title">${esc(it.title)}</span>
        </span>
      </a>`;
    }).join('');
    bindTilt();
  }

  function bindTilt() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    shelf.querySelectorAll('[data-tilt]').forEach(card => {
      const cover = card.querySelector('.wz-book-cover');
      if (!cover) return;
      card.addEventListener('pointermove', (e) => {
        const r = cover.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        cover.style.setProperty('--ry', `${(px * 14).toFixed(2)}deg`);
        cover.style.setProperty('--rx', `${(-py * 12).toFixed(2)}deg`);
      });
      card.addEventListener('pointerleave', () => {
        cover.style.setProperty('--ry', '0deg');
        cover.style.setProperty('--rx', '0deg');
      });
    });
  }

  (async function load() {
    for (let i = 0; i < 50; i++) { if (db() && db().isReady()) break; await new Promise(r => setTimeout(r, 50)); }
    let issues = [];
    try { issues = await db().webzine.listPublished(); } catch (_) {}
    render(Array.isArray(issues) ? issues : []);
  })();
})();
