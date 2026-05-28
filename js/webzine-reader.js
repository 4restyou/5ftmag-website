'use strict';

// 5ft.mag 웹진 리더 — "책 읽기" 를 누르면 전체화면에서 PDF 를 책장 넘김(flipbook)으로 본다.
// PDF.js(페이지 렌더) + StPageFlip(넘김 효과)을 첫 열람 때만 CDN 에서 지연 로드한다.
// 실패하면 오버레이 안에 "새 탭에서 열기" 링크를 보여준다.
(function () {
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const FLIP = 'https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.js';

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

  let overlay = null, flip = null, pdfDoc = null, total = 0, busy = false, onKey = null;

  function setLoading(msg) { const el = overlay && overlay.querySelector('.wz-reader-loading'); if (el) el.textContent = msg; }
  function clearLoading() { const el = overlay && overlay.querySelector('.wz-reader-loading'); if (el) el.remove(); }
  function updateNo() {
    if (!flip || !overlay) return;
    const i = (flip.getCurrentPageIndex && flip.getCurrentPageIndex()) || 0;
    const el = overlay.querySelector('[data-pageno]'); if (el) el.textContent = `${Math.min(i + 1, total)} / ${total}`;
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
    total = 0;
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

  async function renderToUrl(pageNum, targetW) {
    const page = await pdfDoc.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: targetW / base.width });
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    return cv.toDataURL('image/jpeg', 0.85);
  }

  async function open(url, title) {
    if (busy) return;
    busy = true;
    build(title);
    const mine = overlay;
    try {
      await ensureLibs();
      pdfDoc = await window.pdfjsLib.getDocument({ url }).promise;
      if (overlay !== mine) return;               // 닫힘
      total = pdfDoc.numPages;
      const first = await pdfDoc.getPage(1);
      const base = first.getViewport({ scale: 1 });
      const aspect = base.width / base.height;
      const { w, h, portrait } = fit(aspect);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.max(820, Math.min(Math.round(w * dpr), 1500));
      const urls = [];
      for (let i = 1; i <= total; i++) {
        setLoading(`불러오는 중… ${i} / ${total}`);
        urls.push(await renderToUrl(i, targetW));
        if (overlay !== mine) return;             // 렌더 중 닫힘
      }
      const book = overlay.querySelector('.wz-reader-book');
      flip = new window.St.PageFlip(book, {
        width: w, height: h, size: 'fixed',
        showCover: true, usePortrait: portrait,
        mobileScrollSupport: false, swipeDistance: 30,
        maxShadowOpacity: 0.5, drawShadow: true, flippingTime: 700
      });
      flip.loadFromImages(urls);
      flip.on('flip', updateNo);
      flip.on('init', updateNo);
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
