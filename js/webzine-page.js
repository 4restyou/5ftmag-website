'use strict';

// 5ft.mag 웹진 — 어두운 갤러리에 책등이 정면으로 선 진열. 책등 색은 표지의
// 대표색에서 뽑아 맞추고(글자색은 명암에 따라 흑/백 자동), 한 권을 클릭하면
// 상세(표지 + 호라벨·제목·소개)와 "책 읽기"(PDF 원본 새 탭)를 보여준다.
(function () {
  const rail = document.getElementById('wzRail');
  if (!rail) return;

  function db() { return window.MagDB; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const FALLBACK = ['#2b2b2b', '#3a2f28', '#26303a', '#39283a', '#2f3a2c', '#7a2540'];
  const coverUrl = (it) => (it.cover_path ? db().webzine.publicUrl(it.cover_path) : '');

  let issues = [];
  const palette = [];   // { spine, text } per issue (대표색)
  let detail = null;

  // 표지 대표색(평균) 추출 — 같은 출처(public storage, CORS 허용) 이미지에서.
  function pickColor(url) {
    return new Promise((resolve) => {
      if (!url) { resolve(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const cv = document.createElement('canvas'); cv.width = 16; cv.height = 16;
          const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, 16, 16);
          const d = ctx.getImageData(0, 0, 16, 16).data;
          let r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
          if (!n) { resolve(null); return; }
          r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          resolve({ spine: `rgb(${r},${g},${b})`, text: lum > 0.6 ? '#1a1a1a' : '#fff' });
        } catch (_) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function spineBook(it, c) {
    const cover = it.cover_path ? `<img src="${esc(coverUrl(it))}" alt="" loading="lazy" />` : '';
    return `<div class="wz-cuboid wz-spinebook" style="--spine:${c.spine};--spine-text:${c.text}">
      <div class="f-spine">
        <span class="wz-spine-title">${esc(it.title)}</span>
        ${it.issue_label ? `<span class="wz-spine-issue">${esc(it.issue_label)}</span>` : ''}
      </div>
      <div class="f-cover">${cover}</div>
      <div class="f-top wz-pages"></div>
    </div>`;
  }

  function coverBook(it, c) {
    const front = it.cover_path
      ? `<img src="${esc(coverUrl(it))}" alt="${esc(it.title)} 표지" />`
      : `<span class="wz-f-text">${esc(it.title)}</span>`;
    return `<div class="wz-cuboid wz-coverbook" style="--spine:${c.spine}">
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
        ${issues.map((it, i) => `<button type="button" class="wz-book" data-i="${i}" aria-label="${esc(it.title)} 보기">${spineBook(it, palette[i])}</button>`).join('')}
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

    // 표지 대표색을 비동기로 뽑아 책등 색 갱신
    issues.forEach((it, i) => {
      if (!it.cover_path) return;
      pickColor(coverUrl(it)).then(c => {
        if (!c) return;
        palette[i] = c;
        const el = track.querySelector(`.wz-book[data-i="${i}"] .wz-spinebook`);
        if (el) { el.style.setProperty('--spine', c.spine); el.style.setProperty('--spine-text', c.text); }
      });
    });
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
    const c = palette[i];
    detail.style.setProperty('--detail-bg', `color-mix(in srgb, ${c.spine} 42%, #110d10)`);
    document.getElementById('wzDetailStage').innerHTML = coverBook(it, c);
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
    issues.forEach((_, i) => { palette[i] = { spine: FALLBACK[i % FALLBACK.length], text: '#fff' }; });
    render();
  })();
})();
