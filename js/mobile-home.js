'use strict';

// 5ft.mag 모바일 전용 홈 — index.html 에서만 동작.
// 모바일 (640px 이하) + PC 보기 토글 꺼진 경우 .is-mobile-home 클래스 부여 후 렌더.
// 신규 글 띠 (최근 2주) + Films Library 브랜드별 가로 row (ABC 순, 임계 3+) + 그 외 브랜드 그리드.

(function () {
  const MOBILE_MAX = 640;
  const NEW_DAYS = 14;
  const BIG_BRAND_MIN = 3;   // 3개 이상은 독립 row, 미만은 "그 외 브랜드"

  function isMobile() {
    if (window.MagPwa && window.MagPwa.isForceDesktop()) return false;
    return window.matchMedia && window.matchMedia(`(max-width: ${MOBILE_MAX}px)`).matches;
  }

  if (!document.getElementById('mhRoot')) return;

  // breakpoint 를 실제로 넘나들면 레이아웃 재초기화 (reload).
  // 모바일 홈과 split-layout 은 DOM/JS 초기화가 완전히 달라 in-place 전환이
  // 복잡해서, 경계를 넘는 순간에만 한 번 새로고침해 올바른 레이아웃으로 맞춘다.
  // matchMedia change 는 경계를 넘을 때만 발화하므로 일반 resize 마다 돌지 않는다.
  if (window.matchMedia) {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX}px)`);
    const initialMobile = isMobile();
    const onBreakpoint = () => { if (isMobile() !== initialMobile) location.reload(); };
    if (mq.addEventListener) mq.addEventListener('change', onBreakpoint);
    else if (mq.addListener) mq.addListener(onBreakpoint);
  }

  if (!isMobile()) return;

  document.documentElement.classList.add('is-mobile-home');

  const root = document.getElementById('mhRoot');

  // ── 데이터 fetch ──
  async function fetchJson(url) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      return await res.json();
    } catch (err) { console.warn('[mh] fetch', url, err); return null; }
  }

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function daysAgo(iso) {
    if (!iso) return 999;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 999;
    return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  }

  // ── 렌더: 신규 글 띠 ──
  function renderNewStories(stories) {
    const fresh = stories.filter(s => s.published !== false && daysAgo(s.date) <= NEW_DAYS);
    if (!fresh.length) return '';
    const cards = fresh.slice(0, 12).map(s => `
      <a class="mh-new-card" href="/${esc(s.page)}">
        <div class="mh-new-thumb">${s.thumbnail ? `<img src="/${esc(s.thumbnail)}" alt="" loading="lazy" />` : ''}</div>
        <div class="mh-new-meta">${esc(s.categoryLabel || s.category || '')}</div>
        <div class="mh-new-headline">${esc(s.title)}</div>
      </a>
    `).join('');
    return `
      <section class="mh-new">
        <div class="mh-new-head">
          <h2 class="mh-new-title">새 글 · 최근 2주</h2>
          <a class="mh-new-more" href="/stories.html">전체 보기 →</a>
        </div>
        <div class="mh-new-strip">${cards}</div>
      </section>
    `;
  }

  // ── Films 처리 ──
  function filmThumb(f) {
    // films.json 의 실제 필드: canThumbnail (캔 모양 일러스트) > boxThumbnail (박스) > photos[0].src
    const path = f.canThumbnail || f.boxThumbnail || (Array.isArray(f.photos) && f.photos[0]?.src) || '';
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return '/' + path.replace(/^\.\//, '').replace(/^\//, '');
  }

  function filmCardHtml(f) {
    const slug = f.slug || f.id;
    const name = f.displayName || f.name || '';
    return `
      <button type="button" class="mh-card" data-film-slug="${escAttr(slug)}" aria-label="${esc(name)} 자세히 보기">
        <div class="mh-card-thumb">${filmThumb(f) ? `<img src="${esc(filmThumb(f))}" alt="" loading="lazy" />` : ''}</div>
        <div class="mh-card-name">${esc(name)}</div>
      </button>
    `;
  }

  function brandFilter(query, category) {
    const q = (query || '').trim().toLowerCase();
    return (f) => {
      // featured (5ft Issue) 도 브랜드 row 에 함께 노출 — Cinestill 800T 등 대표 필름이 묻히지 않게
      if (category && category !== 'all') {
        const t = String(f.type || '').toLowerCase();
        if (category === 'color' && !t.includes('color')) return false;
        if (category === 'bw' && !(t.includes('black') || t.includes('bw') || t.includes('mono'))) return false;
        if (category === 'slide' && !(t.includes('slide') || t.includes('e-6') || t.includes('reversal'))) return false;
        if (category === 'cinema' && !(t.includes('tungsten') || t.includes('daylight') || t.includes('cinema'))) return false;
      }
      if (!q) return true;
      const hay = `${f.brand || ''} ${f.name || ''} ${f.displayName || ''} ${f.aliases?.join(' ') || ''}`.toLowerCase();
      return hay.includes(q);
    };
  }

  // 브랜드 좋아요 (localStorage 기반)
  const FAV_BRANDS_KEY = '5ft-fav-brands';
  function getFavBrands() {
    try { return new Set(JSON.parse(localStorage.getItem(FAV_BRANDS_KEY) || '[]')); }
    catch { return new Set(); }
  }
  function toggleFavBrand(brand) {
    const set = getFavBrands();
    if (set.has(brand)) set.delete(brand); else set.add(brand);
    try { localStorage.setItem(FAV_BRANDS_KEY, JSON.stringify([...set])); } catch {}
    return set;
  }

  function renderLibrary(films, query, category) {
    const filterFn = brandFilter(query, category);
    const list = films.filter(filterFn);

    // 검색·필터 활성 시 그리드로
    if (query.trim() || category !== 'all') {
      root.classList.add('is-searching');
      if (!list.length) {
        // 다음 행동 제안: 다른 추천 필름 또는 전체로 돌아가기
        const all = films.filter(f => f.tier !== 'featured');
        const random = all.length ? all[Math.floor(Math.random() * all.length)] : null;
        const suggest = random ? `<a class="mh-empty-link" href="/films.html?film=${encodeURIComponent(random.slug)}">${esc(random.displayName || random.name)} 한번 보실래요?</a>` : '';
        return `
          <div class="mh-empty">
            <p>조건에 맞는 필름이 없어요.</p>
            ${suggest}
            <button type="button" class="mh-empty-btn" id="mhResetSearch">전체 보기로 돌아가기</button>
          </div>`;
      }
      return `<div class="mh-search-grid">${list.map(filmCardHtml).join('')}</div>`;
    }
    root.classList.remove('is-searching');

    // 브랜드별 그룹화
    const byBrand = new Map();
    for (const f of list) {
      const b = (f.brand || '기타').toUpperCase();
      if (!byBrand.has(b)) byBrand.set(b, []);
      byBrand.get(b).push(f);
    }
    // 정렬: 좋아요한 브랜드 ABC 순 먼저, 그 다음 나머지 ABC 순
    const favs = getFavBrands();
    const sortedBrands = [...byBrand.entries()].sort((a, b) => {
      const aFav = favs.has(a[0]) ? 0 : 1;
      const bFav = favs.has(b[0]) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      return a[0].localeCompare(b[0], 'en');
    });

    const bigRows = [];
    const smallFilms = [];
    for (const [brand, items] of sortedBrands) {
      if (items.length >= BIG_BRAND_MIN) {
        const cards = items
          .sort((a, b) => (a.displayName || a.name || '').localeCompare(b.displayName || b.name || '', 'en', { sensitivity: 'base' }))
          .map(filmCardHtml).join('');
        const isFav = favs.has(brand);
        bigRows.push(`
          <section class="mh-brand${isFav ? ' is-fav' : ''}">
            <div class="mh-brand-head">
              <h3 class="mh-brand-name">${esc(brand)}</h3>
              <span class="mh-brand-count">${items.length}</span>
              <button type="button" class="mh-brand-fav${isFav ? ' is-on' : ''}" data-fav-brand="${escAttr(brand)}" aria-label="${esc(brand)} 좋아요" aria-pressed="${isFav}">
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="${isFav ? 'currentColor' : 'none'}"/>
                </svg>
              </button>
            </div>
            <div class="mh-brand-strip">${cards}</div>
          </section>
        `);
      } else {
        smallFilms.push(...items);
      }
    }
    const smallSorted = smallFilms.sort((a, b) => (a.brand || '').localeCompare(b.brand || '', 'en'));
    const othersHtml = smallSorted.length ? `
      <section class="mh-others">
        <h3 class="mh-others-head">그 외 브랜드</h3>
        <p class="mh-others-sub">한두 가지 필름만 나온 브랜드들이에요.</p>
        <div class="mh-others-grid">${smallSorted.map(filmCardHtml).join('')}</div>
      </section>
    ` : '';

    return renderRecentRow() + bigRows.join('') + othersHtml;
  }

  // escAttr 도우미
  function escAttr(s) { return esc(s); }

  // ── 본체 렌더 ──
  // view: 'films' (브랜드별) | 'photos' (전체 사진 그리드)
  const VIEW_KEY = '5ft-mh-view';
  function getSavedView() {
    try { return localStorage.getItem(VIEW_KEY) === 'photos' ? 'photos' : 'films'; }
    catch { return 'films'; }
  }
  function saveView(v) {
    try { localStorage.setItem(VIEW_KEY, v); } catch {}
  }
  const STATE = { films: [], stories: [], query: '', category: 'all', view: getSavedView() };

  function render() {
    if (STATE.view === 'photos') {
      root.querySelector('#mhBody').innerHTML = `<div id="mhPhotoGrid" class="mh-photo-grid" aria-busy="true">${
        Array.from({ length: 12 }).map(() => '<div class="mh-photo-cell mh-photo-cell-skel"></div>').join('')
      }</div>`;
      loadPhotoGrid();
      return;
    }
    const newHtml = renderNewStories(STATE.stories);
    const libraryHtml = renderLibrary(STATE.films, STATE.query, STATE.category);
    root.querySelector('#mhBody').innerHTML = newHtml + libraryHtml;
  }

  function bindControls() {
    const search = root.querySelector('#mhSearch');
    const chips = root.querySelectorAll('.mh-chip');
    // 저장된 view 반영
    root.querySelectorAll('.mh-view-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.view === STATE.view);
      b.setAttribute('aria-selected', String(b.dataset.view === STATE.view));
    });
    root.querySelectorAll('.mh-view-btn').forEach(btn => btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      if (v === STATE.view) return;
      STATE.view = v;
      saveView(v);
      try { window.trackEvent?.('view_changed', { view: v }); } catch (_) {}
      root.querySelectorAll('.mh-view-btn').forEach(b => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-selected', String(b === btn));
      });
      render();
    }));
    search.addEventListener('input', () => { STATE.query = search.value; render(); });
    chips.forEach(c => c.addEventListener('click', () => {
      chips.forEach(x => x.classList.remove('is-active'));
      c.classList.add('is-active');
      STATE.category = c.dataset.cat;
      render();
    }));
    // 브랜드 좋아요 클릭 위임
    root.querySelector('#mhBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-fav-brand]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      toggleFavBrand(btn.dataset.favBrand);
      // 햅틱 + 짧은 bounce
      try { navigator.vibrate?.(10); } catch {}
      btn.classList.add('is-pulsing');
      setTimeout(() => btn.classList.remove('is-pulsing'), 300);
      render();
      // 좋아요 토글 후 좋아요한 row 위로 스크롤
      requestAnimationFrame(() => {
        const target = root.querySelector(`[data-fav-brand="${CSS.escape(btn.dataset.favBrand)}"]`);
        if (target) target.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
    // 빈 상태의 "전체 보기로 돌아가기"
    root.querySelector('#mhBody').addEventListener('click', (e) => {
      if (e.target.id !== 'mhResetSearch') return;
      const all = root.querySelector('.mh-chip[data-cat="all"]');
      chips.forEach(x => x.classList.remove('is-active'));
      all?.classList.add('is-active');
      STATE.category = 'all'; STATE.query = '';
      search.value = '';
      render();
    });
    // 카드 탭 → 모바일 시트
    root.querySelector('#mhBody').addEventListener('click', (e) => {
      const card = e.target.closest('[data-film-slug]');
      if (!card) return;
      e.preventDefault();
      openFilmSheet(card.dataset.filmSlug);
    });
    // 카드 탭 시 짧은 scale 피드백 (네이티브 톤)
    root.querySelector('#mhBody').addEventListener('touchstart', (e) => {
      const card = e.target.closest('.mh-card, .mh-new-card');
      if (card) card.classList.add('is-pressing');
    }, { passive: true });
    root.querySelector('#mhBody').addEventListener('touchend', (e) => {
      root.querySelectorAll('.is-pressing').forEach(c => c.classList.remove('is-pressing'));
    }, { passive: true });
    root.querySelector('#mhBody').addEventListener('touchcancel', () => {
      root.querySelectorAll('.is-pressing').forEach(c => c.classList.remove('is-pressing'));
    }, { passive: true });
  }

  // ─── 최근 본 필름 (localStorage) ───
  const RECENT_KEY = '5ft-mh-recent';
  const RECENT_MAX = 8;
  function getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
    catch { return []; }
  }
  function pushRecent(slug) {
    if (!slug) return;
    const cur = getRecent().filter(s => s !== slug);
    cur.unshift(slug);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_MAX))); } catch {}
  }
  function recentFilms() {
    const slugs = getRecent();
    const map = new Map(STATE.films.map(f => [f.slug || f.id, f]));
    return slugs.map(s => map.get(s)).filter(Boolean);
  }
  function renderRecentRow() {
    const list = recentFilms();
    if (!list.length) return '';
    return `
      <section class="mh-brand mh-recent">
        <div class="mh-brand-head">
          <h3 class="mh-brand-name">최근 본 필름</h3>
          <span class="mh-brand-count">${list.length}</span>
        </div>
        <div class="mh-brand-strip">${list.map(filmCardHtml).join('')}</div>
      </section>`;
  }

  // ─── 필름 상세 시트 (모달, 카드 탭 시 열림) ───
  // 사진은 reader_submissions 에서 해당 필름으로 등록된 것 중 최근 N장에서 랜덤 16장.
  // 사진 탭 → 인라인 라이트박스 (큰 화면 + swipe).
  // CTA 둘: "사진 올리기" (yellow primary) + "전체 페이지에서 보기" (outline).
  function openFilmSheet(slug) {
    const f = STATE.films.find(x => (x.slug || x.id) === slug);
    if (!f) return;
    pushRecent(slug);
    try { window.trackEvent?.('sheet_opened', { slug }); } catch (_) {}

    document.getElementById('mhSheet')?.remove();

    const name = f.displayName || f.name || '';
    const thumb = filmThumb(f);
    const specs = [
      f.iso ? `ISO ${esc(f.iso)}` : '',
      f.type ? esc(f.type) : '',
      f.format ? esc(f.format) : '',
    ].filter(Boolean).join(' · ');

    const wrap = document.createElement('div');
    wrap.id = 'mhSheet';
    wrap.className = 'mh-sheet-backdrop';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', name);
    wrap.innerHTML = `
      <div class="mh-sheet" role="document">
        <button type="button" class="mh-sheet-grip" aria-label="닫기"></button>
        <div class="mh-sheet-head">
          ${thumb ? `<div class="mh-sheet-thumb"><img src="${escAttr(thumb)}" alt="" /></div>` : ''}
          <div class="mh-sheet-meta">
            <div class="mh-sheet-brand">${esc((f.brand || '').toUpperCase())}</div>
            <h2 class="mh-sheet-name">${esc(name)}</h2>
            ${specs ? `<div class="mh-sheet-specs">${specs}</div>` : ''}
          </div>
        </div>
        ${f.desc ? `<p class="mh-sheet-desc">${esc(f.desc)}</p>` : ''}
        <div class="mh-sheet-photos" id="mhSheetPhotos" aria-busy="true">
          ${Array.from({ length: 9 }).map(() => '<div class="mh-sheet-photo mh-sheet-photo-skeleton" aria-hidden="true"></div>').join('')}
        </div>
        <div class="mh-sheet-cta">
          <button type="button" class="mh-sheet-upload" data-action="open-submission" data-prefill-film="${escAttr(name)}">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            사진 올리기
          </button>
          <a class="mh-sheet-go" href="/films.html?film=${encodeURIComponent(slug)}">전체 페이지에서 보기 →</a>
        </div>
      </div>
    `;

    let releaseTrap = () => {};
    const close = () => {
      wrap.classList.add('is-leaving');
      setTimeout(() => { wrap.remove(); document.documentElement.classList.remove('mh-sheet-open'); }, 220);
      window.removeEventListener('keydown', onKey);
      releaseTrap();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('.mh-sheet-grip').addEventListener('click', close);
    window.addEventListener('keydown', onKey);

    document.documentElement.classList.add('mh-sheet-open');
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('is-open'));
    try { navigator.vibrate?.(8); } catch {}

    // focus trap — 모달 안에 Tab 가둠
    releaseTrap = window.createFocusTrap?.(wrap) || (() => {});

    // 사진 비동기 로드
    loadSheetPhotos(f, wrap.querySelector('#mhSheetPhotos'));
  }

  // ─── 시트 사진 로드 (reader_submissions, 랜덤 16장) ───
  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function filmAliasList(f) {
    const names = new Set();
    [f.name, f.displayName, ...(Array.isArray(f.aliases) ? f.aliases : [])]
      .filter(Boolean).forEach(n => names.add(String(n)));
    return [...names];
  }
  async function loadSheetPhotos(f, container) {
    if (!container) return;
    // MagDB 준비 대기 (안 떠 있을 수 있음)
    let api = null;
    for (let i = 0; i < 50; i++) {
      if (window.MagDB?.isReady?.() && window.MagDB.submissions?.listApprovedByFilms) {
        api = window.MagDB.submissions; break;
      }
      await new Promise(r => setTimeout(r, 80));
    }
    if (!api) { renderSheetEmpty(container, f); return; }

    let rows = [];
    try {
      rows = await api.listApprovedByFilms(filmAliasList(f), { from: 0, to: 99, ascending: false });
    } catch (_) { rows = []; }
    if (!rows.length) { renderSheetEmpty(container, f); return; }

    // 9장(3x3) — 시트 한 화면에 CTA 까지 같이 보이는 분량
    const picked = shuffleInPlace(rows.slice()).slice(0, 9);
    container.removeAttribute('aria-busy');
    container.innerHTML = picked.map((row, i) => `
      <button type="button" class="mh-sheet-photo" data-photo-index="${i}" aria-label="사진 ${i + 1} 크게 보기">
        <img src="${escAttr(row.image)}" alt="" loading="lazy" />
      </button>
    `).join('');
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-photo-index]');
      if (!btn) return;
      const idx = Number(btn.dataset.photoIndex);
      try { window.trackEvent?.('lightbox_opened', { from: 'sheet' }); } catch (_) {}
      openSheetLightbox(picked, idx, f);
    });
  }
  function renderSheetEmpty(container, f) {
    container.removeAttribute('aria-busy');
    const name = f.displayName || f.name || '';
    container.outerHTML = `
      <div class="mh-sheet-empty">
        <p>이 필름으로 올라온 사진이 아직 없어요.</p>
        <button type="button" class="mh-sheet-empty-btn" data-action="open-submission" data-prefill-film="${escAttr(name)}">처음으로 올려보기</button>
      </div>`;
  }

  // ─── 사진 라이트박스 (시트 내 사진 탭 시) ───
  // 메인 사이트 라이트박스(home-page.js) 와 정보 layer 동일하게 구성:
  //   촬영자 / 필름명 / 카메라 / 캡션 / 카운터 / ♡ / 공유 / 필름·촬영자 보기 링크
  function submissionIdOf(row) {
    return typeof row.id === 'string' ? row.id.replace(/^sub-/, '') : '';
  }
  function filmSlugByName(name) {
    if (!name) return '';
    const needle = String(name).toLowerCase().trim();
    const hit = STATE.films.find(x =>
      [x.name, x.displayName, ...(Array.isArray(x.aliases) ? x.aliases : [])]
        .filter(Boolean).map(n => String(n).toLowerCase().trim()).includes(needle)
    );
    return hit ? (hit.slug || hit.id || '') : '';
  }
  function contributorKeyOf(row) {
    return String(row.instagram || row.submitterName || row.author || '').trim().replace(/^@/, '').toLowerCase();
  }

  function openSheetLightbox(rows, startIndex, f) {
    document.getElementById('mhSheetLb')?.remove();
    let cur = startIndex;
    // 현재 사용자 즐겨찾기 ID 집합 (한 번 로드)
    let favIds = new Set();
    let favLoaded = false;

    const lb = document.createElement('div');
    lb.id = 'mhSheetLb';
    lb.className = 'mh-sheet-lb';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.innerHTML = `
      <button type="button" class="mh-sheet-lb-close" aria-label="닫기">✕</button>
      <button type="button" class="mh-sheet-lb-nav mh-sheet-lb-prev" aria-label="이전">‹</button>
      <button type="button" class="mh-sheet-lb-nav mh-sheet-lb-next" aria-label="다음">›</button>
      <div class="mh-sheet-lb-stage"><img alt="" /></div>
      <div class="mh-sheet-lb-info">
        <div class="mh-sheet-lb-meta">
          <span class="mh-sheet-lb-author"></span>
          <a class="mh-sheet-lb-jump mh-sheet-lb-film"></a>
          <a class="mh-sheet-lb-jump mh-sheet-lb-camera"></a>
          <p class="mh-sheet-lb-note" hidden></p>
          <span class="mh-sheet-lb-counter"></span>
        </div>
        <div class="mh-sheet-lb-actions">
          <button type="button" class="mh-sheet-lb-fav" aria-pressed="false" aria-label="즐겨찾기 추가" hidden>
            <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
              <path stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"
                    d="M12 21s-7.5-4.5-9.5-9.5C1 7.5 4 4.5 7.5 4.5c2 0 3.6 1 4.5 2.5.9-1.5 2.5-2.5 4.5-2.5 3.5 0 6.5 3 5 7-2 5-9.5 9.5-9.5 9.5z"/>
            </svg>
          </button>
          <button type="button" class="mh-sheet-lb-share" aria-label="공유" hidden>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>
            </svg>
          </button>
          <a class="mh-sheet-lb-link mh-sheet-lb-filmlink">필름 보기 →</a>
          <a class="mh-sheet-lb-link mh-sheet-lb-contributor" hidden>촬영자 보기 →</a>
        </div>
      </div>
    `;
    document.body.appendChild(lb);

    const img = lb.querySelector('img');
    const authorEl = lb.querySelector('.mh-sheet-lb-author');
    const counterEl = lb.querySelector('.mh-sheet-lb-counter');
    const filmEl = lb.querySelector('.mh-sheet-lb-film');
    const cameraEl = lb.querySelector('.mh-sheet-lb-camera');
    const noteEl = lb.querySelector('.mh-sheet-lb-note');
    const favBtn = lb.querySelector('.mh-sheet-lb-fav');
    const shareBtn = lb.querySelector('.mh-sheet-lb-share');
    const filmLinkEl = lb.querySelector('.mh-sheet-lb-filmlink');
    const contribLinkEl = lb.querySelector('.mh-sheet-lb-contributor');

    if (typeof navigator.share === 'function') shareBtn.hidden = false;

    async function ensureFavIds() {
      if (favLoaded) return;
      favLoaded = true;
      try {
        if (window.MagDB?.isReady?.() && window.MagDB.favorites?.idsForType) {
          const sess = await window.MagDB.auth.getSession();
          if (sess) favIds = await window.MagDB.favorites.idsForType('submission');
        }
      } catch (_) {}
    }

    function render() {
      const r = rows[cur];
      img.src = r.image;
      authorEl.textContent = r.author || '';

      const filmName = r.film || (f && (f.displayName || f.name)) || '';
      const filmSlug = (f?.slug || f?.id) || filmSlugByName(filmName);
      filmEl.textContent = filmName;
      filmEl.hidden = !filmName;
      filmEl.href = filmSlug ? `/films.html?film=${encodeURIComponent(filmSlug)}` : '/films.html';

      cameraEl.textContent = r.camera || '';
      cameraEl.hidden = !r.camera;
      cameraEl.href = r.camera ? `/films.html?camera=${encodeURIComponent(r.camera)}` : '/films.html';

      const note = (r.caption || '').trim();
      noteEl.textContent = note;
      noteEl.hidden = !note;

      counterEl.textContent = `${cur + 1} / ${rows.length}`;
      // 스크린리더에 변화 알림
      try { window.srAnnounce?.(`사진 ${cur + 1}, 총 ${rows.length}장. ${r.author || ''}${r.film ? ', ' + r.film : ''}`.trim()); } catch (_) {}
      lb.querySelector('.mh-sheet-lb-prev').disabled = cur === 0;
      lb.querySelector('.mh-sheet-lb-next').disabled = cur === rows.length - 1;

      filmLinkEl.href = filmSlug ? `/films.html?film=${encodeURIComponent(filmSlug)}` : '/films.html';

      const contribKey = contributorKeyOf(r);
      if (contribKey) {
        const params = new URLSearchParams({ contributor: contribKey });
        if (filmSlug) params.set('film', filmSlug);
        contribLinkEl.href = `/films.html?${params.toString()}`;
        contribLinkEl.hidden = false;
      } else {
        contribLinkEl.hidden = true;
      }

      // 즐겨찾기 — 로그인 + submission id 있을 때만
      const subId = submissionIdOf(r);
      if (!subId) {
        favBtn.hidden = true;
      } else {
        favBtn.hidden = false;
        favBtn.dataset.submissionId = subId;
        const isFav = favIds.has(subId);
        favBtn.classList.toggle('is-fav', isFav);
        favBtn.setAttribute('aria-pressed', String(isFav));
        favBtn.setAttribute('aria-label', isFav ? '즐겨찾기 해제' : '즐겨찾기 추가');
      }
    }

    async function toggleFav() {
      if (favBtn.hidden || favBtn.classList.contains('is-busy')) return;
      const subId = favBtn.dataset.submissionId || '';
      if (!subId) return;
      if (!window.MagDB?.isReady?.()) { window.notify?.('잠시 후 다시 시도해주세요.', 'info'); return; }
      const sess = await window.MagDB.auth.getSession();
      if (!sess) {
        if (!confirm('즐겨찾기는 로그인이 필요해요. Google로 로그인할까요?')) return;
        window.MagDB.auth.signInWithGoogle(window.location.href.split('#')[0]);
        return;
      }
      const wasFav = favIds.has(subId);
      if (wasFav) favIds.delete(subId); else favIds.add(subId);
      favBtn.classList.toggle('is-fav', !wasFav);
      favBtn.setAttribute('aria-pressed', String(!wasFav));
      favBtn.classList.add('is-busy');
      const { error } = await window.MagDB.favorites.toggle('submission', subId, wasFav);
      favBtn.classList.remove('is-busy');
      if (error) {
        if (wasFav) favIds.add(subId); else favIds.delete(subId);
        favBtn.classList.toggle('is-fav', wasFav);
        favBtn.setAttribute('aria-pressed', String(wasFav));
        window.notify?.('처리 실패: ' + (error.message || '잠시 후 다시 시도'), 'danger');
      }
    }

    async function shareCurrent() {
      const r = rows[cur];
      const filmName = r.film || (f && (f.displayName || f.name)) || '5ft magazine';
      const filmSlug = (f?.slug || f?.id) || filmSlugByName(filmName);
      const url = filmSlug
        ? `https://5ftmag.com/films.html?film=${encodeURIComponent(filmSlug)}`
        : 'https://5ftmag.com/';
      const shareUrl = (typeof window.prettyShareUrl === 'function') ? window.prettyShareUrl(url) : url;
      try { window.trackEvent?.('share_clicked', { kind: 'sheet_lightbox' }); } catch (_) {}
      try { await navigator.share({ title: filmName, url: shareUrl }); } catch (_) {}
    }

    favBtn.addEventListener('click', toggleFav);
    shareBtn.addEventListener('click', shareCurrent);

    // 즐겨찾기 ID 로딩 후 한번 더 render (initial 은 favIds 비어있는 상태)
    ensureFavIds().then(render);
    render();
    requestAnimationFrame(() => lb.classList.add('is-open'));

    // focus trap — Tab 키가 라이트박스 밖으로 안 나가게
    const releaseTrap = window.createFocusTrap?.(lb) || (() => {});

    const close = () => {
      lb.classList.remove('is-open');
      setTimeout(() => lb.remove(), 180);
      window.removeEventListener('keydown', onKey);
      releaseTrap();
    };
    const prev = () => { if (cur > 0) { cur -= 1; render(); } };
    const next = () => { if (cur < rows.length - 1) { cur += 1; render(); } };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    lb.querySelector('.mh-sheet-lb-close').addEventListener('click', close);
    lb.querySelector('.mh-sheet-lb-prev').addEventListener('click', prev);
    lb.querySelector('.mh-sheet-lb-next').addEventListener('click', next);
    // 사진 영역 또는 배경 탭으로 닫기 (라이트박스 기본 직관). 정보 카드(.mh-sheet-lb-info)
    // 안 탭은 닫지 않음 — 좋아요/공유/링크 등 인터랙션이 있어서.
    lb.addEventListener('click', (e) => {
      if (e.target.closest('.mh-sheet-lb-info')) return;
      if (e.target.closest('.mh-sheet-lb-close, .mh-sheet-lb-nav')) return;
      close();
    });

    // 스와이프 좌/우
    let touchStartX = 0;
    const stage = lb.querySelector('.mh-sheet-lb-stage');
    stage.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      const dx = (e.changedTouches[0]?.clientX || 0) - touchStartX;
      if (Math.abs(dx) < 40) return;
      if (dx > 0) prev(); else next();
    }, { passive: true });
  }

  // 첫 방문 온보딩 — FAB 옆에 짧은 안내 풍선, 한 번 보고 닫으면 다시 안 뜸
  // 스크롤 다운 시 검색바·필터 축소
  function bindStickyShrink() {
    let lastY = 0; let raf = null;
    const onScroll = () => {
      raf = null;
      const y = window.scrollY || 0;
      const goingDown = y > lastY && y > 60;
      root.classList.toggle('is-condensed', goingDown);
      lastY = y;
    };
    window.addEventListener('scroll', () => {
      if (raf == null) raf = requestAnimationFrame(onScroll);
    }, { passive: true });
  }

  function maybeShowOnboarding() {
    const KEY = '5ft-mh-onboarded';
    try { if (localStorage.getItem(KEY) === '1') return; } catch {}
    setTimeout(() => {
      const tip = document.createElement('div');
      tip.className = 'mh-onboard';
      tip.innerHTML = `
        <span>여기서 사진을 올려요</span>
        <button type="button" aria-label="닫기">✕</button>
      `;
      tip.querySelector('button').addEventListener('click', () => {
        try { localStorage.setItem(KEY, '1'); } catch {}
        tip.classList.add('is-leaving');
        setTimeout(() => tip.remove(), 200);
      });
      document.body.appendChild(tip);
      // 8초 후 자동 닫힘
      setTimeout(() => {
        if (tip.parentNode) {
          try { localStorage.setItem(KEY, '1'); } catch {}
          tip.classList.add('is-leaving');
          setTimeout(() => tip.remove(), 200);
        }
      }, 8000);
    }, 1500);
  }

  // ── iOS 사용자에게 "홈 화면에 추가" 안내 (한 번만) ──
  function maybeShowIosPwaPrompt() {
    const KEY = '5ft-pwa-ios-prompted';
    try { if (localStorage.getItem(KEY) === '1') return; } catch {}
    const ua = navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (!isIos || isStandalone) return;
    const toast = document.createElement('div');
    toast.className = 'mh-pwa-toast';
    toast.innerHTML = `
      <span>홈 화면에 추가하면 앱처럼 쓸 수 있어요. 공유 ↗ → "홈 화면에 추가"</span>
      <button type="button" aria-label="닫기">알겠어요</button>
    `;
    toast.querySelector('button').addEventListener('click', () => {
      try { localStorage.setItem(KEY, '1'); } catch {}
      toast.remove();
    });
    document.body.appendChild(toast);
  }

  // ─── "사진으로 보기" 모드 ───
  // 전체 독자 사진 최근순 그리드. 카테고리 필터 + 검색은 그대로 적용
  // (검색은 사진의 film 이름으로 매칭).
  let _photoCache = null;
  async function loadPhotoGrid() {
    const grid = root.querySelector('#mhPhotoGrid');
    if (!grid) return;
    // MagDB 준비 대기
    let api = null;
    for (let i = 0; i < 50; i++) {
      if (window.MagDB?.isReady?.() && window.MagDB.submissions?.listApproved) {
        api = window.MagDB.submissions; break;
      }
      await new Promise(r => setTimeout(r, 80));
    }
    if (!api) { grid.innerHTML = '<div class="mh-empty"><p>사진을 불러오지 못했어요.</p></div>'; return; }
    if (!_photoCache) {
      try { _photoCache = await api.listApproved(180); }
      catch { _photoCache = []; }
    }
    renderPhotoGrid(_photoCache, grid);
  }

  // 사진을 STATE.films 의 카테고리 분류와 매칭 (브랜드/이름 정규화 후 동일성 체크)
  function photoMatchesCategory(row, category) {
    if (category === 'all') return true;
    const filmName = String(row.film || '').toLowerCase().trim();
    if (!filmName) return false;
    const f = STATE.films.find(x =>
      [x.name, x.displayName, ...(Array.isArray(x.aliases) ? x.aliases : [])]
        .filter(Boolean).map(n => String(n).toLowerCase().trim()).includes(filmName)
    );
    if (!f) return false;
    const t = String(f.type || '').toLowerCase();
    if (category === 'color') return t.includes('color');
    if (category === 'bw') return t.includes('black') || t.includes('bw') || t.includes('mono');
    if (category === 'slide') return t.includes('slide') || t.includes('e-6') || t.includes('reversal');
    if (category === 'cinema') return t.includes('tungsten') || t.includes('daylight') || t.includes('cinema');
    return true;
  }
  function photoMatchesQuery(row, q) {
    if (!q) return true;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return String(row.film || '').toLowerCase().includes(needle);
  }
  function renderPhotoGrid(rows, grid) {
    const filtered = rows.filter(r => photoMatchesCategory(r, STATE.category) && photoMatchesQuery(r, STATE.query));
    grid.removeAttribute('aria-busy');
    if (!filtered.length) {
      grid.outerHTML = '<div class="mh-empty"><p>조건에 맞는 사진이 없어요.</p></div>';
      return;
    }
    grid.innerHTML = filtered.map((r, i) => `
      <button type="button" class="mh-photo-cell" data-photo-index="${i}" aria-label="${esc(r.film || '사진')} ${i + 1} 크게 보기">
        <img src="${esc(r.image)}" alt="" loading="lazy" />
      </button>
    `).join('');
    grid.addEventListener('click', (e) => {
      const cell = e.target.closest('[data-photo-index]');
      if (!cell) return;
      try { window.trackEvent?.('lightbox_opened', { from: 'photos_view' }); } catch (_) {}
      openSheetLightbox(filtered, Number(cell.dataset.photoIndex), null);
    });
  }

  // ── 부팅 ──
  (async function start() {
    bindControls();
    bindStickyShrink();
    const [stories, films] = await Promise.all([
      fetchJson('/data/stories.json'),
      fetchJson('/data/films.json'),
    ]);
    STATE.stories = Array.isArray(stories) ? stories : [];
    const filmsObj = films && typeof films === 'object' ? films : {};
    STATE.films = Array.isArray(filmsObj) ? filmsObj : Object.entries(filmsObj).map(([slug, f]) => ({ slug, ...f }));
    render();
    maybeShowOnboarding();
    setTimeout(maybeShowIosPwaPrompt, 1500);
  })();
})();
