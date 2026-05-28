'use strict';

// 5ft.mag 웹진 리더 — "책 읽기" 를 누르면 전체화면에서 PDF 를 책장 넘김(flipbook)으로 본다.
// PDF.js(페이지 렌더) + StPageFlip(넘김 효과)을 첫 열람 때만 CDN 에서 지연 로드한다.
// StPageFlip 은 HTML 모드로 쓰고, 보이는 페이지 주변만 레티나 해상도 캔버스로 직접 렌더하며
// 멀어진 페이지는 비운다(220 쪽짜리도 메모리·선명도 문제 없이). 실패 시 새 탭 링크를 보여준다.
(function () {
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const FLIP = 'https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.js';
  const NEAR = 2, KEEP = 5;          // 현재 기준 ±NEAR 렌더, ±KEEP 밖은 비움

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
  let total = 0, busy = false, onKey = null;
  let pageDivs = [], rendered = [], baseW = 1, baseH = 1, dispW = 0, dpr = 1;

  function setLoading(msg) { const el = overlay && overlay.querySelector('.wz-reader-loading'); if (el) el.textContent = msg; }
  function clearLoading() { const el = overlay && overlay.querySelector('.wz-reader-loading'); if (el) el.remove(); }
  function curIndex() { return flip && flip.getCurrentPageIndex ? flip.getCurrentPageIndex() : 0; }
  function updateNo() {
    if (!flip || !overlay) return;
    const el = overlay.querySelector('[data-pageno]'); if (el) el.textContent = `${Math.min(curIndex() + 1, total)} / ${total}`;
  }

  function build(title) {
    overlay = document.createElement('div');
    overlay.className = 'wz-reader';
    overlay.innerHTML = `
      <div class="wz-reader-bar">
        <span class="wz-reader-title">${esc(title)}</span>
        <div class="wz-reader-tools">
          <button type="button" class="wz-reader-btn" data-prev aria-label="이전 페이지">‹</button>
          <span class="wz-reader-pageno" data-pageno>· / ·</span>
          <button type="button" class="wz-reader-btn" data-next aria-label="다음 페이지">›</button>
          <button type="button" class="wz-reader-btn wz-reader-close" data-close aria-label="닫기">✕</button>
        </div>
      </div>
      <div class="wz-reader-stage">
        <div class="wz-reader-loading">불러오는 중…</div>
        <div class="wz-reader-book"></div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    overlay.querySelector('[data-close]').addEventListener('click', close);
    overlay.querySelector('[data-prev]').addEventListener('click', () => flip && flip.flipPrev());
    overlay.querySelector('[data-next]').addEventListener('click', () => flip && flip.flipNext());
    onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') flip && flip.flipPrev();
      else if (e.key === 'ArrowRight') flip && flip.flipNext();
    };
    document.addEventListener('keydown', onKey);
  }

  function close() {
    if (onKey) { document.removeEventListener('keydown', onKey); onKey = null; }
    if (flip) { try { flip.destroy(); } catch (_) {} flip = null; }
    if (pdfDoc) { try { pdfDoc.destroy(); } catch (_) {} pdfDoc = null; }
    if (overlay) { overlay.remove(); overlay = null; }
    document.body.style.overflow = '';
    total = 0; pageDivs = []; rendered = [];
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

  async function open(url, title) {
    if (busy) return;
    busy = true;
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
        maxShadowOpacity: 0.5, drawShadow: true, flippingTime: 700, useMouseEvents: true
      });
      flip.loadFromHTML(book.querySelectorAll('.wz-page'));
      flip.on('flip', () => { updateNo(); renderAround(); });
      flip.on('changeState', renderAround);
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
