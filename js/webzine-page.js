'use strict';

// 5ft.mag 웹진 — 어두운 갤러리에 책등이 한 줄로 서고, 좌우로 부드럽게 미끄러진다
// (스와이프·휠·화살표·좌우키). 트랙은 한 번만 그리고 transform 으로 이동해 끊김이 없다.
// 가운데 책을 고르면 같은 무대에서 표지가 돌아 펼쳐지고(카드 없이), 옆에 호라벨·제목·
// 소개·"책 읽기"(PDF flipbook)가 뜬다. 색은 표지 대표색(채도 가중 + HSL 보정).
(function () {
  const flow = document.getElementById('wzFlow');
  if (!flow) return;

  function db() { return window.MagDB; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const FALLBACK = ['#7a3b52', '#3f5a78', '#6b5036', '#4a6b4f', '#5a4a78', '#8a4a32'];
  const coverUrl = (it) => (it.cover_path ? db().webzine.publicUrl(it.cover_path) : '');

  let issues = [];
  const palette = [];
  let active = 0, opened = false;
  let track = null, slots = [];

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    const l = (mx + mn) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  function vivid(r, g, b) {
    let [h, s, l] = rgbToHsl(r, g, b);
    s = Math.min(1, s * 1.4 + 0.08);
    l = Math.min(0.6, Math.max(0.34, l));
    const [R, G, B] = hslToRgb(h, s, l);
    const lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
    return { spine: `rgb(${R},${G},${B})`, text: lum > 0.62 ? '#1a1a1a' : '#fff' };
  }
  function pickColor(url) {
    return new Promise((resolve) => {
      if (!url) { resolve(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const S = 24;
          const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
          const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, S, S);
          const d = ctx.getImageData(0, 0, S, S).data;
          let r = 0, g = 0, b = 0, w = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 128) continue;
            const R = d[i], G = d[i + 1], B = d[i + 2];
            const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
            const k = 0.25 + (mx ? (mx - mn) / mx : 0);
            r += R * k; g += G * k; b += B * k; w += k;
          }
          if (!w) { resolve(null); return; }
          resolve(vivid(r / w, g / w, b / w));
        } catch (_) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function spineBook(it, c) {
    return `<div class="wz-cuboid wz-spinebook" style="--spine:${c.spine};--spine-text:${c.text}">
      <div class="f-spine">
        <span class="wz-spine-title">${esc(it.title)}</span>
        ${it.issue_label ? `<span class="wz-spine-issue">${esc(it.issue_label)}</span>` : ''}
      </div>
      <div class="f-cover"></div>
      <div class="f-top wz-pages"></div>
    </div>`;
  }
  function coverBook(it, c) {
    const front = it.cover_path
      ? `<img src="${esc(coverUrl(it))}" alt="${esc(it.title)} 표지" />`
      : `<span class="wz-f-text">${esc(it.title)}</span>`;
    return `<div class="wz-cuboid wz-coverbook" style="--spine:${c.spine}">
      <div class="f-front">${front}</div>
      <div class="f-edge wz-pages"></div>
      <div class="f-top wz-pages"></div>
    </div>`;
  }
  function infoHtml(it) {
    const read = it.pdf_path ? esc(db().webzine.publicUrl(it.pdf_path)) : '';
    return `${it.issue_label ? `<span class="wz-meta-issue">${esc(it.issue_label)}</span>` : ''}
      <h2 class="wz-meta-title">${esc(it.title)}</h2>
      ${it.description ? `<p class="wz-meta-desc">${esc(it.description)}</p>` : ''}
      ${read ? `<a class="wz-meta-read" href="${read}" target="_blank" rel="noopener">책 읽기 →</a>` : ''}`;
  }

  // 트랙(책등 줄)과 펼침 오버레이를 한 번만 만든다. 이후 이동은 transform 만 바꾼다.
  function render() {
    if (!issues.length) { flow.innerHTML = '<p class="wz-empty">아직 발행된 웹진이 없어요.</p>'; return; }
    flow.classList.add('no-anim');
    flow.innerHTML = `
      <button type="button" class="wz-nav wz-prev" aria-label="이전 호">‹</button>
      <div class="wz-track" id="wzTrack">
        ${issues.map((it, i) => `<button type="button" class="wz-slot" data-i="${i}" aria-label="${esc(it.title)} 보기">${spineBook(it, palette[i])}</button>`).join('')}
      </div>
      <button type="button" class="wz-nav wz-next" aria-label="다음 호">›</button>
      <div class="wz-open" id="wzOpen" aria-hidden="true">
        <button type="button" class="wz-open-back" id="wzOpenBack">← 목록으로</button>
        <div class="wz-open-grid">
          <button type="button" class="wz-open-cover" id="wzOpenCover" aria-label="목록으로"></button>
          <div class="wz-flow-info" id="wzOpenInfo"></div>
        </div>
      </div>`;
    track = document.getElementById('wzTrack');
    slots = Array.from(track.querySelectorAll('.wz-slot'));
    slots.forEach((s, i) => s.addEventListener('click', () => onSlot(i)));
    flow.querySelector('.wz-prev').addEventListener('click', () => nav(-1));
    flow.querySelector('.wz-next').addEventListener('click', () => nav(1));
    document.getElementById('wzOpenBack').addEventListener('click', closeBook);
    document.getElementById('wzOpenCover').addEventListener('click', closeBook);

    flow.addEventListener('wheel', (e) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(d) < 6) return;
      e.preventDefault();
      nav(d > 0 ? 1 : -1);
    }, { passive: false });
    let tx = null;
    flow.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; }, { passive: true });
    flow.addEventListener('touchend', (e) => {
      if (tx == null) return;
      const dx = e.changedTouches[0].clientX - tx; tx = null;
      if (Math.abs(dx) > 40) nav(dx < 0 ? 1 : -1);
    }, { passive: true });

    layout();
    requestAnimationFrame(() => flow.classList.remove('no-anim'));
  }

  function layout() {
    if (!track || !slots.length) return;
    const s = slots[active];
    track.style.transform = `translateX(${flow.clientWidth / 2 - (s.offsetLeft + s.offsetWidth / 2)}px)`;
    slots.forEach((slot, i) => {
      const d = i - active, ad = Math.abs(d);
      const book = slot.querySelector('.wz-spinebook');
      if (book) book.style.transform = `scale(${d === 0 ? 1.14 : 0.86})`;
      slot.style.opacity = String(Math.max(0, 1 - ad * 0.16));   // 멀수록 흐려지며 ~6권 옆까지 보임
      slot.style.pointerEvents = ad > 6 ? 'none' : 'auto';
    });
    flow.style.setProperty('--wz-glow', palette[active].spine);
    const prev = flow.querySelector('.wz-prev'), next = flow.querySelector('.wz-next');
    if (prev) prev.disabled = active <= 0;
    if (next) next.disabled = active >= issues.length - 1;
  }

  function fillOpen() {
    const it = issues[active], c = palette[active];
    document.getElementById('wzOpenCover').innerHTML = coverBook(it, c);
    document.getElementById('wzOpenInfo').innerHTML = infoHtml(it);
    const read = document.querySelector('#wzOpenInfo .wz-meta-read');
    if (read) read.addEventListener('click', (e) => {
      if (!window.WebzineReader) return;
      e.preventDefault();
      window.WebzineReader.open(read.href, it.title);
    });
  }

  function nav(d) {
    const n = active + d;
    if (n < 0 || n >= issues.length || n === active) return;
    active = n;
    if (opened) fillOpen();
    layout();
  }
  function onSlot(i) {
    if (i === active) openBook();
    else { active = i; layout(); }
  }
  function openBook() { opened = true; fillOpen(); flow.classList.add('is-open'); }
  function closeBook() { opened = false; flow.classList.remove('is-open'); }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && opened) closeBook();
    else if (e.key === 'ArrowRight') nav(1);
    else if (e.key === 'ArrowLeft') nav(-1);
  });
  window.addEventListener('resize', () => { const p = flow.classList.contains('no-anim'); flow.classList.add('no-anim'); layout(); if (!p) requestAnimationFrame(() => flow.classList.remove('no-anim')); });

  (async function load() {
    for (let i = 0; i < 50; i++) { if (db() && db().isReady()) break; await new Promise(r => setTimeout(r, 50)); }
    try { issues = await db().webzine.listPublished(); } catch (_) { issues = []; }
    if (!Array.isArray(issues)) issues = [];
    issues.forEach((_, i) => { palette[i] = { spine: FALLBACK[i % FALLBACK.length], text: '#fff' }; });
    render();

    issues.forEach((it, i) => {
      if (!it.cover_path) return;
      pickColor(coverUrl(it)).then(c => {
        if (!c) return;
        palette[i] = c;
        const sb = slots[i] && slots[i].querySelector('.wz-spinebook');
        if (sb) { sb.style.setProperty('--spine', c.spine); sb.style.setProperty('--spine-text', c.text); }
        if (i === active) { flow.style.setProperty('--wz-glow', c.spine); if (opened) fillOpen(); }
      });
    });
  })();
})();
