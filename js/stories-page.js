  // 테마/메뉴는 js/site-common.js 에서 처리됨

  // ════════════════════════════
  // Stories: JSON 로딩 + 카드 자동 생성
  // ════════════════════════════
  const grid = document.getElementById('articlesGrid');
  const paginationBars = document.querySelectorAll('[data-pagination]');
  const pageSize = 12;
  // URL ?page=N 으로 진입한 경우 해당 페이지로 시작
  const _urlPage = parseInt(new URLSearchParams(location.search).get('page'), 10);
  let currentPage = (Number.isFinite(_urlPage) && _urlPage > 0) ? _urlPage : 1;
  let allStories = []; // 전체 글 데이터 캐시
  // 본인이 스크랩한 글 id 집합 — DB 준비 후 비동기 로드
  let articleFavIds = new Set();

  // XSS 가드: 동적 삽입 escape
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
      {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
    ));
  }
  const escapeAttr = escapeHtml;

  function thumbnailPicture(src, alt, loading = 'lazy') {
    const cleanSrc = String(src || '');
    const webpSrc = /\.(jpe?g|png)$/i.test(cleanSrc)
      ? cleanSrc.replace(/\.(jpe?g|png)$/i, '.webp')
      : '';
    const img = `<img src="${escapeAttr(cleanSrc)}" loading="${escapeAttr(loading)}" alt="${escapeAttr(alt)}" />`;
    if (!webpSrc) return img;
    return `<picture><source srcset="${escapeAttr(webpSrc)}" type="image/webp">${img}</picture>`;
  }

  // 날짜 포맷팅 (2024-11-15 → 2024.11.15)
  function formatDate(dateStr) {
    return dateStr.replace(/-/g, '.');
  }

  // 카테고리 라벨 생성 (PHOTO · 박순렬 형태)
  function categoryLabel(story) {
    const label = story.categoryLabel || story.category.toUpperCase();
    return story.author ? `${label} · ${story.author}` : label;
  }

  function storyFilterKey(story) {
    const label = String(story.categoryLabel || '').toUpperCase();
    const category = String(story.category || '').toLowerCase();
    if (label.includes('PHOTOBOOK') || label === 'PHOTO') return 'photo';
    if (label.includes('FILM')) return 'film';
    if (label.includes('CAMERA')) return 'camera';
    if (label === 'ESSAY') return 'essay';
    if (label === 'INTERVIEW') return 'interview';
    if (label === 'GOODS') return 'goods';
    if (label === 'EXHIBITION') return 'exhibition';
    if (label === 'FEEL:TOON' || label === 'ILLUSTRATION') return 'illustration';
    if (label === 'EDITORIAL' || label === 'FEATURE') return 'editorial';
    return category || 'editorial';
  }

  // 카드 HTML 생성
  function renderCard(story) {
    const link = story.page || '#';
    // Vol.XX가 있으면 매거진 호 배지, 없으면 카테고리 라벨로 자동 폴백
    const badgeLabel = story.issue || story.categoryLabel || (story.category || '').toUpperCase();
    const issueBadge = badgeLabel ? `<span class="article-badge">${escapeHtml(badgeLabel)}</span>` : '';
    const isFav = articleFavIds.has(story.id);
    const favHtml = `
      <span class="article-card-fav${isFav ? ' is-fav' : ''}" role="button" tabindex="0"
            data-action="toggle-article-fav" data-article-id="${escapeAttr(story.id)}"
            aria-pressed="${isFav}" aria-label="${isFav ? '스크랩 해제' : '스크랩'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4-6 4Z"/>
        </svg>
      </span>`;

    // 썸네일 없으면 타이포그래피 카드로
    // thumbnailWhiteBg: true 면 카드에 흰 배경 보더 추가
    const whiteBgCls = story.thumbnailWhiteBg ? ' is-on-white' : '';
    const imgBlock = story.thumbnail
      ? `<div class="article-img${whiteBgCls}">
           ${thumbnailPicture(story.thumbnail, story.title, 'eager')}
           ${issueBadge}
         </div>`
      : `<div class="article-img text-only">
           <span class="text-card-title">${escapeHtml(story.title)}</span>
           <span class="text-card-mark">${escapeHtml((story.categoryLabel || story.category).toUpperCase())}</span>
           ${issueBadge}
         </div>`;

    return `
      <a href="${escapeAttr(link)}" class="article-card" data-reveal data-category="${escapeAttr(storyFilterKey(story))}" data-issue="${escapeAttr(story.issue || '')}">
        ${imgBlock}
        ${favHtml}
        <span class="article-category">${escapeHtml(categoryLabel(story))}</span>
        <h2 class="article-title">${escapeHtml(story.title)}</h2>
        <p class="article-excerpt">${escapeHtml(story.excerpt)}</p>
        <span class="article-meta">${escapeHtml(formatDate(story.date))}</span>
      </a>
    `;
  }

  // 페이지네이션 렌더링
  function renderPagination(totalItems) {
    const totalPages = Math.ceil(totalItems / pageSize);
    paginationBars.forEach(bar => {
      if (totalPages <= 1) {
        bar.classList.add('is-hidden');
        bar.innerHTML = '';
        return;
      }

      bar.classList.remove('is-hidden');
      const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
        .map(page => page === currentPage
          ? `<span class="cur">${page}</span>`
          : `<button type="button" data-page="${page}">${page}</button>`
        ).join('');

      bar.innerHTML = `
        <button type="button" class="nav-arrow ${currentPage === 1 ? 'disabled' : ''}" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>← 이전</button>
        <div class="page-numbers">${pages}</div>
        <button type="button" class="nav-arrow ${currentPage === totalPages ? 'disabled' : ''}" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>다음 →</button>
      `;
    });
  }

  // 카드 그리드 렌더링
  function renderGrid(stories) {
    if (stories.length === 0) {
      const hasFilter = currentSearchQuery || currentCategory !== 'all' || currentMonth !== 'all';
      grid.innerHTML = `<div class="no-results">
        일치하는 글이 없습니다. 제목, 카테고리, 작가명을 줄여서 다시 검색해 보세요.
        ${hasFilter ? '<button type="button" class="no-results-reset" id="noResultsReset">전체 글 보기</button>' : ''}
      </div>`;
      document.getElementById('noResultsReset')?.addEventListener('click', resetFilters);
      renderPagination(0);
      return;
    }

    const totalPages = Math.ceil(stories.length / pageSize);
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * pageSize;
    grid.innerHTML = stories.slice(start, start + pageSize).map(renderCard).join('');
    renderPagination(stories.length);
  }

  // 현재 필터/검색 상태
  const _urlParams = new URLSearchParams(location.search);
  let currentCategory = _urlParams.get('cat') || 'all';
  let currentSearchQuery = (_urlParams.get('q') || '').trim();
  let currentMonth = _urlParams.get('m') || 'all'; // 'all' | 'YYYY-MM'

  // 글 날짜에서 월 목록(YYYY-MM)을 뽑아 최신순으로 select 채우기
  function populateMonths() {
    const sel = document.getElementById('monthFilter');
    if (!sel) return;
    const months = [...new Set(
      allStories.map(s => String(s.date || '').slice(0, 7)).filter(m => /^\d{4}-\d{2}$/.test(m))
    )].sort((a, b) => b.localeCompare(a));
    sel.innerHTML = ['<option value="all">전체 기간</option>']
      .concat(months.map(m => {
        const [y, mo] = m.split('-');
        return `<option value="${m}">${y}년 ${Number(mo)}월</option>`;
      })).join('');
    sel.value = currentMonth;
  }

  // 현재 상태(cat·q·page) 를 URL 에 반영 — 공유·새로고침·뒤로가기 복구용.
  // 연속 입력에 history 가 쌓이지 않게 replaceState.
  function syncUrl() {
    const params = new URLSearchParams();
    if (currentCategory && currentCategory !== 'all') params.set('cat', currentCategory);
    if (currentMonth && currentMonth !== 'all') params.set('m', currentMonth);
    if (currentSearchQuery) params.set('q', currentSearchQuery);
    if (currentPage > 1) params.set('page', String(currentPage));
    const qs = params.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }

  // 통합 필터링 (카테고리 + 검색)
  function applyFilters() {
    let result = currentCategory === 'all'
      ? allStories
      : allStories.filter(s => storyFilterKey(s) === currentCategory);

    // 월 필터
    if (currentMonth !== 'all') {
      result = result.filter(s => String(s.date || '').slice(0, 7) === currentMonth);
    }

    // 검색어가 있으면 추가 필터
    if (currentSearchQuery) {
      const q = currentSearchQuery.toLowerCase();
      result = result.filter(s => {
        const haystack = [
          s.title || '',
          s.excerpt || '',
          s.author || '',
          s.categoryLabel || '',
          s.category || '',
          s.issue || ''
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }

    // 결과 카운트 표시 (textContent 사용 — XSS 안전)
    const countEl = document.getElementById('searchResultsCount');
    if (currentSearchQuery) {
      countEl.textContent = `"${currentSearchQuery}" 검색 결과: ${result.length}개`;
    } else {
      countEl.textContent = '';
    }

    renderGrid(result);
    syncUrl();
  }

  // 빈 결과에서 "전체 글 보기" — 카테고리·검색 초기화
  function resetFilters() {
    currentCategory = 'all';
    currentSearchQuery = '';
    currentMonth = 'all';
    currentPage = 1;
    const si = document.getElementById('searchInput');
    if (si) si.value = '';
    const mf = document.getElementById('monthFilter');
    if (mf) mf.value = 'all';
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c.dataset.category === 'all'));
    applyFilters();
  }

  // JSON 로딩
  fetch('data/stories.json')
    .then(res => {
      if (!res.ok) throw new Error('데이터를 불러올 수 없습니다.');
      return res.json();
    })
    .then(data => {
      // 발행된 글만, 최신순 정렬
      allStories = data
        .filter(s => s.published !== false)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      populateMonths();
      applyFilters();
      // 스크랩 상태는 DB 준비 후 비동기로 — 카드 렌더 막지 않음
      (async () => {
        for (let i = 0; i < 60; i++) {
          if (window.MagDB && window.MagDB.isReady()) break;
          await new Promise(r => setTimeout(r, 50));
        }
        try {
          const sess = await window.MagDB?.auth?.getSession?.();
          if (sess) articleFavIds = await window.MagDB.favorites.idsForType('article');
        } catch (_) {}
        syncCardFavMarks();
      })();
    })
    .catch(err => {
      console.error(err);
      grid.innerHTML = '<div class="empty-state">글 목록을 불러오지 못했습니다.<br /><small style="opacity:.6">네트워크 상태를 확인한 뒤 새로고침해 주세요. 로컬 파일을 직접 열었다면 <code>http://localhost</code> 환경에서 확인해야 합니다.</small></div>';
    });

  function syncCardFavMarks() {
    document.querySelectorAll('.article-card-fav').forEach(el => {
      const id = el.dataset.articleId;
      const on = articleFavIds.has(id);
      el.classList.toggle('is-fav', on);
      el.setAttribute('aria-pressed', String(on));
      el.setAttribute('aria-label', on ? '스크랩 해제' : '스크랩');
    });
  }

  // 카드 ♡ 클릭 위임 — 카드는 <a> 라 클릭 시 페이지 이동, ♡ 만 이동 막고 토글
  grid.addEventListener('click', async (e) => {
    const fav = e.target.closest('.article-card-fav');
    if (!fav) return;
    e.preventDefault();
    e.stopPropagation();
    if (fav.classList.contains('is-busy')) return;
    const id = fav.dataset.articleId;
    if (!id) return;
    if (!window.MagDB || !window.MagDB.isReady()) {
      window.notify?.('잠시 후 다시 시도해주세요.', 'info');
      return;
    }
    const sess = await window.MagDB.auth.getSession();
    if (!sess) {
      if (!confirm('스크랩은 로그인이 필요해요. Google로 로그인할까요?')) return;
      window.MagDB.auth.signInWithGoogle(window.location.href.split('#')[0]);
      return;
    }
    const wasFav = articleFavIds.has(id);
    if (wasFav) articleFavIds.delete(id); else articleFavIds.add(id);
    fav.classList.add('is-busy');
    syncCardFavMarks();
    const { error } = await window.MagDB.favorites.toggle('article', id, wasFav);
    fav.classList.remove('is-busy');
    if (error) {
      if (wasFav) articleFavIds.add(id); else articleFavIds.delete(id);
      syncCardFavMarks();
      window.notify?.('처리 실패: ' + (error.message || '잠시 후 다시 시도'), 'danger');
    }
  });

  paginationBars.forEach(bar => {
    bar.addEventListener('click', (event) => {
      const pageButton = event.target.closest('[data-page]');
      if (!pageButton || pageButton.disabled) return;
      currentPage = Number(pageButton.dataset.page);
      applyFilters();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // 카테고리 필터 칩 클릭
  const chips = document.querySelectorAll('.filter-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentCategory = chip.dataset.category;
      currentPage = 1;
      applyFilters();
    });
  });
  // URL 의 cat 으로 칩 active 초기 동기화
  chips.forEach(c => c.classList.toggle('active', c.dataset.category === currentCategory));

  // 월별 보기 select
  const monthFilter = document.getElementById('monthFilter');
  if (monthFilter) {
    monthFilter.addEventListener('change', () => {
      currentMonth = monthFilter.value;
      currentPage = 1;
      applyFilters();
    });
  }

  // 검색 입력 (디바운스)
  const searchInput = document.getElementById('searchInput');
  if (currentSearchQuery) searchInput.value = currentSearchQuery;
  const searchClear = document.getElementById('searchClear');
  let searchTimer = null;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentSearchQuery = e.target.value.trim();
      currentPage = 1;
      applyFilters();
    }, 200);
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    currentSearchQuery = '';
    currentPage = 1;
    applyFilters();
    searchInput.focus();
  });
  // ESC로 검색어 지우기
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchInput.value) {
      e.preventDefault();
      searchInput.value = '';
      currentSearchQuery = '';
      applyFilters();
    }
  });
