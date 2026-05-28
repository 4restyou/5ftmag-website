'use strict';

// 5ft.mag 웹진 — 분류(시즌)별로 한 줄씩 세로로 쌓고, 각 줄은 코버플로우(가운데 책이
// 도드라지며 좌우로 부드럽게 미끄러짐: 스와이프·가로 휠·화살표). 분류명은 줄 제목으로
// 붙고, 호는 1→2→3 순(오름차순). 한 권을 고르면 같은 색 무대에서 표지가 돌아 펼쳐지며
// 정보·"책 읽기"(PDF flipbook)가 뜬다. 책등 색은 표지 대표색(채도 가중 + HSL 보정).
(function () {
  const root = document.getElementById('wzSeasons');
  if (!root) return;

  function db() { return window.MagDB; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const FALLBACK = ['#7a3b52', '#3f5a78', '#6b5036', '#4a6b4f', '#5a4a78', '#8a4a32'];
  const coverUrl = (it) => (it.cover_path ? db().webzine.publicUrl(it.cover_path) : '');

  let issues = [];
  const palette = [];
  const rows = [];
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

  // 분류(시즌)별로 묶음. issues 는 이미 1→2→3(오름차순)으로 정렬돼 있어 줄 순서·줄 내 순서 모두 오름차순.
  function groupByCategory() {
    const order = [], map = new Map();
    issues.forEach((it, i) => {
      const key = (it.category && it.category.trim()) || '';
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key).push(i);
    });
    return order.map(name => ({ name, idxs: map.get(name) }));
  }

  function layout(rs) {
    const s = rs.slots[rs.active]; if (!s) return;
    rs.trackEl.style.transform = `translateX(${rs.flowEl.clientWidth / 2 - (s.offsetLeft + s.offsetWidth / 2)}px)`;
    rs.slots.forEach((slot, pos) => {
      const d = pos - rs.active, ad = Math.abs(d);
      const book = slot.querySelector('.wz-spinebook');
      if (book) book.style.transform = `scale(${d === 0 ? 1.12 : 0.86})`;
      slot.style.opacity = String(Math.max(0, 1 - ad * 0.16));
      slot.style.pointerEvents = ad > 6 ? 'none' : 'auto';
    });
    const prev = rs.flowEl.querySelector('.wz-prev'), next = rs.flowEl.querySelector('.wz-next');
    if (prev) prev.disabled = rs.active <= 0;
    if (next) next.disabled = rs.active >= rs.slots.length - 1;
  }
  function nav(rs, d) {
    const n = rs.active + d;
    if (n < 0 || n >= rs.slots.length || n === rs.active) return;
    rs.active = n; layout(rs);
  }

  function render() {
    if (!issues.length) { root.innerHTML = '<p class="wz-empty">아직 발행된 웹진이 없어요.</p>'; return; }
    root.innerHTML = groupByCategory().map(g => `
      <section class="wz-shelf">
        ${g.name ? `<h2 class="wz-shelf-title">${esc(g.name)}</h2>` : ''}
        <div class="wz-flow no-anim">
          <button type="button" class="wz-nav wz-prev" aria-label="이전">‹</button>
          <div class="wz-track">
            ${g.idxs.map((i, pos) => `<button type="button" class="wz-slot" data-i="${i}" data-pos="${pos}" aria-label="${esc(issues[i].title)} 보기">${spineBook(issues[i], palette[i])}</button>`).join('')}
          </div>
          <button type="button" class="wz-nav wz-next" aria-label="다음">›</button>
        </div>
      </section>`).join('');

    rows.length = 0;
    root.querySelectorAll('.wz-flow').forEach(flowEl => {
      const rs = { flowEl, trackEl: flowEl.querySelector('.wz-track'), slots: Array.from(flowEl.querySelectorAll('.wz-slot')), active: 0 };
      rows.push(rs);
      rs.slots.forEach(s => s.addEventListener('click', () => {
        const pos = Number(s.dataset.pos);
        if (pos === rs.active) openBook(Number(s.dataset.i));
        else { rs.active = pos; layout(rs); }
      }));
      flowEl.querySelector('.wz-prev').addEventListener('click', () => nav(rs, -1));
      flowEl.querySelector('.wz-next').addEventListener('click', () => nav(rs, 1));
      flowEl.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;   // 세로 휠은 페이지 스크롤
        e.preventDefault();
        nav(rs, e.deltaX > 0 ? 1 : -1);
      }, { passive: false });
      let tx = null, ty = null;
      flowEl.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
      flowEl.addEventListener('touchend', (e) => {
        if (tx == null) return;
        const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; tx = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) nav(rs, dx < 0 ? 1 : -1);
      }, { passive: true });
      layout(rs);
      requestAnimationFrame(() => flowEl.classList.remove('no-anim'));
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

  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => rows.forEach(rs => {
      rs.flowEl.classList.add('no-anim'); layout(rs);
      requestAnimationFrame(() => rs.flowEl.classList.remove('no-anim'));
    }), 120);
  });

  (async function load() {
    for (let i = 0; i < 50; i++) { if (db() && db().isReady()) break; await new Promise(r => setTimeout(r, 50)); }
    try { issues = await db().webzine.listPublished(); } catch (_) { issues = []; }
    if (!Array.isArray(issues)) issues = [];
    // 1→2→3 오름차순(정렬값 우선, 같으면 생성순)
    issues.sort((a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || (new Date(a.created_at || 0) - new Date(b.created_at || 0)));
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
