'use strict';

// 5ft.mag 웹진 — 분류(시즌)별로 한 줄(가로 책장)씩 세로로 쌓아 보여준다. 같은 분류의
// 호들이 한 줄에 모이고, 줄 위에 분류명이 제목으로 붙는다. 좌우로 넘겨 책등을 훑고,
// 한 권을 고르면 같은 색의 무대에서 표지가 돌아 펼쳐지며 정보·"책 읽기"(PDF flipbook)가
// 뜬다. 책등 색은 표지 대표색(채도 가중 평균 + HSL 보정)에 맞춘다. 오리지널 구현.
(function () {
  const root = document.getElementById('wzSeasons');
  if (!root) return;

  function db() { return window.MagDB; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const FALLBACK = ['#7a3b52', '#3f5a78', '#6b5036', '#4a6b4f', '#5a4a78', '#8a4a32'];
  const coverUrl = (it) => (it.cover_path ? db().webzine.publicUrl(it.cover_path) : '');

  let issues = [];
  const palette = [];
  let openEl = null, opened = false, openIdx = -1;

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

  // 분류(시즌)별로 묶되, 목록 정렬(sort_order)대로 처음 나온 분류부터 위에서 아래로.
  function groupByCategory() {
    const order = [], map = new Map();
    issues.forEach((it, i) => {
      const key = (it.category && it.category.trim()) || '';
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key).push(i);
    });
    return order.map(name => ({ name, idxs: map.get(name) }));
  }

  function render() {
    if (!issues.length) { root.innerHTML = '<p class="wz-empty">아직 발행된 웹진이 없어요.</p>'; return; }
    root.innerHTML = groupByCategory().map(g => `
      <section class="wz-shelf">
        ${g.name ? `<h2 class="wz-shelf-title">${esc(g.name)}</h2>` : ''}
        <div class="wz-rail-wrap">
          <button type="button" class="wz-nav wz-prev" aria-label="왼쪽으로">‹</button>
          <div class="wz-rail">
            ${g.idxs.map(i => `<button type="button" class="wz-slot" data-i="${i}" aria-label="${esc(issues[i].title)} 보기">${spineBook(issues[i], palette[i])}</button>`).join('')}
          </div>
          <button type="button" class="wz-nav wz-next" aria-label="오른쪽으로">›</button>
        </div>
      </section>`).join('');
    root.querySelectorAll('.wz-slot').forEach(b => b.addEventListener('click', () => openBook(Number(b.dataset.i))));
    root.querySelectorAll('.wz-rail-wrap').forEach(wrap => {
      const rail = wrap.querySelector('.wz-rail');
      wrap.querySelector('.wz-prev').addEventListener('click', () => rail.scrollBy({ left: -rail.clientWidth * 0.8, behavior: 'smooth' }));
      wrap.querySelector('.wz-next').addEventListener('click', () => rail.scrollBy({ left: rail.clientWidth * 0.8, behavior: 'smooth' }));
    });
  }

  function ensureOpen() {
    if (openEl) return;
    openEl = document.createElement('div');
    openEl.className = 'wz-open';
    openEl.innerHTML = `
      <button type="button" class="wz-open-back" aria-label="목록으로">← 목록으로</button>
      <div class="wz-open-grid">
        <button type="button" class="wz-open-cover" aria-label="닫기"></button>
        <div class="wz-flow-info"></div>
      </div>`;
    document.body.appendChild(openEl);
    openEl.querySelector('.wz-open-back').addEventListener('click', closeBook);
    openEl.querySelector('.wz-open-cover').addEventListener('click', closeBook);
    openEl.addEventListener('click', (e) => { if (e.target === openEl) closeBook(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && opened) closeBook(); });
  }

  function openBook(i) {
    const it = issues[i], c = palette[i]; if (!it) return;
    ensureOpen();
    openIdx = i;
    openEl.style.setProperty('--wz-glow', c.spine);
    openEl.querySelector('.wz-open-cover').innerHTML = coverBook(it, c);
    openEl.querySelector('.wz-flow-info').innerHTML = infoHtml(it);
    const read = openEl.querySelector('.wz-meta-read');
    if (read) read.addEventListener('click', (e) => {
      if (!window.WebzineReader) return;
      e.preventDefault();
      window.WebzineReader.open(read.href, it.title);
    });
    opened = true;
    openEl.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeBook() {
    opened = false; openIdx = -1;
    if (openEl) openEl.classList.remove('open');
    document.body.style.overflow = '';
  }

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
        const sb = root.querySelector(`.wz-slot[data-i="${i}"] .wz-spinebook`);
        if (sb) { sb.style.setProperty('--spine', c.spine); sb.style.setProperty('--spine-text', c.text); }
        if (opened && openIdx === i && openEl) {
          openEl.style.setProperty('--wz-glow', c.spine);
          const cb = openEl.querySelector('.wz-coverbook');
          if (cb) cb.style.setProperty('--spine', c.spine);
        }
      });
    });
  })();
})();
