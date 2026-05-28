'use strict';

// 5ft.mag 웹진 — 어두운 갤러리에 책등이 정면으로 선 진열. 책등 색은 표지의
// 대표색(채도 가중 평균 + HSL 보정)에 맞춰 선명하게 뽑고(글자색은 명암에 따라
// 흑/백 자동), 한 권을 고르면 같은 자리에서 책이 옆으로 돌아 표지가 보이고
// 그 옆에 호라벨·제목·소개와 "책 읽기"(PDF 원본 새 탭)가 뜬다.
(function () {
  const rail = document.getElementById('wzRail');
  if (!rail) return;
  const shelf = document.getElementById('wzShelf');
  const open = document.getElementById('wzOpen');
  const back = document.getElementById('wzOpenBack');

  function db() { return window.MagDB; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const FALLBACK = ['#7a3b52', '#3f5a78', '#6b5036', '#4a6b4f', '#5a4a78', '#8a4a32'];
  const coverUrl = (it) => (it.cover_path ? db().webzine.publicUrl(it.cover_path) : '');

  let issues = [];
  const palette = [];   // { spine, text } per issue (대표색)

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
  // 평균 RGB 를 표지에 맞춘 선명한 책등 색으로: 채도는 올리고 명도는 읽히는 범위로.
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

  function openBookEl(it, c) {
    const front = it.cover_path
      ? `<img src="${esc(coverUrl(it))}" alt="${esc(it.title)} 표지" />`
      : `<span class="wz-f-text">${esc(it.title)}</span>`;
    return `<div class="wz-cuboid wz-openbook" style="--spine:${c.spine}">
      <div class="f-front">${front}</div>
      <div class="f-spine"><span>${esc(it.title)}</span></div>
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
    track.querySelectorAll('.wz-book').forEach(b => b.addEventListener('click', () => openBook(Number(b.dataset.i))));
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

  function openBook(i) {
    const it = issues[i]; if (!it) return;
    const c = palette[i];
    document.getElementById('wzOpenStage').innerHTML = openBookEl(it, c);
    const read = it.pdf_path ? esc(db().webzine.publicUrl(it.pdf_path)) : '';
    document.getElementById('wzOpenInfo').innerHTML = `
      ${it.issue_label ? `<span class="wz-open-issue">${esc(it.issue_label)}</span>` : ''}
      <h2 class="wz-open-title">${esc(it.title)}</h2>
      ${it.description ? `<p class="wz-open-desc">${esc(it.description)}</p>` : ''}
      ${read ? `<a class="wz-open-read" href="${read}" target="_blank" rel="noopener">책 읽기 →</a>` : ''}`;
    open.style.setProperty('--wz-glow', c.spine);
    shelf.hidden = true;
    open.hidden = false;
  }

  function closeBook() {
    open.hidden = true;
    shelf.hidden = false;
  }
  back.addEventListener('click', closeBook);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !open.hidden) closeBook(); });

  (async function load() {
    for (let i = 0; i < 50; i++) { if (db() && db().isReady()) break; await new Promise(r => setTimeout(r, 50)); }
    try { issues = await db().webzine.listPublished(); } catch (_) { issues = []; }
    if (!Array.isArray(issues)) issues = [];
    issues.forEach((_, i) => { palette[i] = { spine: FALLBACK[i % FALLBACK.length], text: '#fff' }; });
    render();
  })();
})();
