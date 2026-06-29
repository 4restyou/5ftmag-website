'use strict';

// 5ft.mag 웹진 리더 — "책 읽기" 를 누르면 전체화면에서 PDF 를 책장 넘김(flipbook)으로 본다.
// PDF.js(페이지 렌더) + StPageFlip(넘김 효과)을 첫 열람 때만 CDN 에서 지연 로드한다.
// StPageFlip 은 HTML 모드로 쓰고, 보이는 페이지 주변만 레티나 해상도 캔버스로 직접 렌더하며
// 멀어진 페이지는 비운다(220 쪽도 메모리·선명도 문제 없이). 확대(핀치·버튼·드래그 팬) 지원.
// 실패 시 새 탭 링크를 보여준다.
(function () {
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const FLIP = 'https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.js';
  const NEAR = 1, KEEP = 3;          // 현재 기준 ±NEAR 렌더, ±KEEP 밖은 비움
  const ZMAX = 3.5;

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); });
  }
  let libsP = null;
  function ensureLibs() {
    if (libsP) return libsP;
    libsP = (async () => {
      if (!window.pdfjsLib) { await loadScript(PDFJS); window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; }
      if (!(window.St && window.St.PageFlip)) { await loadScript(FLIP); }
    })().catch(e => { libsP = null; throw e; });
    return libsP;
  }

  let overlay = null, flip = null, pdfDoc = null;
  let total = 0, busy = false, onKey = null, readerOpts = null;
  let pageDivs = [], rendered = [], baseW = 1, baseH = 1, dispW = 0, dpr = 1;
  let zoom = 1, panX = 0, panY = 0;
  let pinchD0 = 0, zoom0 = 1, panActive = false, px0 = 0, py0 = 0;

  function setLoading(msg) { const el = overlay && overlay.querySelector('.wz-reader-loading'); if (el) el.textContent = msg; }
  function clearLoading() { const el = overlay && overlay.querySelector('.wz-reader-loading'); if (el) el.remove(); }
  function curIndex() { return flip && flip.getCurrentPageIndex ? flip.getCurrentPageIndex() : 0; }
  function updateNo() {
    if (!flip || !overlay) return;
    const el = overlay.querySelector('[data-pageno]'); if (el) el.textContent = `${Math.min(curIndex() + 1, total)} / ${total}`;
  }

  function applyZoom() {
    const z = overlay && overlay.querySelector('.wz-reader-zoom'); if (!z) return;
    z.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    overlay.classList.toggle('is-zoomed', zoom > 1.01);
  }
  function clampPan() {
    const book = overlay && overlay.querySelector('.wz-reader-book');
    const stage = overlay && overlay.querySelector('.wz-reader-stage');
    if (!book || !stage) return;
    const mx = Math.max(0, (book.offsetWidth * zoom - stage.clientWidth) / 2);
    const my = Math.max(0, (book.offsetHeight * zoom - stage.clientHeight) / 2);
    panX = Math.max(-mx, Math.min(mx, panX));
    panY = Math.max(-my, Math.min(my, panY));
  }
  function setZoom(z) {
    zoom = Math.max(1, Math.min(ZMAX, z));
    if (zoom <= 1.01) { zoom = 1; panX = 0; panY = 0; } else clampPan();
    applyZoom();
  }
  function resetZoom() { zoom = 1; panX = 0; panY = 0; applyZoom(); }

  function dist(t) { const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.hypot(dx, dy); }

  function onTouchStart(e) {
    if (e.touches.length === 2) { e.preventDefault(); e.stopPropagation(); pinchD0 = dist(e.touches); zoom0 = zoom; panActive = false; }
    else if (e.touches.length === 1 && zoom > 1.01) { e.preventDefault(); e.stopPropagation(); panActive = true; px0 = e.touches[0].clientX - panX; py0 = e.touches[0].clientY - panY; }
  }
  function onTouchMove(e) {
    if (pinchD0 && e.touches.length >= 2) { e.preventDefault(); e.stopPropagation(); setZoom(zoom0 * dist(e.touches) / pinchD0); }
    else if (panActive && e.touches.length === 1) { e.preventDefault(); e.stopPropagation(); panX = e.touches[0].clientX - px0; panY = e.touches[0].clientY - py0; clampPan(); applyZoom(); }
  }
  function onTouchEnd(e) {
    if (pinchD0 && e.touches.length < 2) { e.stopPropagation(); pinchD0 = 0; if (zoom <= 1.01) resetZoom(); }
    if (panActive && e.touches.length === 0) { e.stopPropagation(); panActive = false; }
  }
  let mDrag = false, mx0 = 0, my0 = 0;
  function onMouseDown(e) { if (zoom > 1.01) { e.preventDefault(); e.stopPropagation(); mDrag = true; mx0 = e.clientX - panX; my0 = e.clientY - panY; } }
  function onMouseMove(e) { if (!mDrag) return; panX = e.clientX - mx0; panY = e.clientY - my0; clampPan(); applyZoom(); }
  function onMouseUp() { mDrag = false; }
  // 휠/스크롤로 페이지 넘김(확대 중엔 끔). 한 번 = 한 장.
  let wheelLock = false;
  function onWheel(e) {
    if (zoom > 1.01 || !flip) return;
    e.preventDefault();
    if (wheelLock) return;
    wheelLock = true; setTimeout(() => { wheelLock = false; }, 600);
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (d > 0) flip.flipNext(); else flip.flipPrev();
  }

  function build(title) {
    overlay = document.createElement('div');
    overlay.className = 'wz-reader';
    overlay.innerHTML = `
      <div class="wz-reader-bar">
        <span class="wz-reader-title">${esc(title)}</span>
        <div class="wz-reader-tools">
          <button type="button" class="wz-reader-btn" data-zout aria-label="축소">−</button>
          <button type="button" class="wz-reader-btn" data-zin aria-label="확대">+</button>
          <button type="button" class="wz-reader-btn wz-reader-flipbtn" data-prev aria-label="이전 페이지">‹</button>
          <span class="wz-reader-pageno" data-pageno>· / ·</span>
          <button type="button" class="wz-reader-btn wz-reader-flipbtn" data-next aria-label="다음 페이지">›</button>
          <button type="button" class="wz-reader-btn wz-reader-close" data-close aria-label="닫기">✕</button>
        </div>
      </div>
      ${readerOpts && readerOpts.cta ? `<button type="button" class="wz-reader-cta" data-cta>${esc(readerOpts.cta.label || '전체 보기')}</button>` : ''}
      <div class="wz-reader-stage">
        <div class="wz-reader-loading">불러오는 중…</div>
        <div class="wz-reader-zoom"><div class="wz-reader-book"></div></div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    overlay.querySelector('[data-close]').addEventListener('click', close);
    const ctaBtn = overlay.querySelector('[data-cta]');
    if (ctaBtn && readerOpts && readerOpts.cta) ctaBtn.addEventListener('click', () => { try { readerOpts.cta.onClick && readerOpts.cta.onClick(); } catch (_) {} });
    overlay.querySelector('[data-prev]').addEventListener('click', () => flip && flip.flipPrev());
    overlay.querySelector('[data-next]').addEventListener('click', () => flip && flip.flipNext());
    overlay.querySelector('[data-zin]').addEventListener('click', () => setZoom(zoom + 0.6));
    overlay.querySelector('[data-zout]').addEventListener('click', () => setZoom(zoom - 0.6));
    const stage = overlay.querySelector('.wz-reader-stage');
    stage.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    stage.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    stage.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    stage.addEventListener('mousedown', onMouseDown, { capture: true });
    stage.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') flip && flip.flipPrev();
      else if (e.key === 'ArrowRight') flip && flip.flipNext();
      else if (e.key === '+' || e.key === '=') setZoom(zoom + 0.6);
      else if (e.key === '-') setZoom(zoom - 0.6);
    };
    document.addEventListener('keydown', onKey);
  }

  function close() {
    const cb = readerOpts && readerOpts.onClose;
    if (onKey) { document.removeEventListener('keydown', onKey); onKey = null; }
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    if (flip) { try { flip.destroy(); } catch (_) {} flip = null; }
    if (pdfDoc) { try { pdfDoc.destroy(); } catch (_) {} pdfDoc = null; }
    if (overlay) { overlay.remove(); overlay = null; }
    document.body.style.overflow = '';
    total = 0; pageDivs = []; rendered = [];
    zoom = 1; panX = 0; panY = 0; pinchD0 = 0; panActive = false; mDrag = false;
    readerOpts = null;
    if (typeof cb === 'function') { try { cb(); } catch (_) {} }
  }

  function fit(aspect) {
    const stage = overlay.querySelector('.wz-reader-stage');
    const sw = (stage.clientWidth || window.innerWidth) - 32;
    const sh = (stage.clientHeight || (window.innerHeight - 64)) - 32;
    const portrait = window.innerWidth < 900;
    const cols = portrait ? 1 : 2;
    let h = sh, w = h * aspect;
    if (w * cols > sw) { w = sw / cols; h = w / aspect; }
    return { w: Math.round(w), h: Math.round(h), portrait };
  }

  async function renderPage(i) {
    if (!pdfDoc || i < 0 || i >= total || rendered[i]) return;
    rendered[i] = true;
    let page;
    try { page = await pdfDoc.getPage(i + 1); } catch (_) { rendered[i] = false; return; }
    if (!overlay || !pageDivs[i]) return;
    const vp = page.getViewport({ scale: (dispW * dpr) / baseW });
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    try { await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; }
    catch (_) { rendered[i] = false; return; }
    if (!overlay || !pageDivs[i]) return;
    pageDivs[i].innerHTML = '';
    pageDivs[i].appendChild(cv);
  }
  function evictPage(i) {
    if (!rendered[i] || !pageDivs[i]) return;
    pageDivs[i].innerHTML = ''; rendered[i] = false;
  }
  function renderAround() {
    const cur = curIndex();
    for (let i = 0; i < total; i++) {
      if (i >= cur - NEAR && i <= cur + NEAR + 1) renderPage(i);
      else if (i < cur - KEEP || i > cur + KEEP + 1) evictPage(i);
    }
  }

  async function open(url, title, opts) {
    if (busy) return;
    busy = true;
    readerOpts = opts || null;
    build(title);
    const mine = overlay;
    try {
      await ensureLibs();
      pdfDoc = await window.pdfjsLib.getDocument({ url }).promise;
      if (overlay !== mine) return;
      total = pdfDoc.numPages;
      rendered = new Array(total).fill(false);
      const first = await pdfDoc.getPage(1);
      const base = first.getViewport({ scale: 1 });
      baseW = base.width; baseH = base.height;
      const { w, h, portrait } = fit(baseW / baseH);
      dispW = w; dpr = Math.min(window.devicePixelRatio || 1, 2);

      const book = overlay.querySelector('.wz-reader-book');
      pageDivs = [];
      for (let i = 0; i < total; i++) { const d = document.createElement('div'); d.className = 'wz-page'; book.appendChild(d); pageDivs.push(d); }

      flip = new window.St.PageFlip(book, {
        width: w, height: h, size: 'fixed',
        showCover: true, usePortrait: portrait,
        mobileScrollSupport: false, swipeDistance: 30,
        maxShadowOpacity: 0.35, drawShadow: true, flippingTime: 560, useMouseEvents: true
      });
      flip.loadFromHTML(book.querySelectorAll('.wz-page'));
      flip.on('flip', () => { resetZoom(); updateNo(); renderAround(); });
      flip.on('changeState', renderAround);
      resetZoom();
      renderAround();
      clearLoading();
      updateNo();
    } catch (err) {
      console.warn('[webzine-reader]', err && err.message);
      if (overlay === mine) {
        const el = overlay.querySelector('.wz-reader-loading');
        if (el) { el.className = 'wz-reader-error'; el.innerHTML = `불러오지 못했어요. <a href="${esc(url)}" target="_blank" rel="noopener">새 탭에서 열기 →</a>`; }
      }
    } finally {
      busy = false;
    }
  }

  window.WebzineReader = { open };
})();
