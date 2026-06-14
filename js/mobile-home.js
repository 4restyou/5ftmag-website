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
      <a class="mh-card" href="/films.html?film=${encodeURIComponent(slug)}">
        <div class="mh-card-thumb">${filmThumb(f) ? `<img src="${esc(filmThumb(f))}" alt="" loading="lazy" />` : ''}</div>
        <div class="mh-card-name">${esc(name)}</div>
      </a>
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

    return bigRows.join('') + othersHtml;
  }

  // escAttr 도우미
  function escAttr(s) { return esc(s); }

  // ── 본체 렌더 ──
  const STATE = { films: [], stories: [], query: '', category: 'all' };

  function render() {
    const newHtml = renderNewStories(STATE.stories);
    const libraryHtml = renderLibrary(STATE.films, STATE.query, STATE.category);
    root.querySelector('#mhBody').innerHTML = newHtml + libraryHtml;
  }

  function bindControls() {
    const search = root.querySelector('#mhSearch');
    const chips = root.querySelectorAll('.mh-chip');
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
