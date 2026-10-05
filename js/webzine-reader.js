'use strict';

// 5ft.mag 웹진 리더 — "책 읽기" 를 누르면 전체화면에서 PDF 를 책장 넘김(flipbook)으로 본다.
// PDF.js(페이지 렌더) + StPageFlip(넘김 효과)을 첫 열람 때만 CDN 에서 지연 로드한다.
// StPageFlip 은 HTML 모드로 쓰고, 보이는 페이지 주변만 레티나 해상도 캔버스로 직접 렌더하며
// 멀어진 페이지는 비운다(220 쪽도 메모리·선명도 문제 없이). 확대(핀치·버튼·드래그 팬) 지원.
// 실패 시 새 탭 링크를 보여준다.
(function () {
  const i18n = window.i18n;
  const T = i18n.t;
  const PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/';
  const PDFJS = PDFJS_BASE + 'legacy/build/pdf.min.mjs';
  const PDFJS_WORKER = PDFJS_BASE + 'legacy/build/pdf.worker.min.mjs';
  const FLIP = 'https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.js';
  const NEAR = 1, KEEP = 3;          // 현재 기준 ±NEAR 렌더, ±KEEP 밖은 비움
  const ZMAX = 3.5;
  const PROGRESS_KEY = '5ft-book-progress-v1';
  const PROGRESS_TTL = 180 * 86400000;
  const validBookKey = key => typeof key === 'string' && /^(webzine|ebook):[a-z0-9-]{1,100}:(free|full|preview)$/.test(key);
  function recentProgress() {
    try {
      const entries = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '[]');
      if (!Array.isArray(entries)) return [];
      return entries.filter(p => p && validBookKey(p.key) && Number.isInteger(p.page) && Number.isInteger(p.total)
        && p.page >= 1 && p.page <= p.total && p.total <= 5000
        && Number.isFinite(p.at) && p.at <= Date.now() && p.at > Date.now() - PROGRESS_TTL)
        .sort((a, b) => b.at - a.at).slice(0, 50)
        .map(({ key, page, total, at, fingerprint }) => ({ key, page, total, at, fingerprint: typeof fingerprint === 'string' ? fingerprint.slice(0, 128) : '' }));
    } catch (_) { return []; }
  }
  function progressFor(key) { return recentProgress().find(p => p.key === key) || null; }
  function saveProgress(force = false) {
    if (!readerShown || !pdfDoc || !validBookKey(readerOpts?.bookKey)) return;
    const key = readerOpts.bookKey, page = Math.min(curIndex() + 1, total);
    const previous = progressFor(key);
    if (!force && previous?.page === page && previous.total === total) return;
    const entry = { key, page, total, at: Date.now(), fingerprint: String(pdfDoc.fingerprints?.[0] || '').slice(0, 128) };
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify([entry, ...recentProgress().filter(p => p.key !== key)].slice(0, 50))); } catch (_) {}
  }

  const esc = window.MagUtil.escapeHtml;
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); });
  }
  let libsP = null;
  function ensureLibs() {
    if (libsP) return libsP;
    libsP = (async () => {
      await Promise.all([
        window.pdfjsLib ? Promise.resolve() : import(PDFJS).then(lib => { window.pdfjsLib = lib; }),
        window.St?.PageFlip ? Promise.resolve() : loadScript(FLIP),
      ]);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    })().catch(e => { libsP = null; throw e; });
    return libsP;
  }

  let overlay = null, flip = null, pdfDoc = null, loadingTask = null;
  let readerToken = 0, renderTasks = [], releaseAbort = null, releaseFocus = null;
  let total = 0, busy = false, onKey = null, readerOpts = null, readerShown = false;
  let pageDivs = [], rendered = [], baseW = 1, baseH = 1, dispW = 0, dpr = 1;
  let zoom = 1, panX = 0, panY = 0;
  let pinchD0 = 0, zoom0 = 1, panActive = false, px0 = 0, py0 = 0;

  function setLoading(msg) { const el = overlay && overlay.querySelector('.wz-reader-loading'); if (el) el.textContent = msg; }
  function clearLoading() { const el = overlay && overlay.querySelector('.wz-reader-loading'); if (el) el.remove(); }
  function curIndex() { return flip && flip.getCurrentPageIndex ? flip.getCurrentPageIndex() : 0; }
  function updateNo() {
    if (!flip || !overlay) return;
    const el = overlay.querySelector('[data-pageno]'); if (el) el.textContent = `${Math.min(curIndex() + 1, total)} / ${total}`;
    const note = overlay.querySelector('.wz-reader-cta-note');
    const visiblePages = curIndex() > 0 && flip.getOrientation?.() === 'landscape' ? 2 : 1;
    if (note) note.hidden = curIndex() + visiblePages < total;
    overlay.classList.toggle('is-preview-end', Boolean(note && !note.hidden));
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
    overlay.className = 'wz-reader' + (readerOpts?.deferReveal ? ' is-preparing' : '');
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    if (readerOpts?.deferReveal) { overlay.setAttribute('inert', ''); overlay.setAttribute('aria-hidden', 'true'); }
    overlay.innerHTML = `
      <div class="wz-reader-bar">
        <span class="wz-reader-title">${esc(title)}</span>
        <div class="wz-reader-tools">
          <button type="button" class="wz-reader-btn" data-zout aria-label="${T('축소', 'Zoom out', '縮小')}">−</button>
          <button type="button" class="wz-reader-btn" data-zin aria-label="${T('확대', 'Zoom in', '拡大')}">+</button>
          <button type="button" class="wz-reader-btn" data-first aria-label="${T('처음부터 읽기', 'Read from the beginning', '最初から読む')}" title="${T('처음부터 읽기', 'Read from the beginning', '最初から読む')}">↤</button>
          <button type="button" class="wz-reader-btn wz-reader-flipbtn" data-prev aria-label="${T('이전 페이지', 'Previous page', '前のページ')}">‹</button>
          <span class="wz-reader-pageno" data-pageno>· / ·</span>
          <button type="button" class="wz-reader-btn wz-reader-flipbtn" data-next aria-label="${T('다음 페이지', 'Next page', '次のページ')}">›</button>
          <button type="button" class="wz-reader-btn wz-reader-close" data-close aria-label="${T('닫기', 'Close', '閉じる')}">✕</button>
        </div>
      </div>
      ${readerOpts && readerOpts.cta ? `<div class="wz-reader-cta-wrap">${readerOpts.cta.note ? `<p class="wz-reader-cta-note" hidden>${esc(readerOpts.cta.note)}</p>` : ''}<button type="button" class="wz-reader-cta" data-cta>${esc(readerOpts.cta.label || T('전체 보기', 'View all', '全ページを見る'))}</button></div>` : ''}
      <div class="wz-reader-stage">
        <div class="wz-reader-loading">${T('불러오는 중…', 'Loading…', '読み込み中…')}</div>
        <div class="wz-reader-zoom"><div class="wz-reader-book"></div></div>
      </div>`;
    document.body.appendChild(overlay);
    if (!readerOpts?.deferReveal) document.body.style.overflow = 'hidden';
    overlay.querySelector('[data-close]').addEventListener('click', close);
    const ctaBtn = overlay.querySelector('[data-cta]');
    if (ctaBtn && readerOpts && readerOpts.cta) ctaBtn.addEventListener('click', () => { try { readerOpts.cta.onClick && readerOpts.cta.onClick(); } catch (_) {} });
    overlay.querySelector('[data-prev]').addEventListener('click', () => flip && flip.flipPrev());
    overlay.querySelector('[data-next]').addEventListener('click', () => flip && flip.flipNext());
    overlay.querySelector('[data-first]').addEventListener('click', async () => {
      const token = readerToken, button = overlay.querySelector('[data-first]');
      if (!flip || button.disabled) return;
      button.disabled = true;
      if (await renderPage(0) && token === readerToken) { flip.turnToPage(0); resetZoom(); updateNo(); renderAround(); saveProgress(); }
      if (token === readerToken) button.disabled = false;
    });
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
      if (overlay?.classList.contains('is-preparing')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') flip && flip.flipPrev();
      else if (e.key === 'ArrowRight') flip && flip.flipNext();
      else if (e.key === '+' || e.key === '=') setZoom(zoom + 0.6);
      else if (e.key === '-') setZoom(zoom - 0.6);
    };
    document.addEventListener('keydown', onKey);
  }

  function close() {
    const wasShown = readerShown;
    saveProgress(true); readerShown = false;
    readerToken++; busy = false;
    releaseAbort?.(); releaseAbort = null;
    releaseFocus?.(); releaseFocus = null;
    const cb = readerOpts && readerOpts.onClose;
    if (onKey) { document.removeEventListener('keydown', onKey); onKey = null; }
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    if (flip) { try { flip.destroy(); } catch (_) {} flip = null; }
    if (loadingTask?.destroy) { try { Promise.resolve(loadingTask.destroy()).catch(() => {}); } catch (_) {} }
    else if (pdfDoc) { try { Promise.resolve(pdfDoc.destroy()).catch(() => {}); } catch (_) {} }
    loadingTask = null; pdfDoc = null;
    if (overlay) { overlay.remove(); overlay = null; }
    document.body.style.overflow = '';
    total = 0; pageDivs = []; rendered = []; renderTasks = [];
    zoom = 1; panX = 0; panY = 0; pinchD0 = 0; panActive = false; mDrag = false;
    readerOpts = null;
    if (typeof cb === 'function') { try { cb(); } catch (_) {} }
    if (wasShown) window.dispatchEvent(new CustomEvent('webzine-progress'));
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

  function renderPage(i) {
    if (!pdfDoc || i < 0 || i >= total) return Promise.resolve(false);
    if (rendered[i]) return Promise.resolve(true);
    if (renderTasks[i]) return renderTasks[i];
    const doc = pdfDoc, target = pageDivs[i], token = readerToken, tasks = renderTasks;
    const valid = () => token === readerToken && pdfDoc === doc && pageDivs[i] === target;
    tasks[i] = (async () => {
      try {
        const page = await doc.getPage(i + 1);
        if (!valid()) return false;
        const vp = page.getViewport({ scale: (dispW * dpr) / baseW });
        const cv = document.createElement('canvas');
        cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        if (!valid()) return false;
        target.replaceChildren(cv); rendered[i] = true;
        return true;
      } catch (_) { return false; }
      finally { tasks[i] = null; }
    })();
    return tasks[i];
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
    if (opts?.signal?.aborted) return;
    if (overlay) close();
    busy = true;
    const started = performance.now();
    const metrics = {};
    if (Number.isFinite(opts?.accessMs) && opts.accessMs >= 0) metrics.access_ms = Math.round(opts.accessMs);
    const token = ++readerToken;
    readerOpts = opts || null;
    build(title);
    const mine = overlay;
    const active = () => readerToken === token && overlay === mine;
    if (opts?.signal) {
      const abort = () => { if (active()) close(); };
      opts.signal.addEventListener('abort', abort, { once: true });
      releaseAbort = () => opts.signal.removeEventListener('abort', abort);
    }
    try {
      await ensureLibs();
      if (!active()) return;
      metrics.libraries_ms = Math.round(performance.now() - started);
      const documentStarted = performance.now();
      metrics.transport = 'direct';
      const pdfOptions = {
        isEvalSupported: false,
        useWasm: false,
        wasmUrl: PDFJS_BASE + 'wasm/',
        cMapUrl: PDFJS_BASE + 'cmaps/',
        cMapPacked: true,
        standardFontDataUrl: PDFJS_BASE + 'standard_fonts/',
      };
      loadingTask = window.pdfjsLib.getDocument({ ...pdfOptions, url });
      const doc = await loadingTask.promise;
      if (!active()) return;
      pdfDoc = doc;
      metrics.document_ms = Math.round(performance.now() - documentStarted);
      total = pdfDoc.numPages;
      rendered = new Array(total).fill(false);
      const first = await pdfDoc.getPage(1);
      if (!active()) return;
      const base = first.getViewport({ scale: 1 });
      baseW = base.width; baseH = base.height;
      const { w, h, portrait } = fit(baseW / baseH);
      dispW = w; dpr = Math.min(window.devicePixelRatio || 1, 2);
      const saved = progressFor(opts?.bookKey);
      const sameDocument = saved && saved.total === total && (!saved.fingerprint || !doc.fingerprints?.[0] || saved.fingerprint === doc.fingerprints[0]);
      const startPage = opts?.startPage === 0 ? 0 : (sameDocument ? saved.page - 1 : 0);

      const book = overlay.querySelector('.wz-reader-book');
      pageDivs = [];
      for (let i = 0; i < total; i++) { const d = document.createElement('div'); d.className = 'wz-page'; book.appendChild(d); pageDivs.push(d); }

      flip = new window.St.PageFlip(book, {
        width: w, height: h, size: 'fixed',
        startPage,
        showCover: true, usePortrait: portrait,
        mobileScrollSupport: false, swipeDistance: 30,
        maxShadowOpacity: 0.35, drawShadow: true, flippingTime: 560, useMouseEvents: true
      });
      flip.loadFromHTML(book.querySelectorAll('.wz-page'));
      flip.on('flip', () => { resetZoom(); updateNo(); renderAround(); saveProgress(); });
      flip.on('changeState', renderAround);
      resetZoom();
      const firstIndex = curIndex();
      const renderStarted = performance.now();
      metrics.setup_ms = Math.round(renderStarted - documentStarted - metrics.document_ms);
      const visible = [firstIndex];
      if (!portrait && firstIndex > 0 && firstIndex + 1 < total) visible.push(firstIndex + 1);
      // 이어 읽는 펼침의 양쪽 페이지가 준비되기 전에는 빈 리더로 전환하지 않는다.
      if (!(await Promise.all(visible.map(renderPage))).every(Boolean)) {
        if (active()) throw new Error('First page could not render');
        return;
      }
      if (!active()) return;
      metrics.visible_pages_ms = Math.round(performance.now() - renderStarted);
      const handoffStarted = performance.now();
      if (opts?.onReady) await opts.onReady();
      if (!active()) return;
      mine.classList.remove('is-preparing'); mine.removeAttribute('inert'); mine.removeAttribute('aria-hidden');
      document.body.style.overflow = 'hidden';
      clearLoading();
      updateNo();
      readerShown = true; saveProgress(true);
      renderAround();
      releaseFocus = window.createFocusTrap?.(mine);
      if (opts?.deferReveal) mine.querySelector('[data-close]').focus({ preventScroll: true });
      metrics.handoff_ms = Math.round(performance.now() - handoffStarted);
      metrics.total_ms = Math.round(performance.now() - started);
      metrics.pages = total; metrics.start_page = firstIndex + 1;
      try { opts?.onMetrics?.(metrics); } catch (_) {}
      try { if (validBookKey(opts?.bookKey)) window.trackEvent?.('book_reader_ready', { book: opts.bookKey, ...metrics }); } catch (_) {}
    } catch (err) {
      if (!active()) return;
      console.warn('[webzine-reader]', err && err.message);
      if (active() && opts?.deferReveal) {
        const failed = opts.onError;
        close(); failed?.();
      } else if (active()) {
        const el = overlay.querySelector('.wz-reader-loading');
        if (el) { el.className = 'wz-reader-error'; el.innerHTML = `${T('불러오지 못했어요.', 'Could not load.', '読み込めませんでした。')} <a href="${esc(url)}" target="_blank" rel="noopener">${T('새 탭에서 열기 →', 'Open in a new tab →', '新しいタブで開く →')}</a>`; }
      }
    } finally {
      if (active()) busy = false;
    }
  }

  window.WebzineReader = { open, progressFor, recentProgress, prepare: () => ensureLibs().catch(() => {}) };
})();
