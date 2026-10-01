'use strict';

// 5ft.mag 웹진 — 세로 책장. 유료 이북(ebook_products)과 무료 웹진(webzine_issues)을 한 줄로 합쳐
// 올린 순서(최신이 위)로 눕혀 쌓는다. 유료는 양장(천 짜임 + 금박), 무료는 종이(크라프트 + 톤온톤 박).
// 책을 누르면 목록이 물러나고 책이 일어서는 소개 화면(.wz-detail)으로 간다. 소개 화면은 책마다 한 장이라
// 아래로 넘기면 다음 책, ← 나 Esc 로 목록에 돌아온다. 이전 코버플로우 책장은 webzine-page.js (books-classic.html).
(function () {
  const i18n = window.i18n || { isEn: false, t: (ko) => ko, url: (u) => u };
  const T = i18n.t;
  const won = (n) => i18n.isEn ? n.toLocaleString('en-US') + ' won' : n.toLocaleString('ko-KR') + '원';
  const stack = document.getElementById('wzStack');
  if (!stack) return;
  const marks = document.getElementById('wzMarks');
  const detail = document.getElementById('wzDetail');
  const pagesEl = document.getElementById('wzPages');
  const backBtn = document.getElementById('wzBack');
  const root = document.documentElement;
  const HOVERABLE = window.matchMedia?.('(hover: hover)')?.matches !== false;

  function db() { return window.MagDB; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
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
  function pickColor(url) {
    return new Promise((resolve) => {
      if (!url) { resolve(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const aspect = (img.naturalWidth && img.naturalHeight) ? img.naturalWidth / img.naturalHeight : 0;
        try {
          const S = 48, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
          const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, S, S);
          const d = ctx.getImageData(0, 0, S, S).data;
          const color = pickBase(d, S);
          resolve({ color, accent: color ? pickAccent(d, S, color) : null, aspect });
        } catch (_) { resolve({ color: null, accent: null, aspect }); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
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

  function pubOf(it) {
    if (it._ebook) return it.kind === 'backissue' ? '5ft.mag' : T('S.P.C 사진첩', 'S.P.C Photobook');
    return (it.category && it.category.trim()) || '5ft.mag';
  }

  function rowMarkup(it, i) {
    const cu = coverUrl(it);
    const cover = cu
      ? `<img src="${esc(cu)}" alt="" loading="lazy" />`
      : `<span class="wz-plain"><b class="wz-foil">${esc(it.title)}</b><span class="wz-foil">${esc(pubOf(it))}${it.issue_label ? ' · ' + esc(it.issue_label) : ''}</span></span>`;
    return `<div class="wz-book">
      <button class="wz-hit" type="button" aria-label="${esc(pubOf(it))} ${esc(it.title)}, ${it._ebook ? T('유료', 'paid') : T('무료', 'free')}${T(' 소개 보기', ', view details')}"></button>
      <span class="wz-b wz-back-cover wz-mat"></span>
      <span class="wz-b wz-side-l"></span><span class="wz-b wz-side-r"></span><span class="wz-b wz-fore"></span>
      <span class="wz-b wz-cover wz-mat${cu ? ' has-img' : ''}">${cover}</span>
      <span class="wz-b wz-spine wz-mat"><span class="wz-pub wz-foil">${esc(pubOf(it))}</span><span class="wz-title wz-foil">${esc(it.title)}${it.issue_label ? `<span class="wz-issue wz-foil">${esc(it.issue_label)}</span>` : ''}</span><span class="wz-mark5" aria-hidden="true"></span></span>
    </div>`;
  }
  function actsMarkup(it) {
    if (it._ebook) {
      const href = `ebook-read.html?slug=${encodeURIComponent(it.slug)}`;
      return `<a class="wz-act" href="${href}"><span>${T('미리보기', 'Preview')}</span><i>↗</i></a>` +
        (it.price ? `<a class="wz-act wz-buy" href="${href}&amp;buy=1"><span>${T('구매하고 전체 보기', 'Buy the full edition')}<b>${won(it.price)}</b></span><i>↗</i></a>` : '');
    }
    const read = it.pdf_path ? esc(db().webzine.publicUrl(it.pdf_path)) : '';
    return read ? `<a class="wz-act wz-read" href="${read}" target="_blank" rel="noopener"><span>${T('읽기', 'Read')}</span><i>→</i></a>` : '';
  }
  function pageMarkup(it, i) {
    const cu = coverUrl(it);
    const front = cu
      ? `<img src="${esc(cu)}" alt="${esc(it.title)}${T(' 표지', ' cover')}" loading="lazy" />`
      : `<span class="wz-plain2"><b class="wz-foil">${esc(it.title)}</b><span class="wz-foil">${esc(pubOf(it))}${it.issue_label ? ' · ' + esc(it.issue_label) : ''}</span></span>`;
    const side = it._ebook ? '' : `<div class="wz-side-acts">
        <button type="button" class="wz-side-act wz-like" aria-pressed="false">♡ <span>${T('좋아요', 'Like')}</span></button>
        <button type="button" class="wz-side-act wz-share">↗ <span>${T('공유', 'Share')}</span></button>
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
        <span class="wz-kind">${it._ebook ? T('유료 · 양장', 'Paid · Hardcover') : T('무료 · 종이', 'Free · Paper')}</span>
        <h2>${esc(it.title)}</h2>
        <p class="wz-by">${esc(pubOf(it))}${it.issue_label ? ' · ' + esc(it.issue_label) : ''}</p>
        <div class="wz-rule"></div>
        ${it.description ? `<p class="wz-desc">${esc(it.description)}</p><button type="button" class="wz-more" aria-expanded="false">${T('더 보기', 'More')}</button>` : ''}
        <div class="wz-acts">${actsMarkup(it)}</div>
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

  // ← 는 눈금 바로 위에. 눈금이 길어지면 그만큼 따라 올라간다. 폰(눈금 없음)에서는 CSS 대로 왼쪽 위
  function placeBack() {
    if (getComputedStyle(marks).display === 'none') { backBtn.style.top = ''; return; }
    backBtn.style.top = Math.max(8, marks.getBoundingClientRect().top - 46) + 'px';
  }
  function openDetail(i, viaKeyboard) {
    if (closing) return;
    placeBack();
    inDetail = true; current = i; savedScroll = window.scrollY;
    rows.forEach((r, k) => r.classList.toggle('lifted', k === i));
    // 눕힌 자세로 되돌린 뒤(전환 없이) 한 프레임 뒤에 일어선다. 그냥 클래스만 바꾸면 되돌아가던 전환이 반쯤에서 뒤집혀 순간이동처럼 보인다
    pages.forEach(p => { p.classList.add('reset'); p.classList.remove('on', 'settled'); });
    void pagesEl.offsetWidth;
    pages.forEach(p => p.classList.remove('reset'));
    document.body.classList.add('wz-mode-detail');
    detail.classList.add('on'); detail.setAttribute('aria-hidden', 'false');
    detail.scrollTop = pages[i].offsetTop;
    backBtn.style.setProperty('--wz-fg', pages[i].style.getPropertyValue('--wz-fg'));
    marks.style.setProperty('--wz-fg', pages[i].style.getPropertyValue('--wz-fg'));
    requestAnimationFrame(() => requestAnimationFrame(() => { pages[i].classList.add('on'); measureDesc(pages[i]); }));
    setMark(i);
    if (viaKeyboard) backBtn.focus({ preventScroll: true });   // 마우스로 열었을 땐 초점 테두리를 띄우지 않는다
  }
  function closeDetail(viaKeyboard) {
    if (!inDetail || closing) return;
    closing = true;
    // 1) 세운 책이 먼저 눕는다 → 2) 소개 화면이 걷히고 목록이 돌아온다 → 3) 목록의 그 책이 들린 자세에서 내려앉는다
    // 끊기지 않게 겹친다: 책이 눕기 시작하면 소개 화면이 서서히 투명해지고(.closing), 반쯤 누웠을 때 목록이 뒤에서 떠오른다
    pages[current].classList.remove('on');
    rows.forEach((r, k) => r.classList.toggle('lifted', k === current));
    detail.classList.add('closing');
    setTimeout(() => {
      inDetail = false;
      window.scrollTo(0, savedScroll);
      rows[current].scrollIntoView({ behavior: 'auto', block: 'center' });
      document.body.classList.remove('wz-mode-detail');
      marks.style.removeProperty('--wz-fg');
      if (viaKeyboard) hits[current].focus({ preventScroll: true });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        rows[current].classList.add('settling'); rows[current].classList.remove('lifted');
        setTimeout(() => rows[current].classList.remove('settling'), 1100);
      }));
    }, 380);
    setTimeout(() => {
      detail.classList.remove('on', 'closing'); detail.setAttribute('aria-hidden', 'true');
      closing = false;
    }, 1050);
  }

  const REDUCED = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
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
  window.addEventListener('pageshow', () => {
    document.querySelectorAll('.wz-pagefade').forEach(n => { n.classList.add('out'); setTimeout(() => n.remove(), 500); });
    setTimeout(() => pages.forEach(p => p.classList.remove('opening')), 150);
  });

  function setLikeBtn(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.innerHTML = `${on ? '♥' : '♡'} <span>${T('좋아요', 'Like')}</span>`;
  }
  async function toggleLike(it, btn) {
    const session = await db().auth.getSession();
    if (!session) { db().auth.signInWithGoogle(location.href); return; }
    const on = favSet.has(it.id);
    const { error } = await db().favorites.toggle('webzine', it.id, on);
    if (error) { window.notify?.(T('좋아요 처리 실패: ', 'Could not save like: ') + error.message, 'danger'); return; }
    if (on) favSet.delete(it.id); else favSet.add(it.id);
    setLikeBtn(btn, !on);
  }
  async function share(it) {
    const path = i18n.url('/books.html') + `?issue=${encodeURIComponent(it.slug)}`;
    const url = window.prettyShareUrl ? window.prettyShareUrl(path) : `https://5ftmag.com${path}`;
    const data = { title: `5ft.mag — ${it.title}`, text: it.title, url };
    if (navigator.share) { try { await navigator.share(data); } catch (_) {} return; }
    try { await navigator.clipboard.writeText(url); window.notify?.(T('링크를 복사했어요.', 'Link copied.'), 'success'); }
    catch (_) { window.notify?.(url, 'info'); }
  }

  function render() {
    if (!issues.length) { stack.innerHTML = `<p class="wz-empty">${T('아직 발행된 책이 없어요.', 'No books yet.')}</p>`; return; }
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
      m.className = 'wz-mark'; m.type = 'button'; m.setAttribute('aria-label', T(it.title + '로 이동', 'Go to ' + it.title));
      m.dataset.pub = pubOf(it); m.dataset.title = it.title + (it.issue_label ? ' ' + it.issue_label : '');
      m.addEventListener('mouseenter', () => hoverMark(i));
      m.addEventListener('click', () => {
        if (inDetail) page.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      marks.appendChild(m);
    });

    const label = document.createElement('span');
    label.className = 'wz-mark-label'; label.setAttribute('aria-hidden', 'true');
    marks.appendChild(label);
    marks.addEventListener('mouseleave', () => hoverMark(-1));
    rows = Array.from(stack.querySelectorAll('.wz-row'));
    hits = rows.map(r => r.querySelector('.wz-hit'));
    pages = Array.from(pagesEl.querySelectorAll('.wz-dpage'));
    markEls = Array.from(marks.querySelectorAll('.wz-mark'));
    issues.forEach((it, i) => setBookColor(i, it._c, 0));

    hits.forEach((h, i) => h.addEventListener('click', (e) => { e.stopPropagation(); openDetail(i, e.detail === 0); }));
    pages.forEach((page, i) => {
      const it = issues[i];
      const more = page.querySelector('.wz-more');
      if (more) more.addEventListener('click', () => { page.querySelector('.wz-desc').classList.add('is-open'); more.classList.remove('show'); more.setAttribute('aria-expanded', 'true'); });
      // 읽기(유료는 미리보기·구매)로 들어갈 때 책이 정면으로 돌아서 표지가 열린 뒤 넘어간다
      page.querySelectorAll('.wz-act').forEach((a) => {
        a.addEventListener('click', (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;   // 새 탭 열기는 그대로
          e.preventDefault();
          const closed = () => page.classList.remove('opening');
          // 다른 페이지(ebook-read)로 넘어갈 때: 어두운 막을 덮고, 돌아올 때 이 책의 소개 화면으로 오게 주소에 책을 적어 둔다
          const leaveTo = (href) => {
            const fade = document.createElement('div'); fade.className = 'wz-pagefade'; document.body.appendChild(fade);
            try { history.replaceState(null, '', 'books.html?issue=' + encodeURIComponent(it.slug)); } catch (_) {}
            setTimeout(() => { location.href = href; }, 430);
          };
          let go;
          if (a.classList.contains('wz-read') && window.WebzineReader) {
            go = () => window.WebzineReader.open(a.href, it.title, { onClose: closed });
          } else if (it._ebook && !a.classList.contains('wz-buy') && window.WebzineReader && db().ebooks?.getAccess) {
            // 유료 미리보기도 무료와 같이 이 페이지에서 연다. 열람 주소는 표지가 열리는 동안 미리 받아 둔다.
            // 받지 못하면(서버·파일 문제) 원인을 보여 주는 ebook-read 로 넘긴다
            const accessP = db().ebooks.getAccess(it.slug).catch(() => null);
            go = async () => {
              const acc = await accessP;
              if (!acc || !acc.url) { leaveTo(a.href); return; }
              const buyHref = 'ebook-read.html?slug=' + encodeURIComponent(it.slug) + '&buy=1';
              const label = it.price ? won(it.price) + T(' · 구매하고 전체 보기', ' · Buy the full edition') : T('구매하고 전체 보기', 'Buy the full edition');
              window.WebzineReader.open(acc.url, it.title, {
                onClose: closed,
                cta: acc.entitled ? null : { label, note: T('미리보기는 여기까지예요', 'End of the preview'), onClick: () => leaveTo(buyHref) },
              });
            };
          } else {
            go = () => leaveTo(a.href);
          }
          openBookThen(page, go);
        });
      });
      // 세운 책을 눌러도 첫 줄(읽기, 유료는 미리보기)과 같다
      const first = page.querySelector('.wz-act');
      const stage3d = page.querySelector('.wz-stage3d');
      if (first && stage3d) {
        stage3d.classList.add('is-link');
        stage3d.setAttribute('role', 'link'); stage3d.tabIndex = 0;
        stage3d.setAttribute('aria-label', `${it.title} ${it._ebook ? T('미리보기', 'Preview') : T('읽기', 'Read')}`);
        stage3d.addEventListener('click', () => first.click());
        stage3d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); first.click(); } });
      }
      const likeBtn = page.querySelector('.wz-like');
      if (likeBtn) likeBtn.addEventListener('click', () => toggleLike(it, likeBtn));
      const shareBtn = page.querySelector('.wz-share');
      if (shareBtn) shareBtn.addEventListener('click', () => share(it));
    });

    // 소개 화면: 화면에 들어온 책이 일어선다. 나가면 다시 눕는다
    const pio = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const i = Number(en.target.dataset.i);
        en.target.classList.toggle('on', en.isIntersecting);
        en.target.classList.remove('settled');
        if (en.isIntersecting) {
          setTimeout(() => { if (en.target.classList.contains('on')) en.target.classList.add('settled'); }, 1400);
          measureDesc(en.target);
        }
        if (en.isIntersecting && inDetail) { current = i; setMark(i); backBtn.style.setProperty('--wz-fg', en.target.style.getPropertyValue('--wz-fg')); marks.style.setProperty('--wz-fg', en.target.style.getPropertyValue('--wz-fg')); }
      });
    }, { root: detail, threshold: .5 });
    pages.forEach(p => pio.observe(p));

    // 목록: 화면 가운데 온 책 → 눈금 + 배경 색
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const i = Number(en.target.dataset.i);
        if (en.isIntersecting && !inDetail) { setMark(i); root.style.setProperty('--wz-mood', issues[i]._c); }
      });
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    rows.forEach(r => io.observe(r));
  }

  backBtn.addEventListener('click', (e) => closeDetail(e.detail === 0));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.wz-reader')) closeDetail(true); });
  let resizeT = null;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { pages.forEach(measureDesc); placeBack(); }, 120); });

  (async function load() {
    for (let i = 0; i < 50; i++) { if (db() && db().isReady()) break; await new Promise(r => setTimeout(r, 50)); }
    let webzineIssues = [];
    try { webzineIssues = await db().webzine.listPublished(); } catch (_) { webzineIssues = []; }
    if (!Array.isArray(webzineIssues)) webzineIssues = [];

    let ebookItems = [];
    try {
      const eb = (db().ebooks && await db().ebooks.listPublished()) || [];
      ebookItems = eb.map((e) => ({
        id: 'ebook-' + e.id, _ebook: true, slug: e.slug, title: e.title, kind: e.kind,
        cover_url: e.cover_image || '',
        spine_color: e.spine_color || '', foil_color: e.foil_color || '',
        description: e.description || e.excerpt || '',
        issue_label: '', price: e.price, created_at: e.created_at,
      }));
    } catch (_) { ebookItems = []; }

    // 유무료·시즌 구분 없이 올린 순서. 최신이 위
    issues = ebookItems.concat(webzineIssues);
    issues.sort((a, b) => (new Date(b.created_at || 0) - new Date(a.created_at || 0)) || ((b.sort_order || 0) - (a.sort_order || 0)));
    issues.forEach((it, i) => { it._c = FALLBACK[i % FALLBACK.length]; });
    render();

    try { favSet = await db().favorites.idsForType('webzine'); } catch (_) { favSet = new Set(); }
    pages.forEach((p, i) => { const b = p.querySelector('.wz-like'); if (b) setLikeBtn(b, favSet.has(issues[i].id)); });

    const slug = new URLSearchParams(location.search).get('issue');
    if (slug) { const i = issues.findIndex(x => x.slug === slug); if (i >= 0) openDetail(i); }

    issues.forEach((it, i) => {
      const cu = coverUrl(it);
      if (!cu) return;
      pickColor(cu).then(c => {
        if (!c) return;
        // 표지 비율(가로/세로)로 책 가로를 잡는다. 세로 사진첩은 좁고 길게, A판은 그대로
        setBookColor(i, c.color, (c.aspect && isFinite(c.aspect) && c.aspect < 1.2) ? c.aspect : 0, c.accent);
        if (!inDetail && markEls[i] && markEls[i].classList.contains('on')) root.style.setProperty('--wz-mood', issues[i]._c);
      });
    });
  })();
})();
