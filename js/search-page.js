// 5ft magazine 전체 검색 — Articles + Films + Webzine + Labs + Market 통합.
// 정적 JSON(data/stories.json, data/films.json) + Supabase(webzine/labs/market) 병렬 조회 후
// 클라이언트에서 점수 기반 매칭. 도메인별로 필드 가중치 (제목 > 부제 > 본문) +
// exact / prefix / includes 단계별 점수. 점수 0 이면 비매칭, 점수순으로 정렬해 노출.
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
    setHtml('<p class="search-hint">키워드 한 줄이면 글·필름·책·현상소·매물을 한꺼번에 찾아요.</p>');
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
    return `<a class="search-card" href="books.html">
      ${cover}
      <div class="sc-body">
        <div class="sc-kicker">${esc(w.category || 'BOOKS')}${w.issue_label ? ' · ' + esc(w.issue_label) : ''}</div>
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
    const tokens = tokenize(q);

    const dbReady = db() && db().isReady && db().isReady();

    const [storiesArr, filmsObj, webzineArr, labsArr, marketArr] = await Promise.all([
      fetchJsonSafe('/data/stories.json'),
      fetchJsonSafe('/data/films.json'),
      dbReady ? db().webzine.listPublished() : Promise.resolve([]),
      dbReady ? db().labs.list() : Promise.resolve([]),
      dbReady ? db().market.list({ limit: 500 }) : Promise.resolve([]),
    ]);

    // 도메인별 점수 매기기. weight 는 사용자 검색 의도에 맞춰 제목 > 부제목 > 본문 순.
    const stories = (storiesArr || [])
      .filter((a) => a && a.published !== false)
      .map((a) => ({
        item: a,
        score: scoreMatch(tokens, [
          { text: a.title, weight: 10 },
          { text: a.author, weight: 5 },
          { text: a.categoryLabel, weight: 3 },
          { text: a.category, weight: 3 },
          { text: a.excerpt, weight: 2 },
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

    const labs = (labsArr || [])
      .map((l) => ({
        item: l,
        score: scoreMatch(tokens, [
          { text: l.name, weight: 10 },
          { text: l.region, weight: 5 },
          { text: (l.tags || []).join(' '), weight: 4 },
          { text: l.address, weight: 3 },
          { text: l.summary, weight: 2 },
          { text: l.description, weight: 2 },
        ]),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

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

    const sections = [
      { label: 'Articles', items: stories, all: 'stories.html?q=' + encodeURIComponent(q), card: (x) => cardArticle(x.item, q) },
      { label: 'Films',    items: films,   all: 'films.html',                              card: (x) => cardFilm(x.item, q) },
      { label: 'Books',    items: webzine, all: 'books.html',                              card: (x) => cardWebzine(x.item, q) },
      { label: 'Labs',     items: labs,    all: 'labs.html',                               card: (x) => cardLab(x.item, q) },
      { label: 'Market',   items: market,  all: 'market.html',                             card: (x) => cardMarket(x.item, q) },
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
