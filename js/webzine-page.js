'use strict';

// 5ft.mag 웹진 — 한 호씩 큰 표지 + 소개로 보여주는 세로 쇼케이스.
// 좌우 교차, 스크롤 진입 reveal, 표지 호버 틸트. 표지/CTA 클릭은 현재 PDF
// 원본을 새 탭으로 연다(플립북 뷰어는 다음 단계).
(function () {
  const wrap = document.getElementById('wzShowcase');
  if (!wrap) return;

  function db() { return window.MagDB; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function render(issues) {
    if (!issues.length) { wrap.innerHTML = '<p class="wz-empty">아직 발행된 웹진이 없어요.</p>'; return; }
    wrap.innerHTML = issues.map(it => {
      const href = it.pdf_path ? esc(db().webzine.publicUrl(it.pdf_path)) : '#';
      const cover = it.cover_path
        ? `<span class="wz-book-cover"><img src="${esc(db().webzine.publicUrl(it.cover_path))}" alt="${esc(it.title)} 표지" loading="lazy" /></span>`
        : `<span class="wz-book-cover is-text"><span>${esc(it.title)}</span></span>`;
      return `<article class="wz-feature" data-reveal>
        <a class="wz-feature-book" href="${href}" target="_blank" rel="noopener" data-tilt aria-label="${esc(it.title)} 읽기">${cover}</a>
        <div class="wz-feature-text">
          ${it.issue_label ? `<span class="wz-feature-issue">${esc(it.issue_label)}</span>` : ''}
          <h2 class="wz-feature-title">${esc(it.title)}</h2>
          ${it.description ? `<p class="wz-feature-desc">${esc(it.description)}</p>` : ''}
          <a class="wz-feature-cta" href="${href}" target="_blank" rel="noopener">읽기 →</a>
        </div>
      </article>`;
    }).join('');
    bindReveal();
    bindTilt();
  }

  function bindReveal() {
    const features = wrap.querySelectorAll('[data-reveal]');
    if (!('IntersectionObserver' in window)) { features.forEach(f => f.classList.add('is-in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -10% 0px' });
    features.forEach(f => io.observe(f));
  }

  function bindTilt() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    wrap.querySelectorAll('[data-tilt]').forEach(card => {
      const cover = card.querySelector('.wz-book-cover');
      if (!cover) return;
      card.addEventListener('pointermove', (e) => {
        const r = cover.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        cover.style.setProperty('--ry', `${(px * 16).toFixed(2)}deg`);
        cover.style.setProperty('--rx', `${(-py * 12).toFixed(2)}deg`);
      });
      card.addEventListener('pointerleave', () => {
        cover.style.setProperty('--ry', '-8deg');
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
