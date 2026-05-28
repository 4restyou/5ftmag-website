'use strict';

// 5ft.mag 웹진 — 어두운 갤러리. 가운데 한 권이 옆으로 돌아 표지가 보이고
// 표지색으로 물든 카드 위에 호라벨·제목·소개·"책 읽기"(PDF 원본 새 탭)가 뜬다.
// 양옆에는 이웃 호의 책등이 기대어 서고, 화살표·휠·스와이프·좌우키로 넘긴다.
// 책등/카드 색은 표지 대표색(채도 가중 평균 + HSL 보정)에 맞춰 선명하게 뽑는다.
(function () {
  const flow = document.getElementById('wzFlow');
  if (!flow) return;

  function db() { return window.MagDB; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const FALLBACK = ['#7a3b52', '#3f5a78', '#6b5036', '#4a6b4f', '#5a4a78', '#8a4a32'];
  const coverUrl = (it) => (it.cover_path ? db().webzine.publicUrl(it.cover_path) : '');

  let issues = [];
  const palette = [];   // { spine, text } per issue (대표색)
  let active = 0, cooling = false;

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
  // 평균 RGB 를 표지에 맞춘 선명한 색으로: 채도는 올리고 명도는 읽히는 범위로.
  function vivid(r, g, b) {
    let [h, s, l] = rgbToHsl(r, g, b);
    s = Math.min(1, s * 1.4 + 0.08);
    l = Math.min(0.6, Math.max(0.34, l));
    const [R, G, B] = hslToRgb(h, s, l);
    const lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
    return { spine: `rgb(${R},${G},${B})`, text: lum > 0.62 ? '#1a1a1a' : '#fff' };
  }
  // 표지 대표색 — 채도 높은 픽셀에 가중치를 줘(흐릿한 회색에 묻히지 않게) 평균낸다.
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
            const k = 0.25 + (mx ? (mx - mn) / mx : 0);   // 채도 가중
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

  function peekBook(it, c) {
    return `<div class="wz-cuboid wz-peekbook" style="--spine:${c.spine};--spine-text:${c.text}">
      <div class="f-spine">
        <span class="wz-spine-title">${esc(it.title)}</span>
        ${it.issue_label ? `<span class="wz-spine-issue">${esc(it.issue_label)}</span>` : ''}
      </div>
      <div class="f-side"></div>
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
    return `${it.issue_label ? `<span class="wz-card-issue">${esc(it.issue_label)}</span>` : ''}
      <h2 class="wz-card-title">${esc(it.title)}</h2>
      ${it.description ? `<p class="wz-card-desc">${esc(it.description)}</p>` : ''}
      ${read ? `<a class="wz-card-read" href="${read}" target="_blank" rel="noopener">책 읽기 →</a>` : ''}`;
  }

  function paint() {
    if (!issues.length) { flow.innerHTML = '<p class="wz-empty">아직 발행된 웹진이 없어요.</p>'; return; }
    const it = issues[active], c = palette[active];
    const prev = issues[active - 1], next = issues[active + 1];
    flow.innerHTML = `
      <button type="button" class="wz-nav wz-prev" aria-label="이전 호"${active <= 0 ? ' disabled' : ''}>‹</button>
      ${prev ? `<button type="button" class="wz-peek wz-peek-prev" data-go="-1" aria-label="${esc(prev.title)} 보기">${peekBook(prev, palette[active - 1])}</button>` : ''}
      <div class="wz-flow-card" style="--spine:${c.spine}">
        <div class="wz-flow-card-cover">${coverBook(it, c)}</div>
        <div class="wz-flow-card-info">${infoHtml(it)}</div>
      </div>
      ${next ? `<button type="button" class="wz-peek wz-peek-next" data-go="1" aria-label="${esc(next.title)} 보기">${peekBook(next, palette[active + 1])}</button>` : ''}
      <button type="button" class="wz-nav wz-next" aria-label="다음 호"${active >= issues.length - 1 ? ' disabled' : ''}>›</button>`;
    flow.style.setProperty('--wz-glow', c.spine);
    flow.querySelector('.wz-prev').addEventListener('click', () => nav(-1));
    flow.querySelector('.wz-next').addEventListener('click', () => nav(1));
    flow.querySelectorAll('.wz-peek').forEach(b => b.addEventListener('click', () => nav(Number(b.dataset.go))));
  }

  function nav(d) {
    if (cooling) return;
    const n = active + d;
    if (n < 0 || n >= issues.length) return;
    cooling = true; setTimeout(() => { cooling = false; }, 520);
    active = n; paint();
  }

  // 현재 화면(가운데 카드 + 양옆 책등)의 색만 제자리에서 갱신 — 재렌더(회전 재생) 없이.
  function applyColors() {
    const card = flow.querySelector('.wz-flow-card');
    if (card && palette[active]) {
      card.style.setProperty('--spine', palette[active].spine);
      flow.style.setProperty('--wz-glow', palette[active].spine);
      const cb = card.querySelector('.wz-coverbook');
      if (cb) cb.style.setProperty('--spine', palette[active].spine);
    }
    [['.wz-peek-prev .wz-peekbook', active - 1], ['.wz-peek-next .wz-peekbook', active + 1]].forEach(([sel, i]) => {
      const el = flow.querySelector(sel);
      if (el && palette[i]) { el.style.setProperty('--spine', palette[i].spine); el.style.setProperty('--spine-text', palette[i].text); }
    });
  }

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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') nav(1);
    else if (e.key === 'ArrowLeft') nav(-1);
  });

  (async function load() {
    for (let i = 0; i < 50; i++) { if (db() && db().isReady()) break; await new Promise(r => setTimeout(r, 50)); }
    try { issues = await db().webzine.listPublished(); } catch (_) { issues = []; }
    if (!Array.isArray(issues)) issues = [];
    issues.forEach((_, i) => { palette[i] = { spine: FALLBACK[i % FALLBACK.length], text: '#fff' }; });
    paint();

    // 표지 대표색을 비동기로 뽑아 색 갱신(현재 화면은 제자리 패치)
    issues.forEach((it, i) => {
      if (!it.cover_path) return;
      pickColor(coverUrl(it)).then(c => { if (c) { palette[i] = c; if (Math.abs(i - active) <= 1) applyColors(); } });
    });
  })();
})();
