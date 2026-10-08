// 5ft magazine 전체 검색 — Articles + Films + Webzine + Labs + Market 통합.
// 정적 JSON(data/stories.json, data/films.json) + Supabase(webzine/labs/market) 병렬 조회 후
// 클라이언트에서 점수 기반 매칭. 도메인별로 필드 가중치 (제목 > 부제 > 본문) +
// exact / prefix / includes 단계별 점수. 점수 0 이면 비매칭, 점수순으로 정렬해 노출.
//
// shadcn/cmdk 결을 가볍게 차용: 입력 즉시 필터 (150ms debounce), 키보드 ↑/↓ Enter,
// density 그리드/리스트 토글 (localStorage 기억).
(function () {
  'use strict';
  const i18n = window.i18n;

  const $ = (id) => document.getElementById(id);
  const input   = $('searchQ');
  const form    = $('searchForm');
  const results = $('searchResults');

  const DENSITY_KEY = '5ft-search-density';
  let density = localStorage.getItem(DENSITY_KEY) || 'grid';
  if (density !== 'grid' && density !== 'list') density = 'grid';

  const esc = window.MagUtil.escapeHtml;
  function db() { return window.MagDB; }

  function syncUrl(q) {
    const url = new URL(location.href);
    if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
    history.replaceState(null, '', url.pathname + url.search);
  }

  async function fetchJsonSafe(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch (_) { return null; }
  }

  // ── 점수 매칭 ──
  // tokens: 사용자가 입력한 키워드를 소문자 + 공백으로 나눈 토큰 배열.
  // fields: [{ text, weight }, ...] — 가중치는 도메인별로 정의 (제목 큰 가중, 본문 작은 가중).
  // 한 토큰이 어떤 필드에 매칭되는 단계:
  //   - 필드 전체와 정확히 일치 → weight × 2
  //   - 필드가 토큰으로 시작 → weight × 1.5
  //   - 필드에 토큰 포함 → weight × 1.0
  // 토큰 하나라도 어느 필드에도 매칭 안 되면 점수 0 (AND 매칭 유지).
  // 토큰별 최고 점수를 누적해 최종 점수 반환.
  function scoreMatch(tokens, fields) {
    if (!tokens.length) return 0;
    let total = 0;
    for (const tok of tokens) {
      let best = 0;
      for (const f of fields) {
        if (!f || !f.text) continue;
        const lower = String(f.text).toLowerCase();
        if (lower === tok) {
          best = Math.max(best, f.weight * 2);
        } else if (lower.startsWith(tok)) {
          best = Math.max(best, f.weight * 1.5);
        } else if (lower.includes(tok)) {
          best = Math.max(best, f.weight);
        }
      }
      if (best === 0) return 0;
      total += best;
    }
    return total;
  }

  function tokenize(q) {
    return q.toLowerCase().split(/\s+/).filter(Boolean);
  }

  function highlight(text, q) {
    if (!q) return esc(text);
    const tokens = tokenize(q);
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
    setHtml(`<p class="search-hint">${i18n.t('키워드 한 줄이면 글·필름·책·현상소·수리실·매물을 한꺼번에 찾아요.', 'One search covers articles, films, books, labs, repair shops and market listings.', 'キーワードひとつで、記事・フィルム・本・現像所・修理店・出品をまとめて検索できます。')}</p>`);
  }

  function renderEmpty(q) {
    setHtml(i18n.t(
      `<p class="search-empty">"<strong>${esc(q)}</strong>" 검색 결과가 없어요.<br />다른 단어로 다시 시도해 보세요.</p>`,
      `<p class="search-empty">No results for "<strong>${esc(q)}</strong>".<br />Try a different word.</p>`, `<p class="search-empty">「<strong>${esc(q)}</strong>」の検索結果はありません。<br />別の言葉でもう一度お試しください。</p>`));
  }

  function cardArticle(s, q) {
    const thumb = s.thumbnail
      ? `<div class="sc-thumb"><img src="${esc(s.thumbnail)}" alt="" loading="lazy" /></div>`
      : '';
    const author = i18n.lang === 'ja' ? (s.authorJa || s.authorEn || s.author) : i18n.isEn ? (s.authorEn || s.author) : s.author;
    const meta = [author, s.date].filter(Boolean).map(esc).join(' · ');
    // 영문판: localizeStories 가 번역된 글의 page 를 en/ 로 바꿔 둔다. <base href="/"> 라 절대경로로 쓴다.
    const href = i18n.isEn && s.page ? '/' + s.page.replace(/^\//, '') : (s.page || '#');
    return `<a class="search-card" href="${esc(href)}">
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
    const desc = i18n.lang === 'ja' ? (f.descJa || f.descEn || f.desc) : i18n.isEn ? (f.descEn || f.desc) : f.desc;
    const href = i18n.isEn ? i18n.url('/films.html?film=' + encodeURIComponent(f.slug || '')) : `films.html?film=${encodeURIComponent(f.slug || '')}`;
    return `<a class="search-card" href="${href}">
      <div class="sc-body">
        <div class="sc-kicker">${esc(f.brand || 'FILM')}</div>
        <div class="sc-title">${highlight(name, q)}</div>
        ${desc ? `<div class="sc-meta">${esc(String(desc).slice(0, 80))}${String(desc).length > 80 ? '…' : ''}</div>` : ''}
      </div>
    </a>`;
  }

  function cardWebzine(w, q) {
    const cover = w.cover_path && db() && db().webzine
      ? `<div class="sc-thumb sc-thumb--cover"><img src="${esc(db().webzine.publicUrl(w.cover_path))}" alt="" loading="lazy" /></div>`
      : '';
    return `<a class="search-card" href="${i18n.isEn ? i18n.url('/books.html') : 'books.html'}">
      ${cover}
      <div class="sc-body">
        <div class="sc-kicker">${esc(w.category || 'BOOKS')}${w.issue_label ? ' · ' + esc(w.issue_label) : ''}</div>
        <div class="sc-title">${highlight(w.title || '', q)}</div>
        ${w.description ? `<div class="sc-meta">${esc(String(w.description).slice(0, 80))}${String(w.description).length > 80 ? '…' : ''}</div>` : ''}
      </div>
    </a>`;
  }

// labs-page.js 의 itemSlug 와 같은 규칙. 현상소·수리실 딥링크(?lab=)가 이 값으로
  // 항목을 찾으므로 규칙이 어긋나면 링크를 눌러도 아무 일이 일어나지 않는다.
  function labSlug(lab) {
    const raw = `${lab?.name || ''}-${lab?.region || ''}`;
    return String(raw).toLowerCase()
      .replace(/[^a-z0-9가-힣\s-]/g, '')
      .replace(/\s+/g, '-').replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function cardLab(l, q, kicker = 'LAB') {
    const href = i18n.isEn ? i18n.url('/labs.html?lab=' + encodeURIComponent(labSlug(l))) : `labs.html?lab=${encodeURIComponent(labSlug(l))}`;
    return `<a class="search-card" href="${href}">
      <div class="sc-body">
        <div class="sc-kicker">${kicker}${l.region ? ' · ' + esc(l.region) : ''}</div>
        <div class="sc-title">${highlight(l.name || '', q)}</div>
        ${l.address ? `<div class="sc-meta">${esc(l.address)}</div>` : ''}
      </div>
    </a>`;
  }

  // 작가(투고자) 카드. url 은 빌더가 넣어 준다. 페이지가 있으면 /contributor/<키>,
  // 없으면 카탈로그의 작가 뷰로 간다.
  function cardContributor(c, q) {
    return `<a class="search-card" href="${esc(c.url || '/films.html')}">
      <div class="sc-body">
        <div class="sc-kicker">CONTRIBUTOR</div>
        <div class="sc-title">${highlight(c.label || c.key || '', q)}</div>
        <div class="sc-meta">${i18n.t(`사진 ${Number(c.count) || 0}장`, `${Number(c.count) || 0} photos`, `写真 ${Number(c.count) || 0}枚`)}</div>
      </div>
    </a>`;
  }

  function cardMarket(m, q) {
    const priceTxt = (m.price && Number(m.price) > 0)
      ? window.MagUtil.formatPrice(m.price)
      : i18n.t('가격 협의', 'Price negotiable', '価格応相談');
    const href = i18n.isEn ? i18n.url('/market.html?id=' + encodeURIComponent(m.id || '')) : `market.html?id=${encodeURIComponent(m.id || '')}`;
    return `<a class="search-card" href="${href}">
      <div class="sc-body">
        <div class="sc-kicker">MARKET${m.category ? ' · ' + esc(m.category) : ''}</div>
        <div class="sc-title">${highlight(m.title || '', q)}</div>
        <div class="sc-meta">${esc(priceTxt)}</div>
      </div>
    </a>`;
  }

  async function loadPlaces(api, staticPath, key) {
    try {
      const rows = api ? await api.list({ strict: true }) : null;
      if (Array.isArray(rows)) return rows;
    } catch (_) { /* 정적 목록으로 */ }
    const data = await fetchJsonSafe(staticPath);
    return Array.isArray(data?.[key]) ? data[key] : [];
  }

  async function searchAll(q) {
    if (!q) { renderHint(); return; }
    setHtml(`<p class="search-hint">${i18n.t('검색 중…', 'Searching…', '検索中…')}</p>`);
    const tokens = tokenize(q);

    // isReady() 는 누군가 클라이언트를 한 번 만든 뒤에야 true 가 된다. 목록 함수는
    // 클라이언트가 없으면 스스로 만들므로 MagDB 가 있으면 바로 묻는다.
    const dbReady = !!db();

    const [storiesArr, filmsObj, contributorsArr, webzineArr, labsArr, marketArr, repairsArr] = await Promise.all([
      window.MagUtil.loadStories(),
      window.FilmsCatalogLoader
        ? window.FilmsCatalogLoader.load({ staticPath: '/data/films.json' }).then(result => result.data).catch(() => ({}))
        : fetchJsonSafe('/data/films.json'),
      // 빌드 때 승인 사진에서 뽑은 작가 목록. 사진 전체를 받아오지 않고도
      // 아이디로 찾을 수 있다.
      fetchJsonSafe('/data/contributors.json'),
      dbReady ? db().webzine.listPublished() : Promise.resolve([]),
      // 현상소·수리실은 현상소 페이지처럼 DB 를 못 읽으면 정적 목록으로 찾는다.
      loadPlaces(dbReady && db().labs, '/data/labs.json', 'labs'),
      dbReady ? db().market.list({ limit: 500 }) : Promise.resolve([]),
      loadPlaces(dbReady && db().repairs, '/data/repairs.json', 'repairs'),
    ]);

    // 도메인별 점수 매기기. weight 는 사용자 검색 의도에 맞춰 제목 > 부제목 > 본문 순.
    const stories = (storiesArr || [])
      .filter(window.MagUtil.isPublishedContent)
      .map((a) => ({
        item: a,
        score: scoreMatch(tokens, [
          { text: a.title, weight: 10 },
          // 영문판에선 a.title 이 영문 제목이다. 한국어로 쳐도 찾히게 원제(titleKo)도 본다.
          { text: a.titleKo, weight: 10 },
          { text: a.titleEn, weight: 10 },
          { text: a.titleJa, weight: 10 },
          { text: a.author, weight: 5 },
          { text: a.authorEn, weight: 5 },
          { text: a.authorJa, weight: 5 },
          { text: a.categoryLabel, weight: 3 },
          { text: a.category, weight: 3 },
          { text: a.excerpt, weight: 2 },
          { text: a.excerptEn, weight: 2 },
          { text: a.excerptJa, weight: 2 },
        ]),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const films = Object.values(filmsObj || {})
      .map((f) => ({
        item: f,
        score: scoreMatch(tokens, [
          { text: f.displayName, weight: 10 },
          { text: f.name, weight: 10 },
          { text: f.brand, weight: 7 },
          { text: (f.aliases || []).join(' '), weight: 8 },
          { text: f.desc, weight: 2 },
          { text: f.descEn, weight: 2 },
          { text: f.descJa, weight: 2 },
        ]),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const webzine = (webzineArr || [])
      .map((w) => ({
        item: w,
        score: scoreMatch(tokens, [
          { text: w.title, weight: 10 },
          { text: w.issue_label, weight: 5 },
          { text: w.category, weight: 3 },
          { text: w.description, weight: 2 },
          { text: w.slug, weight: 1 },
        ]),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    // DB 행은 snake_case(name_en), 정적 labs.json 은 camelCase(nameEn) 라 둘 다 본다.
    const placeFields = (l) => [
      { text: l.name, weight: 10 },
      { text: l.name_en ?? l.nameEn, weight: 10 },
      { text: l.name_ja ?? l.nameJa, weight: 10 },
      { text: l.region, weight: 5 },
      { text: l.specialty, weight: 4 },
      { text: l.specialty_en, weight: 4 },
      { text: l.specialty_ja, weight: 4 },
      { text: l.address, weight: 3 },
      { text: l.address_en ?? l.addressEn, weight: 3 },
      { text: l.address_ja ?? l.addressJa, weight: 3 },
      { text: l.features, weight: 2 },
      { text: l.features_en ?? l.featuresEn, weight: 2 },
      { text: l.features_ja ?? l.featuresJa, weight: 2 },
      { text: l.description, weight: 2 },
      { text: l.description_en, weight: 2 },
      { text: l.description_ja, weight: 2 },
    ];
    const rankPlaces = (arr) => (arr || [])
      .map((l) => ({ item: l, score: scoreMatch(tokens, placeFields(l)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const labs = rankPlaces(labsArr);
    const repairs = rankPlaces(repairsArr);

    const market = (marketArr || [])
      .map((m) => ({
        item: m,
        score: scoreMatch(tokens, [
          { text: m.title, weight: 10 },
          { text: m.brand, weight: 5 },
          { text: m.category, weight: 3 },
          { text: m.description, weight: 2 },
        ]),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    // 작가 — 아이디(키)와 표시 이름 둘 다로 찾는다. 독자는 "@" 를 붙여 검색하기도
    // 하고 빼고 치기도 하므로 키는 "@" 없는 형태로 저장돼 있다.
    const contributors = (contributorsArr || [])
      .map((c) => ({
        item: c,
        score: scoreMatch(tokens, [
          { text: c.key, weight: 10 },
          { text: c.label, weight: 10 },
          { text: String(c.label || '').replace(/^@/, ''), weight: 8 },
        ]),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.item.count || 0) - (a.item.count || 0));

    const sections = [
      { label: 'Articles', items: stories, all: i18n.isEn ? i18n.url('/stories.html?q=' + encodeURIComponent(q)) : 'stories.html?q=' + encodeURIComponent(q), card: (x) => cardArticle(x.item, q) },
      { label: 'Films',    items: films,   all: i18n.isEn ? i18n.url('/films.html') : 'films.html',                              card: (x) => cardFilm(x.item, q) },
      { label: 'Contributors', items: contributors, all: i18n.isEn ? i18n.url('/films.html') : 'films.html', card: (x) => cardContributor(x.item, q) },
      { label: 'Books',    items: webzine, all: i18n.isEn ? i18n.url('/books.html') : 'books.html',                              card: (x) => cardWebzine(x.item, q) },
      { label: 'Labs',     items: labs,    all: i18n.isEn ? i18n.url('/labs.html') : 'labs.html',                               card: (x) => cardLab(x.item, q) },
      { label: 'Repair Shops', items: repairs, all: i18n.isEn ? i18n.url('/labs.html') : 'labs.html',                         card: (x) => cardLab(x.item, q, 'REPAIR') },
      { label: 'Market',   items: market,  all: i18n.isEn ? i18n.url('/market.html') : 'market.html',                             card: (x) => cardMarket(x.item, q) },
    ];

    const total = sections.reduce((a, s) => a + s.items.length, 0);
    if (total === 0) { renderEmpty(q); return; }

    const PER = 8;
    const gridCls = density === 'list' ? 'search-grid search-grid--list' : 'search-grid';
    const html = sections
      .filter((s) => s.items.length > 0)
      .map((s) => {
        const more = s.items.length > PER
          ? `<a class="search-more" href="${s.all}">${i18n.t(`전체 ${s.items.length}건 보기 →`, `See all ${s.items.length} →`, `${s.items.length}件をすべて見る →`)}</a>`
          : '';
        return `<section class="search-section">
          <h2 class="search-section-head">${s.label} <span class="search-count">${s.items.length}</span></h2>
          <div class="${gridCls}">${s.items.slice(0, PER).map(s.card).join('')}</div>
          ${more}
        </section>`;
      }).join('');

    setHtml(i18n.t(
      `<p class="search-summary">"${esc(q)}" 검색 결과 총 <strong>${total}건</strong></p>`,
      `<p class="search-summary"><strong>${total} ${total === 1 ? 'result' : 'results'}</strong> for "${esc(q)}"</p>`, `<p class="search-summary">「${esc(q)}」の検索結果 <strong>${total}件</strong></p>`) + html);
    resetFocus();
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

  // ── 키보드 네비게이션 ──
  // 결과 카드를 ↑/↓ 로 옮기고 Enter 로 진입. 검색 입력에 포커스가 있어도 동작.
  let focusedIdx = -1;
  function resetFocus() { focusedIdx = -1; updateFocusedCard(); }
  function getCards() { return Array.from(results.querySelectorAll('.search-card')); }
  function updateFocusedCard() {
    const cards = getCards();
    cards.forEach((c, i) => c.classList.toggle('is-focused', i === focusedIdx));
    if (focusedIdx >= 0 && cards[focusedIdx]) {
      cards[focusedIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  function moveFocus(delta) {
    const cards = getCards();
    if (!cards.length) return;
    focusedIdx = (focusedIdx + delta + cards.length) % cards.length;
    updateFocusedCard();
  }
  function activateFocused() {
    const cards = getCards();
    const target = cards[focusedIdx];
    if (target && target.href) location.href = target.href;
  }

  // ── 라이브 필터 (debounce) ──
  let liveTimer = null;
  const LIVE_MS = 150;
  function scheduleLive() {
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      const q = input.value.trim();
      syncUrl(q);
      searchAll(q);
    }, LIVE_MS);
  }

  input.addEventListener('input', scheduleLive);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(+1); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); moveFocus(-1); }
    else if (e.key === 'Enter' && focusedIdx >= 0) { e.preventDefault(); activateFocused(); }
  });
  // 결과 영역에서도 화살표/Enter 가 동작 (입력 포커스 안 갔을 때 키보드만으로 이동).
  document.addEventListener('keydown', (e) => {
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(+1); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); moveFocus(-1); }
    else if (e.key === 'Enter' && focusedIdx >= 0) { e.preventDefault(); activateFocused(); }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; }
    const q = input.value.trim();
    syncUrl(q);
    searchAll(q);
  });

  // ── density 토글 (그리드 / 리스트) ──
  function applyDensity() {
    document.querySelectorAll('.search-density-btn').forEach((b) => {
      const on = b.dataset.density === density;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    // 이미 그려진 결과에도 즉시 반영
    results.querySelectorAll('.search-grid').forEach((g) => {
      g.classList.toggle('search-grid--list', density === 'list');
    });
  }
  document.querySelectorAll('.search-density-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      density = btn.dataset.density === 'list' ? 'list' : 'grid';
      localStorage.setItem(DENSITY_KEY, density);
      applyDensity();
    });
  });

  (async function init() {
    applyDensity();
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
