'use strict';

// 홈(오른쪽 패널) 미니 책장 — 발행된 웹진을 작은 책등 줄로 보여주고, 누르면 웹진
// 페이지에서 해당 호가 펼쳐진다(딥링크). 가볍게: 색만 표지에서 뽑고 펼침은 웹진에서.
(function () {
  const rail = document.getElementById('homeWzRail');
  const sec = document.getElementById('homeWz');
  if (!rail || !sec) return;

  function db() { return window.MagDB; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const FALLBACK = ['#7a3b52', '#3f5a78', '#6b5036', '#4a6b4f', '#5a4a78', '#8a4a32'];

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

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  (async function load() {
    for (let i = 0; i < 50; i++) { if (db() && db().isReady()) break; await new Promise(r => setTimeout(r, 50)); }
    let issues = [];
    try { issues = await db().webzine.listPublished(); } catch (_) { issues = []; }
    if (!Array.isArray(issues) || !issues.length) { sec.hidden = true; return; }
    sec.hidden = false;
    shuffle(issues);   // 매번 랜덤 순서로 노출

    const prev = document.getElementById('homeWzPrev'), next = document.getElementById('homeWzNext');
    if (prev) prev.addEventListener('click', () => rail.scrollBy({ left: -rail.clientWidth * 0.8, behavior: 'smooth' }));
    if (next) next.addEventListener('click', () => rail.scrollBy({ left: rail.clientWidth * 0.8, behavior: 'smooth' }));

    rail.innerHTML = issues.map((it, i) => {
      const c = { spine: FALLBACK[i % FALLBACK.length], text: '#fff' };
      return `<a class="home-wz-spine" href="webzine.html?issue=${encodeURIComponent(it.slug)}" style="--spine:${c.spine};--spine-text:${c.text}" aria-label="${esc(it.title)}">
        <span class="t">${esc(it.title)}</span>
        <span class="m" aria-hidden="true"></span>
      </a>`;
    }).join('');

    issues.forEach((it, i) => {
      if (!it.cover_path) return;
      pickColor(db().webzine.publicUrl(it.cover_path)).then(c => {
        if (!c) return;
        const el = rail.children[i];
        if (el) { el.style.setProperty('--spine', c.spine); el.style.setProperty('--spine-text', c.text); }
      });
    });
  })();
})();
