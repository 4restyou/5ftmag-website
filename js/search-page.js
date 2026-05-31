// 5ft.mag 전체 검색 — Articles + Films + Webzine + Labs + Market 통합.
// 정적 JSON(data/stories.json, data/films.json) + Supabase(webzine/labs/market) 병렬 조회 후
// 클라이언트에서 lowercase substring 매칭. 카테고리별 섹션으로 결과 노출.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const input   = $('searchQ');
  const form    = $('searchForm');
  const results = $('searchResults');

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function db() { return window.MagDB; }

  function syncUrl(q) {
    const url = new URL(location.href);
    if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
    history.replaceState(null, '', url.pathname + url.search);
  }

  async function fetchJsonSafe(url) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) { return null; }
  }

  // 매칭: 입력어를 공백으로 나눠 모든 토큰이 어딘가 매칭되면 hit (AND).
  function makeMatcher(q) {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    return function (fields) {
      const hay = fields.filter(Boolean).join(' ').toLowerCase();
      return tokens.every((t) => hay.includes(t));
    };
  }

  function highlight(text, q) {
    if (!q) return esc(text);
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return esc(text);
    // 단순: 첫 토큰만 강조 (지나치게 화려해지지 않게)
    const first = tokens[0];
    const idx = String(text).toLowerCase().indexOf(first);
    if (idx < 0) return esc(text);
    const before = String(text).slice(0, idx);
    const hit    = String(text).slice(idx, idx + first.length);
    const after  = String(text).slice(idx + first.length);
    return esc(before) + '<mark>' + esc(hit) + '</mark>' + esc(after);
  }

  function setHtml(html) { results.innerHTML = html; }

  function renderHint() {
    setHtml('<p class="search-hint">키워드 한 줄이면 글·필름·웹진·현상소·매물을 한꺼번에 찾아요.</p>');
  }

  function renderEmpty(q) {
    setHtml(`<p class="search-empty">"<strong>${esc(q)}</strong>" 검색 결과가 없어요.<br />다른 단어로 다시 시도해 보세요.</p>`);
  }

  function cardArticle(s, q) {
    const thumb = s.thumbnail
      ? `<div class="sc-thumb"><img src="${esc(s.thumbnail)}" alt="" loading="lazy" /></div>`
      : '';
    const meta = [s.author, s.date].filter(Boolean).map(esc).join(' · ');
    return `<a class="search-card" href="${esc(s.page || '#')}">
      ${thumb}
      <div class="sc-body">
        <div class="sc-kicker">${esc(s.categoryLabel || s.category || 'ARTICLE')}</div>
        <div class="sc-title">${highlight(s.title || '', q)}</div>
        ${meta ? `<div class="sc-meta">${meta}</div>` : ''}
      </div>
    </a>`;
  }

  function cardFilm(f, q) {
    const name = f.displayName || (f.brand ? `${f.brand} ${f.name || ''}`.trim() : f.name || '');
    return `<a class="search-card" href="films.html#film-${esc(f.slug || '')}">
      <div class="sc-body">
        <div class="sc-kicker">${esc(f.brand || 'FILM')}</div>
        <div class="sc-title">${highlight(name, q)}</div>
        ${f.desc ? `<div class="sc-meta">${esc(String(f.desc).slice(0, 80))}${String(f.desc).length > 80 ? '…' : ''}</div>` : ''}
      </div>
    </a>`;
  }

  function cardWebzine(w, q) {
    const cover = w.cover_path && db() && db().webzine
      ? `<div class="sc-thumb sc-thumb--cover"><img src="${esc(db().webzine.publicUrl(w.cover_path))}" alt="" loading="lazy" /></div>`
      : '';
    return `<a class="search-card" href="webzine.html">
      ${cover}
      <div class="sc-body">
        <div class="sc-kicker">${esc(w.category || 'WEBZINE')}${w.issue_label ? ' · ' + esc(w.issue_label) : ''}</div>
        <div class="sc-title">${highlight(w.title || '', q)}</div>
        ${w.description ? `<div class="sc-meta">${esc(String(w.description).slice(0, 80))}${String(w.description).length > 80 ? '…' : ''}</div>` : ''}
      </div>
    </a>`;
  }

  function cardLab(l, q) {
    return `<a class="search-card" href="labs.html">
      <div class="sc-body">
        <div class="sc-kicker">LAB${l.region ? ' · ' + esc(l.region) : ''}</div>
        <div class="sc-title">${highlight(l.name || '', q)}</div>
        ${l.address ? `<div class="sc-meta">${esc(l.address)}</div>` : ''}
      </div>
    </a>`;
  }

  function cardMarket(m, q) {
    const priceTxt = (m.price && Number(m.price) > 0)
      ? Number(m.price).toLocaleString('ko-KR') + '원'
      : '가격 협의';
    return `<a class="search-card" href="market.html#item-${esc(m.id || '')}">
      <div class="sc-body">
        <div class="sc-kicker">MARKET${m.category ? ' · ' + esc(m.category) : ''}</div>
        <div class="sc-title">${highlight(m.title || '', q)}</div>
        <div class="sc-meta">${esc(priceTxt)}</div>
      </div>
    </a>`;
  }

  async function searchAll(q) {
    if (!q) { renderHint(); return; }
    setHtml('<p class="search-hint">검색 중…</p>');
    const match = makeMatcher(q);

    const dbReady = db() && db().isReady && db().isReady();

    const [storiesArr, filmsObj, webzineArr, labsArr, marketArr] = await Promise.all([
      fetchJsonSafe('/data/stories.json'),
      fetchJsonSafe('/data/films.json'),
      dbReady ? db().webzine.listPublished() : Promise.resolve([]),
      dbReady ? db().labs.list() : Promise.resolve([]),
      dbReady ? db().market.list({ limit: 500 }) : Promise.resolve([]),
    ]);

    const stories = (storiesArr || [])
      .filter((a) => a && a.published !== false)
      .filter((a) => match([a.title, a.author, a.excerpt, a.categoryLabel, a.category]));

    const films = Object.values(filmsObj || {})
      .filter((f) => f && match([f.name, f.displayName, f.brand, f.desc, (f.aliases || []).join(' ')]));

    const webzine = (webzineArr || [])
      .filter((w) => match([w.title, w.category, w.issue_label, w.description, w.slug]));

    const labs = (labsArr || [])
      .filter((l) => match([l.name, l.region, l.address, (l.tags || []).join(' '), l.summary, l.description]));

    const market = (marketArr || [])
      .filter((m) => match([m.title, m.description, m.category, m.brand]));

    const sections = [
      { label: 'Articles', items: stories, all: 'stories.html?q=' + encodeURIComponent(q), card: (s) => cardArticle(s, q) },
      { label: 'Films',    items: films,   all: 'films.html',                              card: (f) => cardFilm(f, q) },
      { label: 'Webzine',  items: webzine, all: 'webzine.html',                            card: (w) => cardWebzine(w, q) },
      { label: 'Labs',     items: labs,    all: 'labs.html',                               card: (l) => cardLab(l, q) },
      { label: 'Market',   items: market,  all: 'market.html',                             card: (m) => cardMarket(m, q) },
    ];

    const total = sections.reduce((a, s) => a + s.items.length, 0);
    if (total === 0) { renderEmpty(q); return; }

    const PER = 8;
    const html = sections
      .filter((s) => s.items.length > 0)
      .map((s) => {
        const more = s.items.length > PER
          ? `<a class="search-more" href="${s.all}">전체 ${s.items.length}건 보기 →</a>`
          : '';
        return `<section class="search-section">
          <h2 class="search-section-head">${s.label} <span class="search-count">${s.items.length}</span></h2>
          <div class="search-grid">${s.items.slice(0, PER).map(s.card).join('')}</div>
          ${more}
        </section>`;
      }).join('');

    setHtml(`<p class="search-summary">"${esc(q)}" 검색 결과 총 <strong>${total}건</strong></p>` + html);
  }

  // db-client 준비 대기 (최대 3초). 정적 JSON 은 그동안에도 조회 가능하므로
  // 너무 길게 기다리지 않는다.
  async function waitForDb(maxMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (db() && db().isReady && db().isReady()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    syncUrl(q);
    searchAll(q);
  });

  (async function init() {
    const initialQ = (new URLSearchParams(location.search).get('q') || '').trim();
    if (initialQ) {
      input.value = initialQ;
      // 검색바 자동 포커스(데스크탑) — 모바일은 키보드 자동 노출 방지로 생략
      if (matchMedia && matchMedia('(min-width: 720px)').matches) {
        try { input.focus({ preventScroll: true }); } catch (_) {}
      }
      await waitForDb();
      searchAll(initialQ);
    } else {
      input.focus({ preventScroll: true });
    }
  })();
})();
