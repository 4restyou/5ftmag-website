'use strict';

// 5ft.mag 웹진 — 가로 책등 진열. 책등이 줄지어 있고(제목·호라벨), 휠·좌우 화살표·
// 스와이프·키보드로 옆으로 넘기면 선택된 책이 회전해 표지(전면)로 펼쳐진다.
// 펼쳐진 책의 "읽기" 또는 다시 누르면 PDF 원본을 새 탭으로(플립북은 다음 단계).
(function () {
  const rail = document.getElementById('wzRail');
  if (!rail) return;

  function db() { return window.MagDB; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  const SPINES = ['#2b2b2b', '#3a2f28', '#26303a', '#39283a', '#2f3a2c', '#3a3326'];
  let issues = [];
  let active = 0;
  let track = null;

  function render() {
    if (!issues.length) { rail.innerHTML = '<p class="wz-empty">아직 발행된 웹진이 없어요.</p>'; return; }
    const books = issues.map((it, i) => {
      const label = `${it.title}${it.issue_label ? ' · ' + it.issue_label : ''}`;
      const cover = it.cover_path
        ? `<img src="${esc(db().webzine.publicUrl(it.cover_path))}" alt="${esc(it.title)} 표지" loading="lazy" />`
        : `<span>${esc(it.title)}</span>`;
      return `<button type="button" class="wz-book3d" data-i="${i}" style="--spine:${SPINES[i % SPINES.length]}" aria-label="${esc(it.title)}">
        <span class="wz-face wz-spine"><span class="wz-spine-label">${esc(label)}</span></span>
        <span class="wz-face wz-cover ${it.cover_path ? '' : 'is-text'}">
          ${cover}
          <span class="wz-cover-cap">
            ${it.issue_label ? `<span class="wz-cover-issue">${esc(it.issue_label)}</span>` : ''}
            <span class="wz-cover-title">${esc(it.title)}</span>
          </span>
        </span>
      </button>`;
    }).join('');
    rail.innerHTML = `
      <button type="button" class="wz-nav wz-prev" aria-label="이전 책">‹</button>
      <div class="wz-track" id="wzTrack">${books}</div>
      <button type="button" class="wz-nav wz-next" aria-label="다음 책">›</button>
      <div class="wz-read" id="wzRead"></div>`;
    track = document.getElementById('wzTrack');
    bind();
    setActive(0, false);
  }

  function setActive(i, smooth = true) {
    active = Math.max(0, Math.min(issues.length - 1, i));
    const books = track.querySelectorAll('.wz-book3d');
    books.forEach((b, idx) => b.classList.toggle('is-active', idx === active));
    const el = books[active];
    if (el) {
      const center = () => { try { el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: smooth ? 'smooth' : 'auto' }); } catch (_) {} };
      center(); setTimeout(center, 420);
    }
    const it = issues[active];
    const href = it && it.pdf_path ? esc(db().webzine.publicUrl(it.pdf_path)) : '';
    document.getElementById('wzRead').innerHTML = href ? `<a href="${href}" target="_blank" rel="noopener">읽기 →</a>` : '';
    rail.querySelector('.wz-prev').disabled = active === 0;
    rail.querySelector('.wz-next').disabled = active === issues.length - 1;
  }

  function bind() {
    rail.querySelector('.wz-prev').addEventListener('click', () => setActive(active - 1));
    rail.querySelector('.wz-next').addEventListener('click', () => setActive(active + 1));

    track.querySelectorAll('.wz-book3d').forEach(b => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        if (i === active) { const it = issues[i]; if (it.pdf_path) window.open(db().webzine.publicUrl(it.pdf_path), '_blank', 'noopener'); }
        else setActive(i);
      });
    });

    // 휠: 세로/가로 스크롤을 책 넘김으로
    let wheelLock = false;
    track.addEventListener('wheel', (e) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(d) < 8) return;
      e.preventDefault();
      if (wheelLock) return;
      wheelLock = true; setTimeout(() => { wheelLock = false; }, 360);
      setActive(active + (d > 0 ? 1 : -1));
    }, { passive: false });

    // 키보드 ← →
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') setActive(active + 1);
      else if (e.key === 'ArrowLeft') setActive(active - 1);
    });

    // 스와이프(드래그)
    let sx = null;
    track.addEventListener('pointerdown', (e) => { sx = e.clientX; });
    track.addEventListener('pointerup', (e) => {
      if (sx == null) return;
      const dx = e.clientX - sx; sx = null;
      if (Math.abs(dx) > 50) setActive(active + (dx < 0 ? 1 : -1));
    });
  }

  (async function load() {
    for (let i = 0; i < 50; i++) { if (db() && db().isReady()) break; await new Promise(r => setTimeout(r, 50)); }
    try { issues = await db().webzine.listPublished(); } catch (_) { issues = []; }
    if (!Array.isArray(issues)) issues = [];
    render();
  })();
})();
