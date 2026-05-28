'use strict';

// 5ft.mag 웹진 — 책등이 정면으로 선 입체 진열. 한 권을 클릭하면 상세(호라벨·
// 제목·소개)를 표지(전면)와 함께 보여주고 "책 읽기"로 PDF 원본을 새 탭에 연다.
(function () {
  const rail = document.getElementById('wzRail');
  if (!rail) return;

  function db() { return window.MagDB; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const SPINES = ['#2b2b2b', '#3a2f28', '#26303a', '#39283a', '#2f3a2c', '#7a2540'];
  const spineOf = (i) => SPINES[i % SPINES.length];
  const coverUrl = (it) => (it.cover_path ? db().webzine.publicUrl(it.cover_path) : '');

  let issues = [];
  let detail = null;

  function spineBook(it, spine) {
    const cover = it.cover_path ? `<img src="${esc(coverUrl(it))}" alt="" loading="lazy" />` : '';
    return `<div class="wz-cuboid wz-spinebook" style="--spine:${spine}">
      <div class="f-spine">
        <span class="wz-spine-title">${esc(it.title)}</span>
        ${it.issue_label ? `<span class="wz-spine-issue">${esc(it.issue_label)}</span>` : ''}
      </div>
      <div class="f-cover">${cover}</div>
      <div class="f-top wz-pages"></div>
    </div>`;
  }

  function coverBook(it, spine) {
    const front = it.cover_path
      ? `<img src="${esc(coverUrl(it))}" alt="${esc(it.title)} 표지" />`
      : `<span class="wz-f-text">${esc(it.title)}</span>`;
    return `<div class="wz-cuboid wz-coverbook" style="--spine:${spine}">
      <div class="f-front">${front}</div>
      <div class="f-side"></div>
      <div class="f-top wz-pages"></div>
    </div>`;
  }

  function render() {
    if (!issues.length) { rail.innerHTML = '<p class="wz-empty">아직 발행된 웹진이 없어요.</p>'; return; }
    rail.innerHTML = `
      <button type="button" class="wz-nav wz-prev" aria-label="이전">‹</button>
      <div class="wz-track" id="wzTrack">
        ${issues.map((it, i) => `<button type="button" class="wz-book" data-i="${i}" aria-label="${esc(it.title)} 보기">${spineBook(it, spineOf(i))}</button>`).join('')}
      </div>
      <button type="button" class="wz-nav wz-next" aria-label="다음">›</button>`;
    const track = document.getElementById('wzTrack');
    track.querySelectorAll('.wz-book').forEach(b => b.addEventListener('click', () => openDetail(Number(b.dataset.i))));
    rail.querySelector('.wz-prev').addEventListener('click', () => track.scrollBy({ left: -360, behavior: 'smooth' }));
    rail.querySelector('.wz-next').addEventListener('click', () => track.scrollBy({ left: 360, behavior: 'smooth' }));
    track.addEventListener('wheel', (e) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(d) < 4) return;
      e.preventDefault();
      track.scrollLeft += d;
    }, { passive: false });
  }

  function ensureDetail() {
    if (detail) return;
    detail = document.createElement('div');
    detail.className = 'wz-detail';
    detail.id = 'wzDetail';
    detail.innerHTML = `
      <button type="button" class="wz-detail-close" aria-label="닫기">✕</button>
      <div class="wz-detail-inner">
        <div class="wz-detail-stage" id="wzDetailStage"></div>
        <div class="wz-detail-info" id="wzDetailInfo"></div>
      </div>`;
    document.body.appendChild(detail);
    const close = () => { detail.classList.remove('open'); document.body.style.overflow = ''; };
    detail.querySelector('.wz-detail-close').addEventListener('click', close);
    detail.addEventListener('click', (e) => { if (e.target === detail) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && detail.classList.contains('open')) close(); });
  }

  function openDetail(i) {
    const it = issues[i]; if (!it) return;
    ensureDetail();
    const spine = spineOf(i);
    detail.style.setProperty('--detail-bg', `color-mix(in srgb, ${spine} 42%, #14100f)`);
    document.getElementById('wzDetailStage').innerHTML = coverBook(it, spine);
    const read = it.pdf_path ? esc(db().webzine.publicUrl(it.pdf_path)) : '';
    document.getElementById('wzDetailInfo').innerHTML = `
      ${it.issue_label ? `<span class="wz-detail-issue">${esc(it.issue_label)}</span>` : ''}
      <h2 class="wz-detail-title">${esc(it.title)}</h2>
      ${it.description ? `<p class="wz-detail-desc">${esc(it.description)}</p>` : ''}
      ${read ? `<a class="wz-detail-read" href="${read}" target="_blank" rel="noopener">책 읽기 →</a>` : ''}`;
    detail.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  (async function load() {
    for (let i = 0; i < 50; i++) { if (db() && db().isReady()) break; await new Promise(r => setTimeout(r, 50)); }
    try { issues = await db().webzine.listPublished(); } catch (_) { issues = []; }
    if (!Array.isArray(issues)) issues = [];
    render();
  })();
})();
