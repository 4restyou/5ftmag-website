'use strict';

// 5ft.mag 웹진 — 세로 책장. 유료 이북(ebook_products)과 무료 웹진(webzine_issues)을 한 줄로 합쳐
// 올린 순서(최신이 위)로 눕혀 쌓는다. 유료는 양장(천 짜임 + 금박), 무료는 종이(크라프트 + 톤온톤 박).
// 책을 누르면 목록이 물러나고 책이 일어서는 소개 화면(.wz-detail)으로 간다. 소개 화면은 책마다 한 장이라
// 아래로 넘기면 다음 책, ← 나 Esc 로 목록에 돌아온다. 이전 코버플로우 책장은 webzine-page.js (books-classic.html).
(function () {
  const i18n = window.i18n;
  const T = i18n.t;
  const won = (n) => window.MagUtil.formatPrice(n);
  const stack = document.getElementById('wzStack');
  if (!stack) return;
  const marks = document.getElementById('wzMarks');
  const libraryLink = marks.querySelector('.wz-library-link');
  const detail = document.getElementById('wzDetail');
  const pagesEl = document.getElementById('wzPages');
  const backBtn = document.getElementById('wzBack');
  const shelfStage = stack.closest('.wz-stage');
  detail.prepend(backBtn);
  detail.setAttribute('role', 'dialog');
  detail.setAttribute('aria-modal', 'true');
  detail.setAttribute('inert', '');
  const root = document.documentElement;
  const HOVERABLE = window.matchMedia?.('(hover: hover)')?.matches !== false;

  function db() { return window.MagDB; }
  const esc = window.MagUtil.escapeHtml;
  const FALLBACK = ['#7a3b52', '#3f5a78', '#6b5036', '#4a6b4f', '#5a4a78', '#8a4a32'];
  const coverUrl = (it) => (it.cover_url ? it.cover_url : (it.cover_path ? db().webzine.publicUrl(it.cover_path) : ''));

  // ── 재질 텍스처: 캔버스로 만든다(파일 없이). 양장은 사인파 높이맵을 조명한 천 짜임, 종이는 씨앗 고정 난수의 크라프트 입자 ──
  // 양장 천(린넨): 실 한 올이 3px, 날실·씨실이 한 칸씩 번갈아 위로 올라오고(평직), 올마다 굵기·밝기가 조금씩 다르다.
  // 높이맵을 왼쪽 위 빛으로 비춰 결을 세운다. CSS 에서 절반 크기로 깔아 레티나에서도 곱게 보인다
  function weaveTexture() {
    const S = 144, P = 3, c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d'), img = ctx.createImageData(S, S), h = new Float32Array(S * S), PI = Math.PI;
    let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const warp = Array.from({ length: S / P }, () => (rnd() - .5) * .35), weft = Array.from({ length: S / P }, () => (rnd() - .5) * .35);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const tx = Math.floor(x / P), ty = Math.floor(y / P), fx = (x % P + .5) / P, fy = (y % P + .5) / P;
      const up = (tx + ty) % 2 === 0;
      const v = up ? Math.sin(fx * PI) * (.85 + warp[tx]) : Math.sin(fy * PI) * (.85 + weft[ty]);
      h[y * S + x] = .25 + v * .6 + (rnd() - .5) * .12;
    }
    const at = (x, y) => h[((y + S) % S) * S + ((x + S) % S)];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4, dx = at(x + 1, y) - at(x - 1, y), dy = at(x, y + 1) - at(x, y - 1);
      const v = Math.max(0, Math.min(1, .55 - (dx + dy) * .9 + (h[y * S + x] - .5) * .5)), g = Math.round(130 + v * 125);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return `url("${c.toDataURL('image/png')}")`;
  }
  function kraftTexture() {
    const S = 160, c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const base = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) base[i] = rnd();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let s = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) s += base[((y + oy + S) % S) * S + ((x + ox + S) % S)];
      const v = s / 9, fiber = rnd() < .04 ? .35 : 0;
      const g = Math.round(165 + (v - .5) * 70 + fiber * 60), p = (y * S + x) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = Math.max(0, Math.min(255, g)); img.data[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return `url("${c.toDataURL('image/png')}")`;
  }
  try { root.style.setProperty('--wz-weave', weaveTexture()); root.style.setProperty('--wz-kraft', kraftTexture()); } catch (_) {}

  // ── 표지에서 책 색(책등·배경)과 비율을 뽑는다. webzine-page.js 와 같은 방법 ──
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  function hex([r, g, b]) { return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''); }
  function vivid(r, g, b) {
    let [h, s, l] = rgbToHsl(r, g, b);
    s = Math.min(1, s * 1.3 + 0.06);
    l = Math.min(0.5, Math.max(0.26, l));
    return hex(hslToRgb(h, s, l));
  }
  // 책 색(책등·배경): 표지 바깥 테두리 띠(10%)만 보고, 평균이 아니라 가장 넓게 쓰인 색을 고른다.
  // 전체 평균은 위가 노랑·아래가 파랑인 표지에서 둘이 섞인 올리브가 나오는 식으로 표지와 딴 색이 됐다.
  // 색상 15도 단위로 묶고(무채색은 따로 한 묶음), 픽셀이 가장 많은 묶음의 평균색을 쓴다.
  function pickBase(d, S) {
    const band = Math.max(2, Math.round(S * .1));
    const bins = new Array(25).fill(null);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (x >= band && x < S - band && y >= band && y < S - band) continue;
      const i = (y * S + x) * 4;
      if (d[i + 3] < 128) continue;
      const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      const k = (s < .18 || l < .08 || l > .95) ? 24 : Math.floor(h / 15) % 24;
      const bin = bins[k] || (bins[k] = { n: 0, r: 0, g: 0, b: 0 });
      bin.n++; bin.r += d[i]; bin.g += d[i + 1]; bin.b += d[i + 2];
    }
    let best = -1;
    bins.forEach((bin, k) => { if (bin && (best < 0 || bin.n > bins[best].n)) best = k; });
    if (best < 0) return null;
    const bin = bins[best];
    return vivid(bin.r / bin.n, bin.g / bin.n, bin.b / bin.n);
  }
  // 박 색: 표지에서 바탕색과 색상(hue)이 다른 색 가운데, 바탕과 밝기 대비가 크고 위·아래 가장자리(제목 자리)에
  // 많이 쓰인 것. 표지의 제목 글씨 색이 대체로 이것이다(사진 속 큰 색면이 이기지 않게 가운데는 가중치를 낮춘다).
  // 책등(바탕색)에서 읽히도록 밝기를 .52~.74 로 맞춘다.
  function pickAccent(d, S, baseHex) {
    const n = parseInt(baseHex.slice(1), 16);
    const [bh, , bl] = rgbToHsl(n >> 16 & 255, n >> 8 & 255, n & 255);
    const bins = new Array(24).fill(null);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      if (s < .2 || l < .15 || l > .93) continue;
      const y = Math.floor(i / 4 / S) / S, edge = (y < .3 || y > .7) ? 2 : 1;
      const w = s * (.2 + Math.abs(l - bl)) * edge;
      const k = Math.floor(h / 15) % 24;
      const bin = bins[k] || (bins[k] = { w: 0, px: 0, r: 0, g: 0, b: 0 });
      bin.w += w; bin.px++; bin.r += d[i] * w; bin.g += d[i + 1] * w; bin.b += d[i + 2] * w;
    }
    const hueDist = (k) => { const dh = Math.abs(k * 15 + 7.5 - bh); return Math.min(dh, 360 - dh); };
    let best = -1;
    bins.forEach((bin, k) => { if (bin && hueDist(k) > 20 && (best < 0 || bin.w > bins[best].w)) best = k; });
    if (best < 0 || bins[best].px < S * S * .004) return null;   // 바탕과 같은 색뿐이거나 너무 적으면(표지 0.4% 미만) 기본 박을 쓴다
    const bin = bins[best];
    let [h, s, l] = rgbToHsl(bin.r / bin.w, bin.g / bin.w, bin.b / bin.w);
    s = Math.max(.45, s);
    // 책등 바탕과 밝기 차가 .3 은 나야 읽힌다. 원래 밝은 쪽이면 더 밝게, 어두운 쪽이면 더 어둡게 민다
    if (Math.abs(l - bl) < .3) l = (l >= bl - .05) ? bl + .3 : bl - .3;
    l = Math.min(.88, Math.max(.18, l));
    return hex(hslToRgb(h, s, l));
  }
  function pickColor(img) {
    const aspect = img.naturalWidth / img.naturalHeight;
    try {
      const S = 48, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
      const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, S, S);
      const d = ctx.getImageData(0, 0, S, S).data;
      const color = pickBase(d, S);
      return { color, accent: color ? pickAccent(d, S, color) : null, aspect };
    } catch (_) { return { color: null, accent: null, aspect }; }
  }
  // 배경이 밝으면 검은 글씨, 어두우면 흰 글씨
  function fgFor(h) {
    const n = parseInt(h.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    return ((r * 299 + g * 587 + b * 114) / 255000) > .56 ? '#17131a' : '#fbf8f2';
  }

  let issues = [];
  let rows = [], hits = [], pages = [], markEls = [];
  let favSet = new Set();
  let inDetail = false, closing = false, savedScroll = 0, current = 0;
  let detailTransition = 0;
  let shelfObserver = null, pendingSelection = null, releaseDetailFocus = null;
  let ownershipRequest = 0, ownershipSubscribed = false;
  let coverWarmTimer = null, lastInteraction = 0;
  const readRequests = new Map();

  // 표지와 색 분석은 같은 이미지를 공유하고, 보이는 책과 이웃 책만 준비한다.
  function prepareBook(i, priority = 'low') {
    const it = issues[i], page = pages[i], row = rows[i];
    if (!it || !page || !row) return Promise.resolve();
    const images = [row.querySelector('img'), page.querySelector('img')].filter(Boolean);
    const img = images[0];
    if (!img) return Promise.resolve();
    if (!it._coverPrepared) {
      it._coverPrepared = true;
      const analyze = () => {
        if (!img.naturalWidth || !img.naturalHeight) return;
        const work = () => {
          if (issues[i] !== it) return;
          const c = pickColor(img);
          setBookColor(i, c.color, c.aspect < 1.2 ? c.aspect : 0, c.accent);
          if (!inDetail && markEls[i]?.classList.contains('on')) root.style.setProperty('--wz-mood', it._c);
        };
        if (window.requestIdleCallback) window.requestIdleCallback(work, { timeout: 1000 });
        else setTimeout(work, 32);
      };
      img.addEventListener('load', analyze, { once: true });
      if (img.complete && img.naturalWidth) analyze();
      it._coverPromise = Promise.all(images.map((image, k) => new Promise(resolve => {
        const ready = async () => {
          try { await image.decode?.(); } catch (_) {}
          if (issues[i] === it && image.naturalWidth) (k === 0 ? row : page).classList.add('cover-ready');
          resolve();
        };
        let retried = false;
        image.addEventListener('load', ready, { once: true });
        image.addEventListener('error', () => {
          if (retried) { resolve(); return; }
          retried = true; image.removeAttribute('crossorigin'); image.src = image.dataset.cover;
        });
        if (image.complete && image.naturalWidth) ready();
      })));
    }
    images.forEach(image => {
      if (priority === 'high' || !image.hasAttribute('src')) image.fetchPriority = priority;
      if (!image.hasAttribute('src')) {
        image.src = image.dataset.cover;
      }
    });
    return it._coverPromise;
  }
  function prepareNearby(i) {
    for (let k = Math.max(0, i - 1); k <= Math.min(issues.length - 1, i + 1); k++) {
      pages[k].classList.add('is-near');
      prepareBook(k, k === i ? 'high' : 'low');
    }
  }
  function warmRemainingCovers() {
    clearTimeout(coverWarmTimer);
    if (navigator.connection?.saveData || ['slow-2g', '2g'].includes(navigator.connection?.effectiveType)) return;
    coverWarmTimer = setTimeout(async () => {
      if (document.hidden || performance.now() - lastInteraction < 1200 || readRequests.size || document.querySelector('.wz-reader')) {
        warmRemainingCovers(); return;
      }
      const i = issues.map((it, k) => ({ it, k })).filter(({ it }) => !it._coverPrepared && coverUrl(it))
        .sort((a, b) => Math.abs(a.k - current) - Math.abs(b.k - current))[0]?.k;
      if (i === undefined) return;
      await prepareBook(i);
      warmRemainingCovers();
    }, 3000);
  }

  function pubOf(it) {
    if (it._ebook) return it.kind === 'backissue' ? '5ft.mag' : T('S.P.C 사진첩', 'S.P.C Photobook', 'S.P.C 写真集');
    return (it.category && it.category.trim()) || '5ft.mag';
  }

  const isPaid = (it) => it._ebook && Number(it.price) > 0;
  function accessLabel(it) {
    return isPaid(it) ? T('유료 전자책', 'Paid ebook', '有料電子書籍') : T('무료 열람', 'Free to read', '無料閲覧');
  }
  function bookByline(it) {
    return it.author || pubOf(it);
  }
  function updateSelection(i) {
    hits.forEach((hit, k) => { hit.tabIndex = k === i ? 0 : -1; });
  }

  function observeShelf() {
    shelfObserver?.disconnect();
    if (!rows.length) return;
    const headerHeight = document.querySelector('body > header')?.getBoundingClientRect().height || 0;
    const introHeight = document.querySelector('.wz-intro')?.getBoundingClientRect().height || 0;
    const inset = Math.min(window.innerHeight - 80, headerHeight + introHeight);
    const center = (inset + window.innerHeight) / 2;
    root.style.setProperty('--wz-scroll-inset', inset + 'px');
    root.style.setProperty('--wz-scroll-tail', (window.innerHeight - inset) / 2 + 'px');
    const visible = new Set();
    shelfObserver = new IntersectionObserver((entries) => {
      entries.forEach(en => { if (en.isIntersecting) visible.add(en.target); else visible.delete(en.target); });
      if (inDetail || closing) return;
      const nearest = Array.from(visible).sort((a, b) => {
        const distance = el => { const r = el.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - center); };
        return distance(a) - distance(b);
      })[0];
      if (!nearest) return;
      const i = Number(nearest.dataset.i);
      if (pendingSelection !== null && pendingSelection !== i) return;
      pendingSelection = null;
      updateSelection(i); setMark(i); root.style.setProperty('--wz-mood', issues[i]._c);
    }, { rootMargin: `-${Math.round(center - 16)}px 0px -${Math.round(window.innerHeight - center - 16)}px 0px`, threshold: 0 });
    rows.forEach(row => shelfObserver.observe(row));
  }

  function rowMarkup(it, i) {
    const cu = coverUrl(it);
    const cover = cu
      ? `<img data-cover="${esc(cu)}" alt="" crossorigin="anonymous" decoding="async" />`
      : `<span class="wz-plain"><b class="wz-foil">${esc(it.title)}</b><span class="wz-foil">${esc(pubOf(it))}${it.issue_label ? ' · ' + esc(it.issue_label) : ''}</span></span>`;
    return `<div class="wz-book">
      <button class="wz-hit" type="button" aria-label="${esc(bookByline(it))} ${esc(it.title)}, ${accessLabel(it)}${T(' 소개 보기', ', view details', '、詳細を見る')}"></button>
      <span class="wz-b wz-back-cover wz-mat"></span>
      <span class="wz-b wz-side-l"></span><span class="wz-b wz-side-r"></span><span class="wz-b wz-fore"></span>
      <span class="wz-b wz-cover wz-mat${cu ? ' has-img' : ''}">${cover}</span>
      <span class="wz-b wz-spine wz-mat"><span class="wz-pub wz-foil">${esc(pubOf(it))}</span><span class="wz-title wz-foil">${esc(it.title)}${it.issue_label ? `<span class="wz-issue wz-foil">${esc(it.issue_label)}</span>` : ''}</span><span class="wz-mark5" aria-hidden="true"></span></span>
    </div>`;
  }
  function actsMarkup(it) {
    if (it._ebook) {
      const href = `${i18n.url('/ebook-read.html')}?slug=${encodeURIComponent(it.slug)}`;
      return `<a class="wz-act wz-preview" href="${href}"><span>${T('미리보기', 'Preview', 'プレビュー')}</span><i>↗</i></a>` +
        (isPaid(it) ? `<a class="wz-act wz-buy" href="${href}&amp;buy=1"><span>${T('구매하기', 'Purchase', '購入する')}</span><i>↗</i></a>` : '');
    }
    const read = it.pdf_path ? esc(db().webzine.publicUrl(it.pdf_path)) : '';
    return read ? `<a class="wz-act wz-read" href="${read}" target="_blank" rel="noopener"><span>${T('읽기', 'Read', '読む')}</span><i>→</i></a>` : '';
  }
  function progressKey(it, entitled = it._owns) { return `${it._ebook ? 'ebook' : 'webzine'}:${it.slug}:${it._ebook ? (entitled || !isPaid(it) ? 'full' : 'preview') : 'free'}`; }
  function updateReadingProgress() {
    const reader = window.WebzineReader;
    if (!reader?.progressFor) return;
    issues.forEach((it, i) => {
      const page = pages[i], progress = reader.progressFor(progressKey(it));
      const action = page.querySelector('.wz-read, .wz-own') || page.querySelector('.wz-preview');
      if (!action) return;
      const resume = progress && progress.page > 1;
      const label = resume
        ? T(`이어서 읽기 · ${progress.page}쪽`, `Continue · page ${progress.page}`, `続きから読む · ${progress.page}ページ`)
        : (it._ebook ? (it._owns ? T('전체 읽기', 'Read the whole book', '全編を読む') : T('미리보기', 'Preview', 'プレビュー')) : T('읽기', 'Read', '読む'));
      action.querySelector('span').textContent = label;
      page.querySelector('.wz-start-over').hidden = !resume;
    });
    const recent = reader.recentProgress?.().find(p => issues.some(it => progressKey(it) === p.key) && p.page > 1);
    const intro = document.querySelector('.wz-intro-inner');
    let link = intro?.querySelector('.wz-continue');
    if (!intro) return;
    if (!recent) { link?.remove(); return; }
    const i = issues.findIndex(it => progressKey(it) === recent.key);
    if (!link) {
      link = document.createElement('a'); link.className = 'wz-continue'; intro.appendChild(link);
      link.addEventListener('click', e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); openDetail(Number(link.dataset.i), e.detail === 0); });
    }
    link.dataset.i = i;
    link.href = i18n.url('/books.html') + '?issue=' + encodeURIComponent(issues[i].slug);
    link.textContent = T(`읽던 책 · ${issues[i].title} · ${recent.page}쪽 →`, `Last read · ${issues[i].title} · page ${recent.page} →`, `読んでいた本 · ${issues[i].title} · ${recent.page}ページ →`);
  }
  function pageMarkup(it, i) {
    const cu = coverUrl(it);
    const front = cu
      ? `<img data-cover="${esc(cu)}" alt="${esc(it.title)}${T(' 표지', ' cover', ' 表紙')}" crossorigin="anonymous" decoding="async" /><span class="wz-plain2 wz-cover-fallback" aria-hidden="true"><b>${esc(it.title)}</b><span>${esc(pubOf(it))}</span></span>`
      : `<span class="wz-plain2"><b class="wz-foil">${esc(it.title)}</b><span class="wz-foil">${esc(pubOf(it))}${it.issue_label ? ' · ' + esc(it.issue_label) : ''}</span></span>`;
    const side = it._ebook ? '' : `<div class="wz-side-acts">
        <button type="button" class="wz-side-act wz-like" aria-pressed="false">♡ <span>${T('좋아요', 'Like', 'いいね')}</span></button>
        <button type="button" class="wz-side-act wz-share">↗ <span>${T('공유', 'Share', '共有')}</span></button>
      </div>`;
    return `<div class="wz-page-in">
      <div class="wz-stage3d"><div class="wz-sbook"><div class="wz-tilt">
        <span class="wz-f wz-f-back wz-mat"></span>
        <span class="wz-f wz-f-top"></span><span class="wz-f wz-f-bottom"></span><span class="wz-f wz-f-fore"></span>
        <span class="wz-f wz-f-spine wz-mat"><span class="wz-sp-pub wz-foil">${esc(pubOf(it))}</span><span class="wz-sp-title wz-foil">${esc(it.title)}</span><span class="wz-sp-mark" aria-hidden="true"></span></span>
        <span class="wz-f wz-f-page"></span>
        <span class="wz-leaf"><span class="wz-f wz-f-inside wz-mat"></span><span class="wz-f wz-f-front wz-mat${cu ? ' has-img' : ''}">${front}</span></span>
      </div></div><div class="wz-sshadow" aria-hidden="true"></div></div>
      <div class="wz-meta">
        <span class="wz-kind">${accessLabel(it)}</span>
        <h2 id="wz-book-title-${i}">${esc(it.title)}</h2>
        <p class="wz-by">${esc(bookByline(it))}${it.issue_label ? ' · ' + esc(it.issue_label) : ''}</p>
        ${isPaid(it) ? `<p class="wz-book-info wz-price"><span>${T('전자책 열람권', 'Ebook reading access', '電子書籍の閲覧権')} · ${won(it.price)}</span><span class="wz-owned" hidden>${T('구매함', 'Purchased', '購入済み')}</span></p>` : ''}
        ${it.binding ? `<p class="wz-book-info">${T('도서 제본 정보', 'Book binding', '本の製本情報')}: ${esc(it.binding)}</p>` : ''}
        <div class="wz-rule"></div>
        ${it.description ? `<p class="wz-desc">${esc(it.description)}</p><button type="button" class="wz-more" aria-expanded="false">${T('더 보기', 'More', 'もっと見る')}</button>` : ''}
        <div class="wz-action-area">
          <div class="wz-acts">${actsMarkup(it)}</div>
          <div class="wz-opening-status" hidden><p role="status" id="wz-preparation-${i}"><strong>${T('책을 여는 중입니다', 'Preparing your book', '本を開く準備をしています')}</strong><span class="wz-opening-hint" hidden>${T('처음 열 때는 시간이 조금 걸릴 수 있습니다.', 'The first opening may take a little longer.', '初回は少し時間がかかる場合があります。')}</span></p><button type="button" class="wz-cancel-read" aria-describedby="wz-preparation-${i}">${T('취소', 'Cancel', 'キャンセル')}</button></div>
        </div>
        ${isPaid(it) ? `<p class="wz-access-note">${T('미리보기는 일부 페이지만 제공됩니다. 전자책 열람권을 구매하면 전체를 읽을 수 있으며, 실물 도서는 포함되지 않습니다.', 'The preview includes selected pages. Ebook reading access unlocks the full edition; a printed book is not included.', 'プレビューは一部のページのみです。電子書籍の閲覧権で全ページを読めます。紙の本は含まれません。')}</p>` : ''}
        <button type="button" class="wz-start-over" hidden>${T('처음부터 읽기', 'Read from the beginning', '最初から読む')}</button>
        ${side}
      </div>
    </div>`;
  }

  function setMark(i) { markEls.forEach((m, k) => m.classList.toggle('on', k === i)); }
  // 눈금 위 마우스: 가까울수록 길게(6칸 안에서 부채꼴), 옆에 제목
  function hoverMark(i) {
    const label = marks.querySelector('.wz-mark-label');
    marks.classList.toggle('is-hover', i >= 0);
    markEls.forEach((m, k) => { const t = (k - i) / 2.4; m.style.setProperty('--x', i < 0 ? '0' : Math.exp(-t * t).toFixed(3)); });
    if (!label) return;
    if (i < 0) { label.classList.remove('show'); return; }
    const m = markEls[i];
    label.innerHTML = `<small>${esc(m.dataset.pub)}</small>${esc(m.dataset.title)}`;
    label.style.top = (m.offsetTop + m.offsetHeight / 2) + 'px';
    label.classList.add('show');
  }
  const HEX = /^#[0-9a-f]{6}$/i;
  function setBookColor(i, color, aspect, accent) {
    const it = issues[i];
    // 관리 화면에서 직접 정한 색이 있으면 그것을 쓴다. 없으면 표지에서 뽑은 색
    if (HEX.test(it.spine_color || '')) color = it.spine_color;
    if (HEX.test(it.foil_color || '')) accent = it.foil_color;
    if (color) it._c = color;
    const c = it._c, ct = fgFor(c);
    [rows[i], pages[i]].forEach(el => {
      if (!el) return;
      el.style.setProperty('--c', c); el.style.setProperty('--ct', ct);
      if (aspect) el.style.setProperty('--ar', aspect.toFixed(4));
      if (accent) el.style.setProperty('--foil', accent);
    });
    if (pages[i]) pages[i].style.setProperty('--wz-fg', ct);
  }

  // 소개글이 잘렸을 때만 "더 보기" 를 보인다
  function measureDesc(page) {
    const d = page.querySelector('.wz-desc'), b = page.querySelector('.wz-more');
    if (!d || !b) return;
    if (d.classList.contains('is-open')) return;
    b.classList.toggle('show', d.scrollHeight - d.clientHeight > 4);
  }

  // 위치는 레이아웃이 바뀔 때만 재고, 실제 스크롤 모션은 브라우저의 view timeline에 맡긴다.
  function measureDetailMotion() {
    const positions = pages.map(page => {
      const stage = page.querySelector('.wz-stage3d');
      const style = getComputedStyle(page);
      return {
        stage,
        entry: -Math.max(0, stage.offsetTop - (parseFloat(style.paddingTop) || 0)),
      };
    });
    positions.forEach(({ stage, entry }) => {
      stage.style.setProperty('--wz-entry-shift', entry + 'px');
    });
  }

  // ← 는 눈금 바로 위에. 눈금이 길어지면 그만큼 따라 올라간다. 폰(눈금 없음)에서는 CSS 대로 왼쪽 위
  function placeBack() {
    if (getComputedStyle(marks).display === 'none') { backBtn.style.top = ''; return; }
    backBtn.style.top = Math.max(8, marks.getBoundingClientRect().top - 46) + 'px';
  }
  function activateDetailPage(i) {
    current = i;
    prepareNearby(i);
    pages.forEach((page, k) => {
      page.toggleAttribute('inert', k !== i);
      page.classList.toggle('on', k === i);
      if (k !== i) { page.classList.remove('settled'); resetOpening(page); }
    });
    updateSelection(i);
    detail.setAttribute('aria-labelledby', `wz-book-title-${i}`);
    setMark(i);
    backBtn.style.setProperty('--wz-fg', pages[i].style.getPropertyValue('--wz-fg'));
    marks.style.setProperty('--wz-fg', pages[i].style.getPropertyValue('--wz-fg'));
  }
  function syncDetailPage() {
    if (!inDetail || closing) return;
    if (document.querySelector('.wz-reader:not(.is-preparing)')) return;
    const viewport = detail.getBoundingClientRect();
    let best = current, height = 0;
    pages.forEach((page, i) => {
      const r = page.getBoundingClientRect();
      const visible = Math.max(0, Math.min(r.bottom, viewport.bottom) - Math.max(r.top, viewport.top));
      if (visible > height || (visible === height && i === current)) { height = visible; best = i; }
    });
    if (height > 0 && best !== current) activateDetailPage(best);
  }
  function openDetail(i, viaKeyboard) {
    if (closing && inDetail) return;
    lastInteraction = performance.now();
    detailTransition++;
    closing = false;
    detail.classList.remove('closing');
    placeBack();
    inDetail = true; current = i; savedScroll = window.scrollY;
    pendingSelection = null;
    updateSelection(i);
    rows.forEach((r, k) => r.classList.toggle('lifted', k === i));
    // 눕힌 자세로 되돌린 뒤(전환 없이) 한 프레임 뒤에 일어선다. 그냥 클래스만 바꾸면 되돌아가던 전환이 반쯤에서 뒤집혀 순간이동처럼 보인다
    pages.forEach(p => { p.classList.add('reset'); p.classList.remove('on', 'settled', 'is-near'); });
    void pagesEl.offsetWidth;
    pages.forEach(p => p.classList.remove('reset'));
    document.body.classList.add('wz-mode-detail');
    detail.classList.add('on'); detail.setAttribute('aria-hidden', 'false');
    detail.removeAttribute('inert');
    detail.prepend(backBtn, marks);
    activateDetailPage(i);
    releaseDetailFocus = window.createFocusTrap?.(detail);
    shelfStage?.setAttribute('inert', '');
    detail.scrollTop = pages[i].offsetTop;
    measureDetailMotion();
    requestAnimationFrame(() => requestAnimationFrame(() => { pages[i].classList.add('on'); measureDesc(pages[i]); }));
    backBtn.focus({ preventScroll: true });
  }
  function closeDetail(viaKeyboard) {
    if (!inDetail || closing) return;
    lastInteraction = performance.now();
    closing = true;
    resetOpening(pages[current]);
    const transition = ++detailTransition;
    const returnIndex = current;
    const returnRow = rows[returnIndex];
    // 1) 세운 책이 먼저 눕는다 → 2) 소개 화면이 걷히고 목록이 돌아온다 → 3) 목록의 그 책이 들린 자세에서 내려앉는다
    // 끊기지 않게 겹친다: 책이 눕기 시작하면 소개 화면이 서서히 투명해지고(.closing), 반쯤 누웠을 때 목록이 뒤에서 떠오른다
    pages[current].classList.remove('on');
    rows.forEach((r, k) => r.classList.toggle('lifted', k === current));
    detail.classList.add('closing');
    setTimeout(() => {
      if (transition !== detailTransition) return;
      inDetail = false;
      window.scrollTo(0, savedScroll);
      returnRow.scrollIntoView({ behavior: 'auto', block: 'center' });
      document.body.classList.remove('wz-mode-detail');
      detail.setAttribute('inert', '');
      detail.setAttribute('aria-hidden', 'true');
      shelfStage?.removeAttribute('inert');
      document.body.appendChild(marks);
      marks.style.removeProperty('--wz-fg');
      releaseDetailFocus?.(); releaseDetailFocus = null;
      hits[returnIndex].focus({ preventScroll: true });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (transition !== detailTransition) return;
        returnRow.classList.add('settling'); returnRow.classList.remove('lifted');
        setTimeout(() => returnRow.classList.remove('settling'), 1100);
      }));
    }, 380);
    setTimeout(() => {
      if (transition !== detailTransition) return;
      detail.classList.remove('on', 'closing'); detail.setAttribute('aria-hidden', 'true');
      detail.setAttribute('inert', '');
      closing = false;
      pages.forEach(p => p.classList.remove('is-near'));
    }, 1050);
  }

  const REDUCED = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  function resetOpening(page) {
    const request = readRequests.get(page);
    if (request) {
      readRequests.delete(page); clearTimeout(request.hintTimer); request.controller.abort();
    }
    page.classList.remove('opening', 'preparing'); page.querySelector('.wz-acts').removeAttribute('aria-busy');
    page.querySelector('.wz-opening-status').hidden = true;
    page.querySelector('.wz-opening-status').classList.remove('is-floating');
    page.querySelector('.wz-opening-hint').hidden = true;
  }
  function openBookThen(page, go) {
    if (page.classList.contains('opening')) return;
    if (REDUCED) { go(); return; }
    page.style.setProperty('--mx', '0'); page.style.setProperty('--my', '0');
    const book = page.querySelector('.wz-sbook');
    if (book) {
      const r = book.getBoundingClientRect(), sc = 1.1;
      // 커진 책의 책등(왼쪽 가장자리)이 화면 가운데, 세로 가운데가 화면 가운데
      const spineX = r.left + r.width / 2 - (r.width * sc) / 2;
      page.style.setProperty('--shift-x', Math.round(window.innerWidth / 2 - spineX) + 'px');
      page.style.setProperty('--shift-y', Math.round(window.innerHeight / 2 - (r.top + r.height / 2)) + 'px');
    }
    page.classList.add('opening');
    // 표지가 열리기 시작하는 .3s 뒤, 반쯤 열려 첫 페이지가 드러나는 때(.55s)에 곧바로 이어 간다
    setTimeout(go, 550);
  }
  // 뒤로 가기로 돌아왔을 때(bfcache) 표지가 열린 채 남지 않게
  // 뷰어에서 뒤로 돌아왔을 때(bfcache): 어두운 막을 걷고, 열려 있던 표지를 다시 덮는다
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    document.querySelectorAll('.wz-pagefade').forEach(n => { n.classList.add('out'); setTimeout(() => n.remove(), 500); });
    setTimeout(() => pages.forEach(resetOpening), 150);
  });

  function setLikeBtn(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.innerHTML = `${on ? '♥' : '♡'} <span>${T('좋아요', 'Like', 'いいね')}</span>`;
  }
  async function toggleLike(it, btn) {
    const session = await db().auth.getSession();
    if (!session) {
      if (window.MagAuthUI.confirmLogin(T('좋아요는 로그인이 필요해요. Google로 로그인할까요?', 'Likes need an account. Sign in with Google?', 'いいねするにはログインが必要です。Googleでログインしますか？'))) db().auth.signInWithGoogle(location.href);
      return;
    }
    const on = favSet.has(it.id);
    const { error } = await db().favorites.toggle('webzine', it.id, on);
    if (error) { window.notify?.(T('좋아요 처리 실패: ', 'Could not save like: ', 'いいねを保存できませんでした：') + error.message, 'danger'); return; }
    if (on) favSet.delete(it.id); else favSet.add(it.id);
    setLikeBtn(btn, !on);
  }
  async function share(it) {
    const path = i18n.url('/books.html') + `?issue=${encodeURIComponent(it.slug)}`;
    const url = window.prettyShareUrl ? window.prettyShareUrl(path) : `https://5ftmag.com${path}`;
    const data = { title: `5ft.mag — ${it.title}`, text: it.title, url };
    if (navigator.share) { try { await navigator.share(data); } catch (_) {} return; }
    try { await navigator.clipboard.writeText(url); window.notify?.(T('링크를 복사했어요.', 'Link copied.', 'リンクをコピーしました。'), 'success'); }
    catch (_) { window.notify?.(url, 'info'); }
  }

  function render() {
    if (!issues.length) { stack.innerHTML = `<p class="wz-empty">${T('아직 발행된 책이 없어요.', 'No books yet.', 'まだ発行された本はありません。')}</p>`; return; }
    stack.innerHTML = '';
    pagesEl.innerHTML = '';
    marks.innerHTML = '';
    issues.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'wz-row ' + (it._ebook ? 'cloth' : 'kraft');
      row.dataset.i = String(i);
      row.style.zIndex = String(100 - i);   // 위 책이 아래 책 위에 겹친다
      row.innerHTML = rowMarkup(it, i);
      stack.appendChild(row);

      const page = document.createElement('section');
      page.className = 'wz-dpage ' + (it._ebook ? 'cloth' : 'kraft');
      page.dataset.i = String(i);
      page.innerHTML = pageMarkup(it, i);
      pagesEl.appendChild(page);
      if (HOVERABLE) {
        // 마우스 위치(-1..1)를 페이지 변수로. 책이 살짝 기울고 박의 반사가 따라온다
        page.addEventListener('mousemove', (e) => {
          const r = page.getBoundingClientRect();
          page.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 2 - 1).toFixed(3));
          page.style.setProperty('--my', ((e.clientY - r.top) / r.height * 2 - 1).toFixed(3));
        });
        page.addEventListener('mouseleave', () => { page.style.setProperty('--mx', '0'); page.style.setProperty('--my', '0'); });
      }

      const m = document.createElement('button');
      m.className = 'wz-mark'; m.type = 'button'; m.setAttribute('aria-label', T(it.title + '로 이동', 'Go to ' + it.title, it.title + 'へ移動'));
      m.dataset.pub = pubOf(it); m.dataset.title = it.title + (it.issue_label ? ' ' + it.issue_label : '');
      m.addEventListener('mouseenter', () => hoverMark(i));
      m.addEventListener('click', () => {
        lastInteraction = performance.now();
        if (inDetail) { prepareNearby(i); page.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); }
        else { pendingSelection = i; updateSelection(i); row.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' }); }
      });
      marks.appendChild(m);
    });

    const label = document.createElement('span');
    label.className = 'wz-mark-label'; label.setAttribute('aria-hidden', 'true');
    marks.appendChild(label);
    if (libraryLink) {
      marks.appendChild(libraryLink);
      libraryLink.addEventListener('mouseenter', () => hoverMark(-1));
    }
    marks.addEventListener('mouseleave', () => hoverMark(-1));
    rows = Array.from(stack.querySelectorAll('.wz-row'));
    hits = rows.map(r => r.querySelector('.wz-hit'));
    pages = Array.from(pagesEl.querySelectorAll('.wz-dpage'));
    markEls = Array.from(marks.querySelectorAll('.wz-mark'));
    updateSelection(0);
    issues.forEach((it, i) => setBookColor(i, it._c, 0));
    observeShelf();
    warmRemainingCovers();
    const coverObserver = new IntersectionObserver(entries => {
      if (inDetail) return;
      entries.forEach(en => { if (en.isIntersecting) prepareBook(Number(en.target.dataset.i), 'high'); });
    }, { rootMargin: '240px 0px', threshold: 0 });
    rows.forEach(row => coverObserver.observe(row));
    const nearObserver = new IntersectionObserver(entries => {
      entries.forEach(en => {
        en.target.classList.toggle('is-near', inDetail && en.isIntersecting);
        if (inDetail && en.isIntersecting) prepareBook(Number(en.target.dataset.i));
      });
    }, { root: detail, rootMargin: '600px 0px', threshold: 0 });
    pages.forEach(page => nearObserver.observe(page));
    const readStatusObserver = new IntersectionObserver(entries => {
      entries.forEach(en => {
        const page = en.target.closest('.wz-dpage');
        if (readRequests.has(page)) page.querySelector('.wz-opening-status').classList.toggle('is-floating', en.intersectionRatio < 1);
      });
    }, { root: detail, rootMargin: '-12px 0px -12px 0px', threshold: [0, 1] });
    pages.forEach(page => readStatusObserver.observe(page.querySelector('.wz-action-area')));

    hits.forEach((h, i) => {
      h.addEventListener('click', (e) => { e.stopPropagation(); openDetail(i, e.detail === 0); });
      h.addEventListener('focus', () => { if (!inDetail) updateSelection(i); });
    });
    pages.forEach((page, i) => {
      const it = issues[i];
      const more = page.querySelector('.wz-more');
      page.querySelector('.wz-start-over').addEventListener('click', () => {
        page._readFromStart = true;
        page.querySelector('.wz-act:not([hidden])')?.click();
        page._readFromStart = false;
      });
      if (more) more.addEventListener('click', () => { page.querySelector('.wz-desc').classList.add('is-open'); more.classList.remove('show'); more.setAttribute('aria-expanded', 'true'); measureDetailMotion(); });
      page.querySelector('.wz-cancel-read').addEventListener('click', () => {
        resetOpening(page); page.querySelector('.wz-act:not([hidden])')?.focus({ preventScroll: true });
      });
      // 읽기(유료는 미리보기·구매)로 들어갈 때 책이 정면으로 돌아서 표지가 열린 뒤 넘어간다
      page.querySelectorAll('.wz-act').forEach((a) => {
        a.addEventListener('click', (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;   // 새 탭 열기는 그대로
          e.preventDefault();
          if (page.classList.contains('opening') || readRequests.has(page)) return;
          lastInteraction = performance.now();
          const transition = detailTransition;
          const active = () => inDetail && !closing && detailTransition === transition && page.classList.contains('on');
          if (!active()) return;
          const closed = () => {
            resetOpening(page);
            if (active()) page.querySelector('.wz-act:not([hidden])')?.focus({ preventScroll: true });
          };
          // 다른 페이지(ebook-read)로 넘어갈 때: 어두운 막을 덮고, 돌아올 때 이 책의 소개 화면으로 오게 주소에 책을 적어 둔다
          const leaveTo = (href) => {
            if (!active()) { closed(); return; }
            const fade = document.createElement('div'); fade.className = 'wz-pagefade'; document.body.appendChild(fade);
            try { history.replaceState(null, '', 'books.html?issue=' + encodeURIComponent(it.slug)); } catch (_) {}
            setTimeout(() => { if (active()) location.href = href; else fade.remove(); }, 430);
          };
          const needsAccess = it._ebook && !a.classList.contains('wz-buy') && db().ebooks?.getAccess;
          const fromStart = page._readFromStart === true;
          if (window.WebzineReader && (a.classList.contains('wz-read') || needsAccess)) {
            const actions = page.querySelector('.wz-action-area').getBoundingClientRect();
            const viewport = detail.getBoundingClientRect();
            const request = { controller: new AbortController(), hintTimer: null };
            readRequests.set(page, request);
            page.classList.add('preparing'); page.querySelector('.wz-acts').setAttribute('aria-busy', 'true');
            page.querySelector('.wz-opening-status').hidden = false;
            page.querySelector('.wz-opening-status').classList.toggle('is-floating', actions.top < viewport.top + 12 || actions.bottom > viewport.bottom - 12);
            page.querySelector('.wz-cancel-read').focus({ preventScroll: true });
            request.hintTimer = setTimeout(() => {
              if (readRequests.get(page) === request) page.querySelector('.wz-opening-hint').hidden = false;
            }, 8000);
            const pending = () => active() && readRequests.get(page) === request && !request.controller.signal.aborted;
            prepareBook(i, 'high');
            window.WebzineReader.prepare?.();
            (async () => {
              const accessStarted = performance.now();
              const acc = needsAccess ? await db().ebooks.getAccess(it.slug) : { url: a.href, entitled: true };
              const accessMs = performance.now() - accessStarted;
              if (!pending()) return;
              if (!acc?.url) { closed(); leaveTo(a.href); return; }
              const buyHref = i18n.url('/ebook-read.html') + '?slug=' + encodeURIComponent(it.slug) + '&buy=1';
              const label = T('전자책 열람권', 'Ebook reading access', '電子書籍の閲覧権') + (isPaid(it) ? ' · ' + won(it.price) : '');
              await window.WebzineReader.open(acc.url, it.title, {
                deferReveal: true, signal: request.controller.signal,
                bookKey: progressKey(it, acc.entitled), startPage: fromStart ? 0 : undefined, accessMs,
                onReady: async () => {
                  if (!pending()) return;
                  clearTimeout(request.hintTimer);
                  await new Promise(resolve => openBookThen(page, resolve));
                },
                onClose: closed,
                onError: () => window.notify?.(T('책을 열지 못했습니다. 다시 시도해 주세요.', 'Could not open the book. Please try again.', '本を開けませんでした。もう一度お試しください。'), 'danger'),
                cta: acc.entitled ? null : { label, note: T('미리보기는 여기까지예요', 'End of the preview', 'プレビューはここまでです'), onClick: () => leaveTo(buyHref) },
              });
            })().catch(() => {
              if (!pending()) return;
              closed(); window.notify?.(T('책을 열지 못했습니다. 다시 시도해 주세요.', 'Could not open the book. Please try again.', '本を開けませんでした。もう一度お試しください。'), 'danger');
            });
          } else {
            openBookThen(page, () => { if (active()) leaveTo(a.href); else closed(); });
          }
        });
      });
      // 세운 책을 눌러도 첫 줄(읽기, 유료는 미리보기)과 같다
      const first = page.querySelector('.wz-act');
      const stage3d = page.querySelector('.wz-stage3d');
      if (first && stage3d) {
        stage3d.classList.add('is-link');
        stage3d.setAttribute('role', 'link'); stage3d.tabIndex = 0;
        stage3d.setAttribute('aria-label', `${it.title} ${it._ebook ? T('미리보기', 'Preview', 'プレビュー') : T('읽기', 'Read', '読む')}`);
        stage3d.addEventListener('click', () => page.querySelector('.wz-act:not([hidden])')?.click());
        stage3d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); page.querySelector('.wz-act:not([hidden])')?.click(); } });
      }
      const likeBtn = page.querySelector('.wz-like');
      if (likeBtn) likeBtn.addEventListener('click', () => toggleLike(it, likeBtn));
      const shareBtn = page.querySelector('.wz-share');
      if (shareBtn) shareBtn.addEventListener('click', () => share(it));
    });

    // Only the most visible page is active, including at shared viewport boundaries.
    const pio = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          setTimeout(() => { if (en.target.classList.contains('on')) en.target.classList.add('settled'); }, 1400);
          measureDesc(en.target);
        }
      });
      syncDetailPage();
    }, { root: detail, threshold: [0, .25, .5, .75, 1] });
    pages.forEach(p => pio.observe(p));

  }

  backBtn.addEventListener('click', (e) => closeDetail(e.detail === 0));
  window.addEventListener('webzine-progress', updateReadingProgress);
  let detailScrollFrame = null;
  detail.addEventListener('scroll', () => {
    lastInteraction = performance.now();
    if (detailScrollFrame !== null) return;
    detailScrollFrame = requestAnimationFrame(() => { detailScrollFrame = null; syncDetailPage(); });
  }, { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.wz-reader:not(.is-preparing)')) closeDetail(true); });
  let resizeT = null;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => {
    pages.forEach(measureDesc); measureDetailMotion(); placeBack(); observeShelf();
    if (inDetail && document.querySelector('.wz-reader:not(.is-preparing)')) detail.scrollTop = pages[current].offsetTop;
  }, 120); });
  window.addEventListener('wheel', () => { pendingSelection = null; lastInteraction = performance.now(); }, { passive: true });
  window.addEventListener('touchstart', () => { pendingSelection = null; lastInteraction = performance.now(); }, { passive: true });

  // 버튼은 유지해 클릭 처리기를 보존하고, 보유 상태에 따라 표시와 목적지만 바꾼다.
  async function markOwned(knownIds) {
    const request = ++ownershipRequest;
    let owned;
    try { owned = knownIds || await db().ebooks.myEntitlementIds(); } catch (_) { return; }
    if (request !== ownershipRequest || !owned) return;
    issues.forEach((it, i) => {
      if (!isPaid(it) || !pages[i]) return;
      const page = pages[i];
      const owns = owned.has(it._pid);
      it._owns = owns;
      const action = page.querySelector('.wz-buy, .wz-own');
      action.classList.toggle('wz-buy', !owns);
      action.classList.toggle('wz-own', owns);
      action.href = i18n.url('/ebook-read.html') + '?slug=' + encodeURIComponent(it.slug) + (owns ? '' : '&buy=1');
      action.innerHTML = `<span>${owns ? T('전체 읽기', 'Read the whole book', '全編を読む') : T('구매하기', 'Purchase', '購入する')}</span><i>${owns ? '→' : '↗'}</i>`;
      page.querySelector('.wz-preview').hidden = owns;
      page.querySelector('.wz-owned').hidden = !owns;
      page.querySelector('.wz-stage3d').setAttribute('aria-label', `${it.title} ${owns ? T('전체 읽기', 'Read the whole book', '全編を読む') : T('미리보기', 'Preview', 'プレビュー')}`);
      page.querySelector('.wz-access-note').textContent = owns
        ? T('전자책 열람권 보유 · 전체를 읽을 수 있습니다.', 'Ebook reading access owned · Full edition available.', '電子書籍の閲覧権あり · 全ページを読めます。')
        : T('미리보기는 일부 페이지만 제공됩니다. 전자책 열람권을 구매하면 전체를 읽을 수 있으며, 실물 도서는 포함되지 않습니다.', 'The preview includes selected pages. Ebook reading access unlocks the full edition; a printed book is not included.', 'プレビューは一部のページのみです。電子書籍の閲覧権で全ページを読めます。紙の本は含まれません。');
    });
    updateReadingProgress();
    if (inDetail) measureDetailMotion();
  }

  // 둘 다(웹진·이북) 불러오지 못해 보여 줄 책이 없으면 "발행된 책이 없어요" 대신 실패 안내 + 다시 시도
  function renderLoadError() {
    const title = T('책장을 불러오지 못했어요.', 'Couldn\'t load the bookshelf.', '本棚を読み込めませんでした。');
    stack.innerHTML = window.MagState
      ? window.MagState.error({ title, action: 'retry-books' })
      : `<p class="wz-empty">${esc(title)}<br /><button type="button" class="mag-state-btn" data-state-action="retry-books">${T('다시 시도', 'Try again', '再試行')}</button></p>`;
    stack.querySelector('[data-state-action="retry-books"]')?.addEventListener('click', () => {
      stack.innerHTML = `<p class="wz-empty">${T('불러오는 중…', 'Loading…', '読み込み中…')}</p>`;
      load();
    }, { once: true });
  }

  async function load() {
    for (let i = 0; i < 50; i++) { if (db() && db().isReady()) break; await new Promise(r => setTimeout(r, 50)); }
    let failed = false;
    const results = await Promise.allSettled([
      Promise.resolve().then(() => db().webzine.listPublished({ strict: true })),
      Promise.resolve().then(() => db().ebooks.listPublished({ strict: true })),
    ]);
    const [webzines, ebooks] = results.map(result => {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) return result.value;
      failed = true; return [];
    });
    const webzineIssues = webzines;
    const ebookItems = ebooks.map((e) => ({
      id: 'ebook-' + e.id, _ebook: true, _pid: e.id, slug: e.slug, title: e.title, kind: e.kind,
      cover_url: e.cover_image || '',
      spine_color: e.spine_color || '', foil_color: e.foil_color || '',
      description: e.description || e.excerpt || '',
      issue_label: '', price: e.price, created_at: e.created_at, author: e.author, binding: e.binding,
    }));
    if (failed && !webzineIssues.length && !ebookItems.length) { renderLoadError(); return; }

    // 유무료·시즌 구분 없이 올린 순서. 최신이 위
    issues = ebookItems.concat(webzineIssues);
    issues.sort((a, b) => (new Date(b.created_at || 0) - new Date(a.created_at || 0)) || ((b.sort_order || 0) - (a.sort_order || 0)));
    issues.forEach((it, i) => { it._c = FALLBACK[i % FALLBACK.length]; });
    render();
    updateReadingProgress();

    markOwned();
    if (!ownershipSubscribed && db().auth?.onChange) {
      ownershipSubscribed = true;
      db().auth.onChange(event => {
        if (event === 'SIGNED_OUT') markOwned(new Set());
        else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') markOwned();
      });
    }

    Promise.resolve().then(() => db().favorites.idsForType('webzine')).then(ids => {
      favSet = ids;
      pages.forEach((p, i) => { const b = p.querySelector('.wz-like'); if (b) setLikeBtn(b, favSet.has(issues[i].id)); });
    }).catch(() => {});

    const slug = new URLSearchParams(location.search).get('issue');
    if (slug) { const i = issues.findIndex(x => x.slug === slug); if (i >= 0) openDetail(i); }
  }
  load();
})();
