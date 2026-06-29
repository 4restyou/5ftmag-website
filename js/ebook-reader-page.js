'use strict';

// 이북 보호 뷰어 (flip / 책장) — 무료 Books 와 같은 StPageFlip 엔진 재사용.
// ?slug=<ebook slug>. 앞 1/3 무료 미리보기, 나머지는 열람권 보유자만.
// 페이지 이미지는 Edge Function(ebook-page)이 게이트해서 Blob 으로 내려준다.

(function () {
  const FLIP = 'https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.js';
  const NEAR = 1, KEEP = 3, ZMAX = 3.5;

  function $(id) { return document.getElementById(id); }
  function db() { return window.MagDB; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); });
  }

  let product = null, slug = '', total = 0, freeLimit = 0, entitled = false, flipTotal = 0;
  let overlay = null, flip = null, onKey = null;
  let pageDivs = [], rendered = [], blobUrls = [];
  let baseW = 1, baseH = 1;
  let zoom = 1, panX = 0, panY = 0, pinchD0 = 0, zoom0 = 1, panActive = false, px0 = 0, py0 = 0;

  function curIndex() { return flip && flip.getCurrentPageIndex ? flip.getCurrentPageIndex() : 0; }
  function updateNo() {
    const el = overlay && overlay.querySelector('[data-pageno]');
    if (el) el.textContent = `${Math.min(curIndex() + 1, flipTotal)} / ${flipTotal}`;
  }

  // ── zoom / pan (webzine-reader 와 동일) ──
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
  function setZoom(z) { zoom = Math.max(1, Math.min(ZMAX, z)); if (zoom <= 1.01) { zoom = 1; panX = 0; panY = 0; } else clampPan(); applyZoom(); }
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
  let wheelLock = false;
  function onWheel(e) {
    if (zoom > 1.01 || !flip) return;
    e.preventDefault();
    if (wheelLock) return;
    wheelLock = true; setTimeout(() => { wheelLock = false; }, 600);
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (d > 0) flip.flipNext(); else flip.flipPrev();
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

  // paywall 페이지 인덱스 (비구매자일 때만 존재) = freeLimit (0-based)
  function isPaywallIndex(i) { return !entitled && total > freeLimit && i === freeLimit; }
  function imagePageNum(i) { return i + 1; } // 1-based, paywall 앞쪽은 그대로 매핑

  async function renderPage(i) {
    if (i < 0 || i >= flipTotal || rendered[i] || !pageDivs[i]) return;
    rendered[i] = true;
    if (isPaywallIndex(i)) {
      pageDivs[i].innerHTML = `
        <div class="ebook-paywall">
          <p class="ebook-paywall-kicker">미리보기 여기까지</p>
          <h3>${esc(product.title)}</h3>
          <p class="ebook-paywall-sub">전체 ${total}쪽 중 ${freeLimit}쪽까지 보셨어요.<br>나머지 ${total - freeLimit}쪽은 구매 후 볼 수 있어요.</p>
          <button type="button" class="ebook-paywall-btn" data-action="buy">${product.price ? product.price.toLocaleString('ko-KR') + '원 · 구매하고 전체 보기' : '구매하고 전체 보기'}</button>
        </div>`;
      return;
    }
    const blob = await db().ebooks.fetchPage(slug, imagePageNum(i));
    if (!overlay || !pageDivs[i]) return;
    if (!blob) { rendered[i] = false; return; }
    const url = URL.createObjectURL(blob);
    blobUrls[i] = url;
    pageDivs[i].innerHTML = '';
    const img = document.createElement('img');
    img.decoding = 'async';
    img.draggable = false;
    img.src = url;
    pageDivs[i].appendChild(img);
  }
  function evictPage(i) {
    if (!rendered[i] || !pageDivs[i] || isPaywallIndex(i)) return;
    pageDivs[i].innerHTML = '';
    if (blobUrls[i]) { URL.revokeObjectURL(blobUrls[i]); blobUrls[i] = null; }
    rendered[i] = false;
  }
  function renderAround() {
    const cur = curIndex();
    for (let i = 0; i < flipTotal; i++) {
      if (i >= cur - NEAR && i <= cur + NEAR + 1) renderPage(i);
      else if (i < cur - KEEP || i > cur + KEEP + 1) evictPage(i);
    }
  }

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'wz-reader';
    overlay.innerHTML = `
      <div class="wz-reader-bar">
        <span class="wz-reader-title">${esc(product.title)}</span>
        <div class="wz-reader-tools">
          <button type="button" class="wz-reader-btn" data-zout aria-label="축소">−</button>
          <button type="button" class="wz-reader-btn" data-zin aria-label="확대">+</button>
          <button type="button" class="wz-reader-btn wz-reader-flipbtn" data-prev aria-label="이전 페이지">‹</button>
          <span class="wz-reader-pageno" data-pageno>· / ·</span>
          <button type="button" class="wz-reader-btn wz-reader-flipbtn" data-next aria-label="다음 페이지">›</button>
          <a class="wz-reader-btn wz-reader-close" href="books.html" aria-label="닫기">✕</a>
        </div>
      </div>
      <div class="wz-reader-stage">
        <div class="wz-reader-loading">불러오는 중…</div>
        <div class="wz-reader-zoom"><div class="wz-reader-book"></div></div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    overlay.querySelector('[data-prev]').addEventListener('click', () => flip && flip.flipPrev());
    overlay.querySelector('[data-next]').addEventListener('click', () => flip && flip.flipNext());
    overlay.querySelector('[data-zin]').addEventListener('click', () => setZoom(zoom + 0.6));
    overlay.querySelector('[data-zout]').addEventListener('click', () => setZoom(zoom - 0.6));
    overlay.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="buy"]')) onBuy();
    });
    const stage = overlay.querySelector('.wz-reader-stage');
    stage.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    stage.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    stage.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    stage.addEventListener('mousedown', onMouseDown, { capture: true });
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('contextmenu', (e) => { if (e.target.closest('.wz-reader-book')) e.preventDefault(); });
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    onKey = (e) => {
      if (e.key === 'Escape') location.href = 'books.html';
      else if (e.key === 'ArrowLeft') flip && flip.flipPrev();
      else if (e.key === 'ArrowRight') flip && flip.flipNext();
      else if (e.key === '+' || e.key === '=') setZoom(zoom + 0.6);
      else if (e.key === '-') setZoom(zoom - 0.6);
    };
    document.addEventListener('keydown', onKey);
  }

  function onBuy() {
    // 결제 연동(포트원)은 PR-3 에서 window.EbookCheckout.start 로 주입.
    if (window.EbookCheckout && typeof window.EbookCheckout.start === 'function') {
      window.EbookCheckout.start(product);
      return;
    }
    alert('구매 안내\n\n결제 준비 중이에요. 구매를 원하시면 인스타그램 @film_socialclub DM 으로 문의해 주세요. 입금 확인 후 전체 열람권을 드립니다.');
  }

  function gateMessage(html) {
    const root = $('ebookRoot');
    if (root) root.innerHTML = `<div class="ebook-gate">${html}</div>`;
  }

  async function openFlip() {
    buildOverlay();
    try {
      if (!(window.St && window.St.PageFlip)) await loadScript(FLIP);
      // 첫 페이지로 종횡비 파악
      const firstBlob = await db().ebooks.fetchPage(slug, 1);
      if (firstBlob) {
        const u = URL.createObjectURL(firstBlob);
        await new Promise((res) => { const im = new Image(); im.onload = () => { baseW = im.naturalWidth || 1200; baseH = im.naturalHeight || 1700; URL.revokeObjectURL(u); res(); }; im.onerror = () => { URL.revokeObjectURL(u); res(); }; im.src = u; });
      }
      const { w, h, portrait } = fit(baseW / baseH);

      const book = overlay.querySelector('.wz-reader-book');
      pageDivs = []; rendered = new Array(flipTotal).fill(false); blobUrls = new Array(flipTotal).fill(null);
      for (let i = 0; i < flipTotal; i++) { const d = document.createElement('div'); d.className = 'wz-page'; book.appendChild(d); pageDivs.push(d); }

      flip = new window.St.PageFlip(book, {
        width: w, height: h, size: 'fixed',
        showCover: true, usePortrait: portrait,
        mobileScrollSupport: false, swipeDistance: 30,
        maxShadowOpacity: 0.35, drawShadow: true, flippingTime: 560, useMouseEvents: true,
      });
      flip.loadFromHTML(book.querySelectorAll('.wz-page'));
      flip.on('flip', () => { resetZoom(); updateNo(); renderAround(); });
      flip.on('changeState', renderAround);
      resetZoom();
      renderAround();
      const ld = overlay.querySelector('.wz-reader-loading'); if (ld) ld.remove();
      updateNo();
    } catch (err) {
      console.warn('[ebook-reader]', err && err.message);
      const ld = overlay && overlay.querySelector('.wz-reader-loading');
      if (ld) { ld.className = 'wz-reader-error'; ld.textContent = '불러오지 못했어요. 잠시 후 다시 시도해 주세요.'; }
    }
  }

  async function init() {
    slug = (new URLSearchParams(location.search).get('slug') || '').trim();
    if (!slug) { gateMessage('<h2>잘못된 주소</h2><p>이북을 찾을 수 없어요.</p>'); return; }
    for (let i = 0; i < 60; i++) { if (db() && db().isReady()) break; await new Promise(r => setTimeout(r, 50)); }
    if (!db() || !db().isReady()) { gateMessage('<p>서비스 준비에 실패했어요. 잠시 후 새로고침해 주세요.</p>'); return; }

    product = await db().ebooks.get(slug);
    if (!product || !product.published) { gateMessage('<h2>없는 이북</h2><p>공개되지 않았거나 삭제된 이북이에요.</p>'); return; }
    document.title = `${product.title} | 5ft magazine`;

    total = product.page_count || 0;
    if (!total) { gateMessage('<h2>준비 중</h2><p>아직 페이지가 등록되지 않았어요.</p>'); return; }
    freeLimit = Math.max(1, Math.ceil(total / 3));

    const session = await db().auth.getSession();
    entitled = session ? await db().ebooks.hasAccess(product.id) : false;

    // 표시할 flip 페이지 수: 구매자=전체, 비구매자=무료분 + paywall 1장
    flipTotal = entitled ? total : Math.min(freeLimit, total) + (total > freeLimit ? 1 : 0);
    await openFlip();
  }

  init();
})();
