// 이스터에그: 「오늘은 무슨 필름으로 찍지?」 필름 슬롯머신.
//
// 푸터의 「© 2026 5ft magazine」을 2초 안에 5번 누르면 site-common.js 가 이 파일을 그때 불러와
// FilmSlot.open() 을 부른다. 평소 페이지에는 실리지 않는다.
//
// 후보: 전체 필름 / ♡ 누른 필름(로그인) / 내 필름(이 브라우저에 직접 체크해 둔 목록).
// 거름: 종류(컬러·흑백·슬라이드·영화용), ISO. 결과에서 카탈로그의 그 필름(사진·소개)으로 간다.
// 마크업과 스타일은 처음 열 때 이 파일이 만들어 붙인다(film-name-picker.js 와 같은 방식).
(function () {
  'use strict';
  if (window.FilmSlot) return;

  const i18n = window.i18n || { t: (ko) => ko, url: (u) => u, lang: 'ko' };
  const tr = i18n.t;
  const MY_KEY = '5ft_my_films';
  const ITEM_H = 132;          // 릴 한 칸 높이(px)
  const SPIN_ITEMS = 36;       // 한 번 돌릴 때 지나가는 칸 수

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = { films: [], favs: null, source: 'all', kind: 'all', iso: 'all', spinning: false, picking: false };

  // ── 데이터 ──
  function kindOf(f) {
    const t = String(f.type || '');
    if (/slide|e-6|reversal|positive|슬라이드/i.test(t)) return 'slide';
    if (/black|b&w|\bbw\b|흑백|mono/i.test(t)) return 'bw';
    if (/tungsten|daylight|cinema|영화|ecn/i.test(t)) return 'cinema';
    return 'color';
  }
  const isoOf = (f) => parseInt(String(f.iso || '').replace(/[^0-9].*$/, ''), 10) || 0;
  const thumbOf = (f) => (f.canThumbnailStatus === 'set' && f.canThumbnail)
    ? '/' + String(f.canThumbnail).replace(/^\.?\//, '').replace(/\.(png|jpe?g)$/i, '.webp') : '';
  const descOf = (f) => (i18n.lang === 'ja' ? f.descJa : i18n.lang === 'en' ? f.descEn : f.desc) || '';

  async function loadFilms() {
    if (state.films.length) return;
    let obj = null;
    try {
      if (window.MagDB?.films?.listAsObject) obj = await Promise.race([
        window.MagDB.films.listAsObject(),
        new Promise((r) => setTimeout(() => r(null), 4000)),
      ]);
    } catch (_) { obj = null; }
    if (!obj || !Object.keys(obj).length) {
      try { obj = await fetch('/data/films.json').then((r) => r.json()); } catch (_) { obj = {}; }
    }
    state.films = Object.entries(obj || {}).map(([slug, f]) => ({ ...f, slug: f.slug || slug }));
  }

  async function loadFavs() {
    if (state.favs) return state.favs;
    try {
      const rows = await window.MagDB?.favorites?.list?.('film');
      state.favs = new Set((rows || []).map((r) => r.target_id));
    } catch (_) { state.favs = new Set(); }
    return state.favs;
  }

  function readMine() {
    try { return new Set(JSON.parse(localStorage.getItem(MY_KEY) || '[]')); } catch (_) { return new Set(); }
  }
  function writeMine(set) {
    try { localStorage.setItem(MY_KEY, JSON.stringify([...set])); } catch (_) { /* 저장 못 해도 이번 창에서는 쓴다 */ }
  }

  function candidates() {
    let list = state.films;
    if (state.source === 'fav') list = list.filter((f) => state.favs && state.favs.has(f.slug));
    if (state.source === 'mine') { const mine = readMine(); list = list.filter((f) => mine.has(f.slug)); }
    if (state.kind !== 'all') list = list.filter((f) => kindOf(f) === state.kind);
    if (state.iso !== 'all') list = list.filter((f) => {
      const n = isoOf(f);
      return state.iso === 'low' ? n > 0 && n <= 200 : state.iso === 'mid' ? n > 200 && n < 800 : n >= 800;
    });
    return list;
  }

  // ── 스타일 ──
  function ensureStyle() {
    if (document.getElementById('fslot-style')) return;
    const st = document.createElement('style');
    st.id = 'fslot-style';
    st.textContent = `
.fslot { padding: 0; border: 0; background: transparent; width: calc(100% - 32px); max-width: 420px; color: var(--text, #111);
  position: fixed; inset: 0; margin: auto; height: fit-content; max-height: calc(100% - 32px); }
.fslot::backdrop { background: rgba(0,0,0,.55); }
.fslot-panel { position: relative; background: var(--bg, #fff); border-radius: 16px; padding: 22px 18px 18px; box-shadow: 0 20px 56px rgba(0,0,0,.3); max-height: calc(100vh - 32px); overflow: auto; }
.fslot-close { position: absolute; top: 6px; right: 6px; width: 44px; height: 44px; border: 0; background: none; color: var(--text-muted, #666); font-size: 24px; cursor: pointer; }
.fslot-title { margin: 0 40px 4px 0; font-size: 18px; font-weight: var(--fw-heading, 700); }
.fslot-lead { margin: 0 0 14px; font-size: 13px; color: var(--text-muted, #666); }
.fslot-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.fslot-chip { font: inherit; font-size: 12px; font-weight: var(--fw-heading, 700); padding: 7px 11px; min-height: 32px; border-radius: 999px; border: 1px solid var(--border, #ddd); background: none; color: inherit; cursor: pointer; }
.fslot-chip[aria-pressed="true"] { background: var(--text, #111); color: var(--bg, #fff); border-color: var(--text, #111); }
.fslot-count { font-size: 12px; color: var(--text-muted, #666); margin: 6px 0 12px; }
.fslot-window { position: relative; height: ${ITEM_H}px; overflow: hidden; border-radius: 12px; background: var(--bg-sub, #f4f4f4); }
.fslot-window::before, .fslot-window::after { content: ''; position: absolute; left: 0; right: 0; height: 22px; z-index: 1; pointer-events: none; }
.fslot-window::before { top: 0; background: linear-gradient(var(--bg-sub, #f4f4f4), transparent); }
.fslot-window::after { bottom: 0; background: linear-gradient(transparent, var(--bg-sub, #f4f4f4)); }
.fslot-strip { will-change: transform; }
.fslot-item { height: ${ITEM_H}px; display: flex; align-items: center; justify-content: center; gap: 12px; padding: 0 16px; box-sizing: border-box; }
.fslot-item img { width: 96px; height: 96px; object-fit: contain; flex: 0 0 auto; }
.fslot-item span { font-size: 14px; font-weight: var(--fw-heading, 700); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fslot-btn { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 46px; margin-top: 12px; border-radius: 10px; border: 1px solid var(--text, #111);
  background: var(--text, #111); color: var(--bg, #fff); font: inherit; font-size: 15px; font-weight: var(--fw-heading, 700); cursor: pointer; text-decoration: none; box-sizing: border-box; }
.fslot-btn[disabled] { opacity: .45; cursor: default; }
.fslot-btn.ghost { background: none; color: var(--text, #111); border-color: var(--border, #ddd); }
.fslot-result { margin-top: 14px; }
.fslot-result[hidden] { display: none; }
.fslot-brand { display: block; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted, #666); }
.fslot-name { margin: 2px 0 2px; font-size: 20px; font-weight: var(--fw-heading, 700); }
.fslot-spec { margin: 0; font-size: 12px; color: var(--text-muted, #666); }
.fslot-desc { margin: 10px 0 0; font-size: 14px; line-height: 1.7; }
.fslot-mine { margin-top: 8px; }
.fslot-mine[hidden] { display: none; }
.fslot-search { width: 100%; box-sizing: border-box; font: inherit; font-size: 14px; padding: 9px 11px; border: 1px solid var(--border, #ddd); border-radius: 8px; background: var(--bg, #fff); color: inherit; }
.fslot-list { max-height: 220px; overflow: auto; margin-top: 8px; border: 1px solid var(--border, #ddd); border-radius: 8px; }
.fslot-list label { display: flex; gap: 10px; align-items: center; padding: 8px 10px; font-size: 13px; cursor: pointer; }
.fslot-list label + label { border-top: 1px solid var(--border, #eee); }
.fslot-note { font-size: 12px; color: var(--text-muted, #666); margin: 6px 0 0; }
`;
    document.head.appendChild(st);
  }

  // ── 화면 ──
  let dlg = null;
  const $ = (sel) => dlg.querySelector(sel);

  function chips(group, items, current) {
    return items.map(([v, label]) => `<button type="button" class="fslot-chip" data-${group}="${v}" aria-pressed="${v === current}">${label}</button>`).join('');
  }

  function build() {
    ensureStyle();
    dlg = document.createElement('dialog');
    dlg.className = 'fslot';
    dlg.setAttribute('aria-label', tr('오늘의 필름 슬롯머신', "Today's film slot machine", '今日のフィルムスロット'));
    dlg.innerHTML = `
      <div class="fslot-panel">
        <button type="button" class="fslot-close" data-fslot-close aria-label="${esc(tr('닫기', 'Close', '閉じる'))}">×</button>
        <h2 class="fslot-title">${tr('오늘은 무슨 필름으로 찍지?', 'What film should I shoot today?', '今日はどのフィルムで撮ろう？')}</h2>
        <p class="fslot-lead">${tr('숨은 버튼을 찾으셨네요. 레버를 당겨 오늘의 한 롤을 정해 보세요.', 'You found the hidden button. Pull the lever and let it pick today’s roll.', '隠しボタンを見つけましたね。レバーを引いて今日の1本を決めましょう。')}</p>
        <div class="fslot-row" data-row="source"></div>
        <div class="fslot-mine" hidden>
          <input type="search" class="fslot-search" placeholder="${esc(tr('가진 필름 찾기 (예: 포트라, gold)', 'Find films you have (e.g. portra, gold)', '持っているフィルムを探す（例: portra, gold）'))}" />
          <div class="fslot-list"></div>
          <p class="fslot-note">${tr('체크한 필름은 이 브라우저에 기억해 둡니다.', 'Checked films are remembered in this browser.', 'チェックしたフィルムはこのブラウザに保存されます。')}</p>
        </div>
        <div class="fslot-row" data-row="kind"></div>
        <div class="fslot-row" data-row="iso"></div>
        <p class="fslot-count" aria-live="polite"></p>
        <div class="fslot-window" aria-hidden="true"><div class="fslot-strip"></div></div>
        <button type="button" class="fslot-btn" data-fslot-spin>${tr('레버 당기기', 'Pull the lever', 'レバーを引く')}</button>
        <div class="fslot-result" hidden aria-live="polite"></div>
      </div>`;
    document.body.appendChild(dlg);

    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-fslot-close]')) { dlg.close(); return; }
      const src = e.target.closest('[data-source]');
      const kind = e.target.closest('[data-kind]');
      const iso = e.target.closest('[data-iso]');
      if (src) { setSource(src.dataset.source); return; }
      if (kind) { state.kind = kind.dataset.kind; renderControls(); return; }
      if (iso) { state.iso = iso.dataset.iso; renderControls(); return; }
      if (e.target.closest('[data-fslot-spin]')) spin();
    });
    $('.fslot-search').addEventListener('input', renderMineList);
    $('.fslot-list').addEventListener('change', (e) => {
      const box = e.target.closest('input[type="checkbox"]');
      if (!box) return;
      const mine = readMine();
      if (box.checked) mine.add(box.value); else mine.delete(box.value);
      writeMine(mine);
      renderControls();
    });
  }

  async function setSource(v) {
    state.source = v;
    if (v === 'fav') await loadFavs();
    renderControls();
  }

  function renderControls() {
    $('[data-row="source"]').innerHTML = chips('source', [
      ['all', tr('전체 필름', 'All films', 'すべて')],
      ['fav', tr('♡ 누른 필름', '♡ Liked', '♡したフィルム')],
      ['mine', tr('내 필름', 'My films', 'マイフィルム')],
    ], state.source);
    $('[data-row="kind"]').innerHTML = chips('kind', [
      ['all', tr('모든 종류', 'Any type', 'すべての種類')],
      ['color', tr('컬러', 'Color', 'カラー')],
      ['bw', tr('흑백', 'B&W', 'モノクロ')],
      ['slide', tr('슬라이드', 'Slide', 'スライド')],
      ['cinema', tr('영화용', 'Cinema', '映画用')],
    ], state.kind);
    $('[data-row="iso"]').innerHTML = chips('iso', [
      ['all', tr('모든 ISO', 'Any ISO', 'すべてのISO')],
      ['low', 'ISO ~200'],
      ['mid', 'ISO 400'],
      ['high', 'ISO 800+'],
    ], state.iso);
    $('.fslot-mine').hidden = state.source !== 'mine';
    if (state.source === 'mine') renderMineList();

    const n = candidates().length;
    let note = tr(`후보 ${n}종`, `${n} candidates`, `候補 ${n}種`);
    if (n === 0) {
      note = state.source === 'fav' && !(state.favs && state.favs.size)
        ? tr('♡ 누른 필름이 없어요. 로그인한 뒤 카탈로그에서 ♡ 를 눌러 보세요.', 'No liked films yet. Sign in and tap ♡ in the catalog.', '♡したフィルムがありません。ログインしてカタログで♡を押してください。')
        : state.source === 'mine' && !readMine().size
          ? tr('위 목록에서 가진 필름을 체크해 주세요.', 'Check the films you have in the list above.', '上のリストで持っているフィルムにチェックしてください。')
          : tr('조건에 맞는 필름이 없어요. 거름을 풀어 보세요.', 'No films match. Try loosening the filters.', '条件に合うフィルムがありません。絞り込みを緩めてください。');
    }
    $('.fslot-count').textContent = note;
    $('[data-fslot-spin]').disabled = n === 0 || state.spinning;
  }

  function renderMineList() {
    const q = $('.fslot-search').value.trim().toLowerCase();
    const mine = readMine();
    const list = state.films
      .filter((f) => !q || [f.displayName, f.name, f.brand, ...(f.aliases || [])].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (mine.has(b.slug) - mine.has(a.slug)) || String(a.displayName || a.name).localeCompare(String(b.displayName || b.name)))
      .slice(0, 80);
    $('.fslot-list').innerHTML = list.map((f) => `
      <label><input type="checkbox" value="${esc(f.slug)}" ${mine.has(f.slug) ? 'checked' : ''} /> ${esc(f.displayName || f.name)}</label>`).join('');
  }

  function itemHtml(f) {
    const t = thumbOf(f);
    return `<div class="fslot-item">${t ? `<img src="${esc(t)}" alt="" />` : ''}<span>${esc(f.displayName || f.name)}</span></div>`;
  }

  function spin() {
    const pool = candidates();
    if (!pool.length || state.spinning) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const strip = $('.fslot-strip');
    const reel = [];
    for (let i = 0; i < SPIN_ITEMS; i++) reel.push(pool[Math.floor(Math.random() * pool.length)]);
    reel.push(pick);
    strip.innerHTML = reel.map(itemHtml).join('');
    $('.fslot-result').hidden = true;

    const end = -(reel.length - 1) * ITEM_H;
    if (reduceMotion() || !strip.animate) {
      strip.style.transform = `translateY(${end}px)`;
      showResult(pick);
      return;
    }
    state.spinning = true;
    renderControls();
    const anim = strip.animate(
      [{ transform: 'translateY(0)' }, { transform: `translateY(${end}px)` }],
      { duration: 2600, easing: 'cubic-bezier(.12,.75,.2,1)', fill: 'forwards' },
    );
    anim.onfinish = () => {
      state.spinning = false;
      renderControls();
      showResult(pick);
    };
  }

  function showResult(f) {
    const spec = [f.iso && `ISO ${f.iso}`, f.type, f.format].filter(Boolean).join(' · ');
    const href = `${i18n.url('/films.html')}?film=${encodeURIComponent(f.slug)}`;
    const box = $('.fslot-result');
    box.innerHTML = `
      <span class="fslot-brand">${esc(f.brand || '')}</span>
      <h3 class="fslot-name">${esc(f.name || f.displayName)}</h3>
      ${spec ? `<p class="fslot-spec">${esc(spec)}</p>` : ''}
      ${descOf(f) ? `<p class="fslot-desc">${esc(descOf(f))}</p>` : ''}
      <a class="fslot-btn" href="${esc(href)}">${tr('이 필름으로 찍은 사진과 소개 보기 →', 'See photos and details for this film →', 'このフィルムの写真と紹介を見る →')}</a>
      <button type="button" class="fslot-btn ghost" data-fslot-spin>${tr('다시 돌리기', 'Spin again', 'もう一度回す')}</button>`;
    box.hidden = false;
  }

  async function open() {
    if (!dlg) build();
    renderControls();
    if (!dlg.open) dlg.showModal();
    await loadFilms();
    if (!$('.fslot-strip').children.length) {
      const first = candidates()[0] || state.films[0];
      if (first) $('.fslot-strip').innerHTML = itemHtml(first);
    }
    renderControls();
  }

  window.FilmSlot = { open };
})();
