'use strict';

// 5ft.mag 웹진 — 분류(시즌)별로 한 줄씩 세로로 쌓고, 각 줄은 코버플로우(가운데 책이
// 도드라지며 좌우로 미끄러짐). 책등은 제목 상단 정렬 + 하단 5ft 심볼, 종이 질감(CSS).
// 한 권을 고르면 새 창이 아니라 "그 줄 안에서" 표지가 돌아 펼쳐지며 이웃 책을 밀어내고
// 옆에 정보·좋아요·공유·"책 읽기"가 뜬다. 좋아요는 user_favorites(target_type 'webzine').
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
  const slotIndex = new Map();   // 전역 인덱스 i -> { rs, pos }
  let favSet = new Set();
  let openState = null;          // { rs, pos, i }

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
        <span class="wz-spine-head">
          <span class="wz-spine-title">${esc(it.title)}</span>
          ${it.issue_label ? `<span class="wz-spine-issue">${esc(it.issue_label)}</span>` : ''}
        </span>
        <span class="wz-spine-mark" aria-hidden="true"></span>
      </div>
      <div class="f-cover"></div>
      <div class="f-top wz-pages"></div>
    </div>`;
  }
  function spineBtn(it, c) {
    return `<button type="button" class="wz-spine-btn" aria-label="${esc(it.title)} 보기">${spineBook(it, c)}</button>`;
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
    const fav = favSet.has(it.id);
    return `${it.issue_label ? `<span class="wz-meta-issue">${esc(it.issue_label)}</span>` : ''}
      <h2 class="wz-meta-title">${esc(it.title)}</h2>
      ${it.description ? `<p class="wz-meta-desc">${esc(it.description)}</p>` : ''}
      ${read ? `<a class="wz-meta-read" href="${read}" target="_blank" rel="noopener">책 읽기 →</a>` : ''}
      <div class="wz-open-actions">
        <button type="button" class="wz-act wz-like${fav ? ' is-on' : ''}" data-act="like" aria-pressed="${fav}">${fav ? '♥' : '♡'} <span>좋아요</span></button>
        <button type="button" class="wz-act wz-share" data-act="share">↗ <span>공유</span></button>
      </div>`;
  }

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
      slot.style.opacity = String(slot.classList.contains('is-open') ? 1 : Math.max(0, 1 - ad * 0.16));
      slot.style.pointerEvents = (ad > 6 && !slot.classList.contains('is-open')) ? 'none' : 'auto';
    });
    const prev = rs.flowEl.querySelector('.wz-prev'), next = rs.flowEl.querySelector('.wz-next');
    if (prev) prev.disabled = rs.active <= 0;
    if (next) next.disabled = rs.active >= rs.slots.length - 1;
  }
  function nav(rs, d) {
    const n = rs.active + d;
    if (n < 0 || n >= rs.slots.length || n === rs.active) return;
    closeOpen();
    rs.active = n; layout(rs);
  }

  function onSpine(rs, pos) {
    if (pos === rs.active && !openState) { openBook(rs, pos); return; }
    closeOpen();
    rs.active = pos; layout(rs);
  }

  function openBook(rs, pos) {
    closeOpen();
    const slot = rs.slots[pos]; const i = Number(slot.dataset.i);
    const it = issues[i], c = palette[i]; if (!it) return;
    slot.classList.add('is-open');
    slot.innerHTML = `
      <div class="wz-open-inline" style="--wz-glow:${c.spine}">
        <button type="button" class="wz-cover-btn" aria-label="닫기">${coverBook(it, c)}</button>
        <div class="wz-flow-info">${infoHtml(it)}</div>
        <button type="button" class="wz-close" aria-label="닫기">✕</button>
      </div>`;
    slot.querySelector('.wz-cover-btn').addEventListener('click', closeOpen);
    slot.querySelector('.wz-close').addEventListener('click', closeOpen);
    const read = slot.querySelector('.wz-meta-read');
    if (read) read.addEventListener('click', (e) => {
      if (!window.WebzineReader) return;
      e.preventDefault();
      window.WebzineReader.open(read.href, it.title);
    });
    const likeBtn = slot.querySelector('.wz-like');
    if (likeBtn) likeBtn.addEventListener('click', () => toggleLike(it, likeBtn));
    const shareBtn = slot.querySelector('.wz-share');
    if (shareBtn) shareBtn.addEventListener('click', () => share(it));
    openState = { rs, pos, i };
    rs.active = pos;
    layout(rs);
  }
  function closeOpen() {
    if (!openState) return;
    const { rs, pos, i } = openState;
    const slot = rs.slots[pos];
    slot.classList.remove('is-open');
    slot.innerHTML = spineBtn(issues[i], palette[i]);
    slot.querySelector('.wz-spine-btn').addEventListener('click', () => onSpine(rs, pos));
    openState = null;
    layout(rs);
  }

  function setLikeBtn(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.innerHTML = `${on ? '♥' : '♡'} <span>좋아요</span>`;
  }
  async function toggleLike(it, btn) {
    const session = await db().auth.getSession();
    if (!session) { db().auth.signInWithGoogle(location.href); return; }
    const on = favSet.has(it.id);
    const { error } = await db().favorites.toggle('webzine', it.id, on);
    if (error) { window.notify?.('좋아요 처리 실패: ' + error.message, 'danger'); return; }
    if (on) favSet.delete(it.id); else favSet.add(it.id);
    setLikeBtn(btn, !on);
  }
  async function share(it) {
    const url = `${location.origin}/webzine.html?issue=${encodeURIComponent(it.slug)}`;
    const data = { title: `5ft.mag — ${it.title}`, text: it.title, url };
    if (navigator.share) { try { await navigator.share(data); } catch (_) {} return; }
    try { await navigator.clipboard.writeText(url); window.notify?.('링크를 복사했어요.', 'success'); }
    catch (_) { window.notify?.(url, 'info'); }
  }

  function render() {
    if (!issues.length) { root.innerHTML = '<p class="wz-empty">아직 발행된 웹진이 없어요.</p>'; return; }
    root.innerHTML = groupByCategory().map(g => `
      <section class="wz-shelf">
        ${g.name ? `<h2 class="wz-shelf-title">${esc(g.name)}</h2>` : ''}
        <div class="wz-flow no-anim">
          <button type="button" class="wz-nav wz-prev" aria-label="이전">‹</button>
          <div class="wz-track">
            ${g.idxs.map((i, pos) => `<div class="wz-slot" data-i="${i}" data-pos="${pos}">${spineBtn(issues[i], palette[i])}</div>`).join('')}
          </div>
          <button type="button" class="wz-nav wz-next" aria-label="다음">›</button>
        </div>
      </section>`).join('');

    rows.length = 0; slotIndex.clear();
    root.querySelectorAll('.wz-flow').forEach(flowEl => {
      const rs = { flowEl, trackEl: flowEl.querySelector('.wz-track'), slots: Array.from(flowEl.querySelectorAll('.wz-slot')), active: 0 };
      rows.push(rs);
      rs.slots.forEach((slot, pos) => {
        slotIndex.set(Number(slot.dataset.i), { rs, pos });
        slot.querySelector('.wz-spine-btn').addEventListener('click', () => onSpine(rs, pos));
      });
      flowEl.querySelector('.wz-prev').addEventListener('click', () => nav(rs, -1));
      flowEl.querySelector('.wz-next').addEventListener('click', () => nav(rs, 1));
      flowEl.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
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

  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => rows.forEach(rs => {
      rs.flowEl.classList.add('no-anim'); layout(rs);
      requestAnimationFrame(() => rs.flowEl.classList.remove('no-anim'));
    }), 120);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openState) closeOpen(); });

  (async function load() {
    for (let i = 0; i < 50; i++) { if (db() && db().isReady()) break; await new Promise(r => setTimeout(r, 50)); }
    try { issues = await db().webzine.listPublished(); } catch (_) { issues = []; }
    if (!Array.isArray(issues)) issues = [];
    issues.sort((a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || (new Date(a.created_at || 0) - new Date(b.created_at || 0)));
    issues.forEach((_, i) => { palette[i] = { spine: FALLBACK[i % FALLBACK.length], text: '#fff' }; });
    render();

    try { favSet = await db().favorites.idsForType('webzine'); } catch (_) { favSet = new Set(); }

    const slug = new URLSearchParams(location.search).get('issue');
    if (slug) { const i = issues.findIndex(x => x.slug === slug); const ref = slotIndex.get(i); if (ref) openBook(ref.rs, ref.pos); }

    issues.forEach((it, i) => {
      if (!it.cover_path) return;
      pickColor(coverUrl(it)).then(c => {
        if (!c) return;
        palette[i] = c;
        const sb = root.querySelector(`.wz-slot[data-i="${i}"] .wz-spinebook`);
        if (sb) { sb.style.setProperty('--spine', c.spine); sb.style.setProperty('--spine-text', c.text); }
        if (openState && openState.i === i) {
          const inl = openState.rs.slots[openState.pos].querySelector('.wz-open-inline');
          if (inl) inl.style.setProperty('--wz-glow', c.spine);
          const cb = openState.rs.slots[openState.pos].querySelector('.wz-coverbook');
          if (cb) cb.style.setProperty('--spine', c.spine);
        }
      });
    });
  })();
})();
