'use strict';

// 5ft.mag 웹진 — 분류(시즌)별 한 줄(코버플로우). 책 한 권이 옆으로 회전해 책등↔표지로 돈다
// (단일 큐보이드 + transform 전환). 고르면 그 줄 안에서 표지로 돌아서며 슬롯 폭이 늘어
// 이웃을 밀어내고 옆에 정보가 뜬다. 스와이프하면 역회전으로 다시 책등으로 접힌다.
// 좋아요는 user_favorites(target_type 'webzine')로 저장돼 마이페이지에 표시. 오리지널.
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
  let followId = null, followFlow = null, seqT = null;
  let currentRow = null;         // 키보드 좌우 이동 대상(최근 조작/펼친 줄)

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
          const col = vivid(r / w, g / w, b / w);
          col.aspect = (img.naturalWidth && img.naturalHeight) ? img.naturalWidth / img.naturalHeight : 0;
          resolve(col);
        } catch (_) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function bookMarkup(it, c) {
    const cover = it.cover_path
      ? `<img src="${esc(coverUrl(it))}" alt="" loading="lazy" />`
      : `<span class="wz-f-text">${esc(it.title)}</span>`;
    return `<div class="wz-book3d" style="--spine:${c.spine};--spine-text:${c.text}">
      <div class="f-front">${cover}</div>
      <div class="f-spine">
        <span class="wz-spine-head">
          <span class="wz-spine-title"><span class="wz-spine-title-in">${esc(it.title)}</span></span>
          ${it.issue_label ? `<span class="wz-spine-issue">${esc(it.issue_label)}</span>` : ''}
        </span>
        <span class="wz-spine-mark" aria-hidden="true"></span>
      </div>
      <div class="f-edge wz-pages"></div>
      <div class="f-top wz-pages"></div>
    </div>`;
  }
  function infoHtml(it) {
    const read = it.pdf_path ? esc(db().webzine.publicUrl(it.pdf_path)) : '';
    const fav = favSet.has(it.id);
    return `<button type="button" class="wz-close" aria-label="닫기">✕</button>
      ${it.issue_label ? `<span class="wz-meta-issue">${esc(it.issue_label)}</span>` : ''}
      <h2 class="wz-meta-title">${esc(it.title)}</h2>
      ${it.description ? `<p class="wz-meta-desc">${esc(it.description)}</p>` : ''}
      ${read ? `<a class="wz-meta-read" href="${read}" target="_blank" rel="noopener">책 읽기 →</a>` : ''}
      <div class="wz-open-actions">
        <button type="button" class="wz-act wz-like${fav ? ' is-on' : ''}" aria-pressed="${fav}">${fav ? '♥' : '♡'} <span>좋아요</span></button>
        <button type="button" class="wz-act wz-share">↗ <span>공유</span></button>
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
      slot.classList.toggle('is-center', d === 0);
      slot.style.opacity = String(slot.classList.contains('is-open') ? 1 : Math.max(0, 1 - ad * 0.16));
      slot.style.pointerEvents = (ad > 6 && !slot.classList.contains('is-open')) ? 'none' : 'auto';
    });
    const prev = rs.flowEl.querySelector('.wz-prev'), next = rs.flowEl.querySelector('.wz-next');
    if (prev) prev.disabled = rs.active <= 0;
    if (next) next.disabled = rs.active >= rs.slots.length - 1;
  }
  // 슬롯 폭이 전환되는 동안(열림/접힘) 트랙 위치만 매 프레임 갱신해 부드럽게 따라간다.
  // (전체 레이아웃/그림자 재계산은 프레임마다 하지 않음 — 끊김 방지)
  function follow(rs) {
    if (followId) cancelAnimationFrame(followId);
    if (followFlow && followFlow !== rs.flowEl) followFlow.classList.remove('following');
    followFlow = rs.flowEl;
    rs.flowEl.classList.add('following');
    layout(rs);
    const t0 = performance.now();
    const step = (t) => {
      const s = rs.slots[rs.active];
      if (s) rs.trackEl.style.transform = `translateX(${rs.flowEl.clientWidth / 2 - (s.offsetLeft + s.offsetWidth / 2)}px)`;
      if (t - t0 < 660) { followId = requestAnimationFrame(step); }
      else { rs.flowEl.classList.remove('following'); followId = null; followFlow = null; layout(rs); }
    };
    followId = requestAnimationFrame(step);
  }

  function onBook(rs, pos) {
    currentRow = rs;
    clearTimeout(seqT);
    const slot = rs.slots[pos];
    if (slot.classList.contains('is-open')) { closeOpen(); return; }   // 펼친 책 다시 클릭 → 닫기
    if (openState) {
      // 다른 책 클릭: 접고 → 그 책으로 이동 → 펼치기
      closeOpen();
      rs.active = pos; follow(rs);
      seqT = setTimeout(() => openBook(rs, pos), 460);
      return;
    }
    if (pos === rs.active) { openBook(rs, pos); return; }
    rs.active = pos; layout(rs);
  }
  function openBook(rs, pos) {
    if (openState) { openState.rs.slots[openState.pos].classList.remove('is-open'); openState = null; }
    const slot = rs.slots[pos];
    slot.classList.add('is-open');
    rs.active = pos;
    openState = { rs, pos, i: Number(slot.dataset.i) };
    follow(rs);
    requestAnimationFrame(() => slot.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }));
  }
  function closeOpen() {
    clearTimeout(seqT);
    if (!openState) return;
    const { rs, pos } = openState;
    rs.slots[pos].classList.remove('is-open');
    openState = null;
    follow(rs);
  }
  function nav(rs, d) {
    currentRow = rs;
    clearTimeout(seqT);
    if (openState) { closeOpen(); return; }   // 펼쳐져 있으면 닫기만(ESC 와 동일) — 닫으며 이동하면 모션이 튄다
    const n = rs.active + d;
    if (n < 0 || n >= rs.slots.length || n === rs.active) return;
    rs.active = n;
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
            ${g.idxs.map((i, pos) => `
              <div class="wz-slot" data-i="${i}" data-pos="${pos}">
                <button type="button" class="wz-book-btn" aria-label="${esc(issues[i].title)} 보기">${bookMarkup(issues[i], palette[i])}</button>
                <div class="wz-info">${infoHtml(issues[i])}</div>
              </div>`).join('')}
          </div>
          <button type="button" class="wz-nav wz-next" aria-label="다음">›</button>
        </div>
      </section>`).join('');

    rows.length = 0; slotIndex.clear();
    root.querySelectorAll('.wz-flow').forEach(flowEl => {
      const rs = { flowEl, trackEl: flowEl.querySelector('.wz-track'), slots: Array.from(flowEl.querySelectorAll('.wz-slot')), active: 0 };
      rows.push(rs);
      rs.slots.forEach((slot, pos) => {
        const it = issues[Number(slot.dataset.i)];
        slotIndex.set(Number(slot.dataset.i), { rs, pos });
        slot.querySelector('.wz-book-btn').addEventListener('click', () => onBook(rs, pos));
        slot.querySelector('.wz-close').addEventListener('click', (e) => { e.stopPropagation(); closeOpen(); });
        const read = slot.querySelector('.wz-meta-read');
        if (read) read.addEventListener('click', (e) => { e.stopPropagation(); if (!window.WebzineReader) return; e.preventDefault(); window.WebzineReader.open(read.href, it.title); });
        const likeBtn = slot.querySelector('.wz-like');
        if (likeBtn) likeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleLike(it, likeBtn); });
        const shareBtn = slot.querySelector('.wz-share');
        if (shareBtn) shareBtn.addEventListener('click', (e) => { e.stopPropagation(); share(it); });
      });
      flowEl.querySelector('.wz-prev').addEventListener('click', () => nav(rs, -1));
      flowEl.querySelector('.wz-next').addEventListener('click', () => nav(rs, 1));
      let wheelLock = false;
      flowEl.addEventListener('wheel', (e) => {
        currentRow = rs;
        // 줄 위에서 휠(가로·세로 모두)로 좌우 넘김. 줄 끝에서는 페이지 스크롤에 양보.
        const d = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (!d) return;
        const dir = d > 0 ? 1 : -1;
        // 펼쳐져 있으면 방향·위치 무관하게 닫기만(ESC 와 동일). 닫혀 있을 때만 줄 끝에서 페이지 스크롤에 양보.
        if (!openState && ((dir > 0 && rs.active >= rs.slots.length - 1) || (dir < 0 && rs.active <= 0))) return;
        e.preventDefault();
        if (wheelLock) return;            // 한 번 스와이프 = 한 칸(너무 빨리 지나가지 않게)
        wheelLock = true; setTimeout(() => { wheelLock = false; }, 480);
        nav(rs, dir);
      }, { passive: false });
      let tx = null, ty = null;
      flowEl.addEventListener('touchstart', (e) => { currentRow = rs; tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
      flowEl.addEventListener('touchend', (e) => {
        if (tx == null) return;
        const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; tx = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) nav(rs, dx < 0 ? 1 : -1);
      }, { passive: true });
      layout(rs);
      requestAnimationFrame(() => flowEl.classList.remove('no-anim'));
    });
    currentRow = rows[0] || null;
    requestAnimationFrame(measureTitles);
  }

  // 책등 제목이 넘치면(잘리면) 세로로 천천히 흐르게(마퀴) 해서 다 읽히게 한다.
  function measureTitles() {
    root.querySelectorAll('.wz-spine-title').forEach(el => {
      const over = el.scrollHeight - el.clientHeight;
      if (over > 6) {
        el.style.setProperty('--scroll', over + 'px');
        el.style.setProperty('--marq-dur', (over / 22 + 4).toFixed(1) + 's');
        el.classList.add('is-scroll');
      } else { el.classList.remove('is-scroll'); }
    });
  }

  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      rows.forEach(rs => {
        rs.flowEl.classList.add('no-anim'); layout(rs);
        requestAnimationFrame(() => rs.flowEl.classList.remove('no-anim'));
      });
      measureTitles();
    }, 120);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (openState) closeOpen(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (openState) { closeOpen(); return; }            // 열려 있으면 ESC 와 동일하게 닫기만
      if (currentRow) nav(currentRow, e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === 'Enter') {
      const ae = document.activeElement;
      if (ae && /^(BUTTON|A|INPUT|TEXTAREA)$/.test(ae.tagName)) return;  // 포커스된 요소가 처리
      if (openState) return;
      if (currentRow) { e.preventDefault(); openBook(currentRow, currentRow.active); }  // 가운데 책 펼치기
    }
  });

  (async function load() {
    for (let i = 0; i < 50; i++) { if (db() && db().isReady()) break; await new Promise(r => setTimeout(r, 50)); }
    try { issues = await db().webzine.listPublished(); } catch (_) { issues = []; }
    if (!Array.isArray(issues)) issues = [];
    issues.sort((a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || (new Date(a.created_at || 0) - new Date(b.created_at || 0)));
    issues.forEach((_, i) => { palette[i] = { spine: FALLBACK[i % FALLBACK.length], text: '#fff' }; });
    render();

    try { favSet = await db().favorites.idsForType('webzine'); } catch (_) { favSet = new Set(); }
    root.querySelectorAll('.wz-slot').forEach(slot => {
      const b = slot.querySelector('.wz-like');
      if (b) setLikeBtn(b, favSet.has(issues[Number(slot.dataset.i)].id));
    });

    const slug = new URLSearchParams(location.search).get('issue');
    if (slug) { const i = issues.findIndex(x => x.slug === slug); const ref = slotIndex.get(i); if (ref) openBook(ref.rs, ref.pos); }

    issues.forEach((it, i) => {
      if (!it.cover_path) return;
      pickColor(coverUrl(it)).then(c => {
        if (!c) return;
        palette[i] = { spine: c.spine, text: c.text };
        const slot = root.querySelector(`.wz-slot[data-i="${i}"]`);
        const b3 = slot && slot.querySelector('.wz-book3d');
        if (b3) { b3.style.setProperty('--spine', c.spine); b3.style.setProperty('--spine-text', c.text); }
        // 표지 박스를 이미지 실제 비율(폭=높이×비율)에 맞춰 좌우 잘림 없이 표시
        if (slot && c.aspect && isFinite(c.aspect)) slot.style.setProperty('--cw2', `calc(var(--h) * ${c.aspect.toFixed(4)})`);
        if (openState && openState.i === i) follow(openState.rs);
      });
    });
  })();
})();
