  // 테마/메뉴는 js/site-common.js 에서 처리됨

  // ════════════════════════════
  // 필름 데이터: data/films.json에서 로딩 + 그리드 렌더링
  // ════════════════════════════
  let filmsData = {};
  const ROLL_LIMIT = 36;
  const PHOTOS_PAGE_SIZE = 60; // 사진 스타일별 보기에서 한 번에 노출되는 사진 수

  const filmsGridFeatured = document.getElementById('filmsGridFeatured');
  const filmsGridLibrary  = document.getElementById('filmsGridLibrary');

  // 사진 스타일별 보기 (라이브러리 전환) DOM
  const libraryFilmsView   = document.getElementById('libraryFilmsView');
  const libraryPhotosView  = document.getElementById('libraryPhotosView');
  const libraryPhotosGrid  = document.getElementById('libraryPhotosGrid');
  const libraryPhotosCount = document.getElementById('libraryPhotosCount');
  const libraryPhotosMoreWrap = document.getElementById('libraryPhotosMoreWrap');
  const libraryPhotosMoreBtn  = document.getElementById('libraryPhotosMoreBtn');
  const libraryPhotosShuffleBtn = document.getElementById('libraryPhotosShuffle');
  const libraryViewToggleEl = document.querySelector('.library-view-toggle');
  const libraryPhotosSearchEl = document.getElementById('libraryPhotosSearch');
  const libraryPhotosChipsEl  = document.getElementById('libraryPhotosChips');

  // 사진 스타일별 보기 상태
  let libraryView = 'films';           // 'films' | 'photos'
  let photosPool = [];                 // 원본 풀 (검색·필터 전체)
  let photosShuffled = [];             // 현재 보이는 (필터된) 셔플 결과
  let photosVisible = 0;               // 현재 렌더된 갯수
  let photosQuery = '';                // 검색어 (normalized)
  let photosCategory = 'all';          // 전체 / color / bw / slide / cinema

  const {
    escapeAttr,
    escapeHtml,
    normalizeFilmLabel,
    normalizeContributorKey,
    filterCategoryOf,
    isMobileFilms,
    contributorKeyOfSubmission,
    contributorLabelOfSubmission,
    toLightboxReaderPhoto,
  } = window.FilmsUtils;
  const resolveFilmKey = (input) => window.FilmsUtils.resolveFilmKey(input, filmsData);
  const { renderFilmCard } = window.FilmsCards;
  const {
    routeParam,
    filmsBasePath,
    prettyFilmPath,
    prettyCameraPath,
    prettyContributorPath,
    shareFilm: shareFilmLink,
    shareCamera: shareCameraLink,
  } = window.FilmsShare;
  const readerRollUi = window.FilmsReaderRollUI;
  const readerRollData = window.FilmsReaderRollData;
  const libraryFilters = window.FilmsLibraryFilters.create({
    filmsGridLibrary,
    escapeAttr,
    escapeHtml,
    filterCategoryOf,
    isMobileFilms,
  });
  const cameraIndex = libraryFilters.cameraIndex;
  const currentCameras = libraryFilters.currentCameras;
  const normalizeLibrarySearch = libraryFilters.normalizeSearch;
  const readerSearchTokensForSubmission = libraryFilters.readerSearchTokensForSubmission;
  const applyLibraryFilter = () => libraryFilters.apply();
  const applyCameraOverrides = () => libraryFilters.applyCameraOverrides();
  const rebuildCameraIndex = (submissions, filmsBySlug) => libraryFilters.rebuildCameraIndex(submissions, filmsBySlug);
  const renderLibraryBrandSelect = (libraryFilms) => libraryFilters.renderBrandSelect(libraryFilms);
  const renderLibraryCameraSelect = () => libraryFilters.renderCameraSelect();
  const renderLibraryFilterChips = (libraryFilms) => libraryFilters.renderFilterChips(libraryFilms);
  const resolveCanonicalCameraKey = (key) => libraryFilters.resolveCanonicalCameraKey(key);
  const sortLibrary = (entries) => libraryFilters.sortLibrary(entries, filmFavSlugs);

  const readerExport = window.FilmsReaderExport.create({
    getFilm: (filmKey) => filmsData[filmKey] || {},
    findFilmThumbByName,
    notify: window.notify,
  });

  let approvedSubmissionsCache = null;
  let approvedSubmissionsPromise = null;
  // 본인이 즐겨찾기한 필름 slug / 사진 ID / 작가 키 집합 — 페이지 로드 후 한 번 fetch
  let filmFavSlugs = new Set();
  let photoFavIds  = new Set();
  let contributorFavKeys = new Set();
  let currentFilmKey = null;
  let currentCameraKey = null;
  // 라이브러리 카드의 "원본" 정렬 순서 (좋아요 해제 시 복귀용)
  // 데스크탑·모바일 모두 sortLibrary 알파벳(브랜드→이름 가나다·ABC) 순
  let libraryOriginalOrder = [];

  function renderFilmsGrid() {
    const entries = Object.entries(filmsData);
    const featured = entries.filter(([, f]) => f.tier === 'featured');
    // 5ft Issue 섹션: editorial 강조 (사진 보기, 36 photos)
    // Library 섹션: 구독자 카탈로그 — featured 필름도 포함되어 알파벳 정렬
    //  단, Library 컨텍스트로 렌더되므로 같은 필름이라도 "0 / 36 · 자리 채우기" 표현
    // 데스크탑·모바일 모두 브랜드(가나다·ABC) → 이름(가나다·ABC) 알파벳 순 통일.
    const libraryAll = sortLibrary(entries);
    // 좋아요 해제 시 카드를 이 자리로 돌려보내기 위해 원본 순서 저장
    libraryOriginalOrder = libraryAll.map(([slug]) => slug);

    const cardOptions = { filmFavSlugs, rollLimit: ROLL_LIMIT };
    filmsGridFeatured.innerHTML = featured.map(([slug, f]) => renderFilmCard(slug, f, 'featured-grid', cardOptions)).join('');
    filmsGridLibrary.innerHTML  = libraryAll.map(([slug, f]) => renderFilmCard(slug, f, 'library-grid', cardOptions)).join('');

    renderLibraryFilterChips(libraryAll);
    renderLibraryBrandSelect(libraryAll);
    applyLibraryFilter();

    // 새로 렌더된 카드들에 클릭 핸들러 연결
    // CTA(.film-cta-action) 클릭은 reader-submissions.js 글로벌 위임이 처리하므로 모달 안 띄움
    // ♡ 즐겨찾기 토글 클릭은 toggleFilmFav 가 별도 처리 — 카드 모달 안 열림
    document.querySelectorAll('.film-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const fav = e.target.closest('.film-fav');
        if (fav) {
          e.preventDefault();
          e.stopPropagation();
          toggleFilmFav(fav);
          return;
        }
        if (e.target.closest('.film-cta-action')) return;
        openModal(card.dataset.film, { source: card.closest('#filmsGridLibrary') ? 'library' : 'issue' });
      });
    });
  }

  // 좋아요 토글 시 라이브러리 카드를 fav-우선으로 재배치 + FLIP 애니메이션.
  // libraryOriginalOrder(데스크탑 알파벳 / 모바일 첫 렌더 셔플) 를 기준으로 fav 만 앞으로
  // 끌어올리고, fav 해제 시에는 원래 자리로 복귀.
  function resortLibraryFavFirst() {
    if (!filmsGridLibrary || libraryOriginalOrder.length === 0) return;
    const cards = Array.from(filmsGridLibrary.children);
    if (cards.length === 0) return;

    // FIRST: 이동 전 위치 기록
    const firstRects = new Map();
    cards.forEach(c => firstRects.set(c, c.getBoundingClientRect()));

    // 원본 순서를 fav 우선으로 재정렬
    const order = libraryOriginalOrder.slice().sort((a, b) => {
      const fa = filmFavSlugs.has(a) ? 0 : 1;
      const fb = filmFavSlugs.has(b) ? 0 : 1;
      return fa - fb;
    });
    const map = new Map(cards.map(c => [c.dataset.film, c]));
    const frag = document.createDocumentFragment();
    order.forEach(slug => {
      const el = map.get(slug);
      if (el) frag.appendChild(el);
    });
    filmsGridLibrary.appendChild(frag);

    // LAST + INVERT + PLAY: 이동한 카드만 transform 으로 보정 → transition 해제
    cards.forEach(c => {
      const first = firstRects.get(c);
      const last = c.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      c.style.transition = 'none';
      c.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        c.style.transition = 'transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1)';
        c.style.transform = '';
      });
      const cleanup = () => {
        c.style.transition = '';
        c.style.transform = '';
        c.removeEventListener('transitionend', cleanup);
      };
      c.addEventListener('transitionend', cleanup);
    });
  }

  // ════════════════════════════
  // 즐겨찾기 — 필름
  // ════════════════════════════
  async function loadFilmFavorites() {
    if (!window.MagDB || !window.MagDB.isReady()) return;
    try {
      const sess = await window.MagDB.auth.getSession();
      if (!sess) { filmFavSlugs = new Set(); return; }
      filmFavSlugs = await window.MagDB.favorites.idsForType('film');
    } catch (_) {
      filmFavSlugs = new Set();
    }
  }
  function syncFilmFavMarks() {
    document.querySelectorAll('.film-fav').forEach(el => {
      const slug = el.dataset.filmSlug;
      const on   = filmFavSlugs.has(slug);
      el.classList.toggle('is-fav', on);
      el.setAttribute('aria-pressed', String(on));
      el.setAttribute('aria-label', on ? '즐겨찾기 해제' : '즐겨찾기 추가');
    });
  }
  async function toggleFilmFav(el) {
    if (el.classList.contains('is-busy')) return;
    const slug = el.dataset.filmSlug;
    if (!slug) return;
    if (!window.MagDB || !window.MagDB.isReady()) {
      window.notify?.('잠시 후 다시 시도해주세요.', 'info');
      return;
    }
    const sess = await window.MagDB.auth.getSession();
    if (!sess) {
      if (!confirm('즐겨찾기는 로그인이 필요해요. Google로 로그인할까요?')) return;
      window.MagDB.auth.signInWithGoogle(window.location.href.split('#')[0]);
      return;
    }
    const wasFav = filmFavSlugs.has(slug);
    // optimistic update
    if (wasFav) filmFavSlugs.delete(slug); else filmFavSlugs.add(slug);
    el.classList.add('is-busy');
    syncFilmFavMarks();
    resortLibraryFavFirst();
    const { error } = await window.MagDB.favorites.toggle('film', slug, wasFav);
    el.classList.remove('is-busy');
    if (error) {
      // 롤백
      if (wasFav) filmFavSlugs.add(slug); else filmFavSlugs.delete(slug);
      syncFilmFavMarks();
      resortLibraryFavFirst();
      window.notify?.('처리 실패: ' + (error.message || '잠시 후 다시 시도'), 'danger');
    }
  }

  // 필름 카탈로그 — DB 우선, 정적 data/films.json fallback 및 보강.
  (async () => {
    try {
      const catalog = await window.FilmsCatalogLoader.load();
      filmsData = catalog.data;
      renderFilmsGrid();
      updateReaderCounts();
      handleInitialDeepLink();
      await Promise.all([loadFilmFavorites(), loadPhotoFavorites(), loadContributorFavorites()]);
      // 좋아요 한 필름이 있으면 라이브러리 카드를 fav-우선으로 재배치
      if (filmFavSlugs.size > 0) resortLibraryFavFirst();
      syncFilmFavMarks();
    } catch (err) {
      console.error('Films 데이터 로딩 실패:', err);
    }
  })();

  // ════════════════════════════
  // Library 카드들의 "X / 36" 카운트를 현재 진행 중인 롤 기준으로 업데이트
  //  - 모든 카드 일괄로 한 번에 처리 (필름별 alias 매칭)
  //  - 5ft Issue 영역의 featured 카드(editorial "36 photos")는 건드리지 않음
  // ════════════════════════════
  async function updateReaderCounts() {
    const submissions = await getApprovedSubmissions({ force: true });
    if (!submissions || !submissions.length) return;

    // 인트로 하단: 지금까지 모인 독자 사진 총 개수
    const introCount = document.getElementById('filmsIntroCount');
    if (introCount) {
      introCount.innerHTML = `지금까지 독자들이 더한 사진 <strong>${submissions.length.toLocaleString('ko-KR')}</strong>컷이 모여 있어요.`;
      introCount.hidden = false;
    }

    const normalize = window.normalizeFilmName
      || ((s) => String(s || '').toLowerCase().replace(/[\s\-_+()/.]+/g, ''));

    // 카메라 인덱스 + 드롭다운 빌드 — submissions 가 들어왔을 때 같이 처리
    rebuildCameraIndex(submissions, filmsData);
    await applyCameraOverrides();
    renderLibraryCameraSelect();
    // 카메라 필터가 활성화돼 있을 수 있으므로 카드 가시성 재계산
    applyLibraryFilter();

    // 필름별 카운트 + 독자 작가/SNS 검색 토큰 집계
    const countPerSlug = new Map();
    const readerSearchPerSlug = new Map();
    for (const slug of Object.keys(filmsData)) {
      const film = filmsData[slug];
      const aliases = (film.aliases || []).concat([film.displayName, film.name]).filter(Boolean);
      const aliasSet = new Set(aliases.map(normalize));
      const matched = submissions.filter(s => aliasSet.has(normalize(s.film)));
      if (matched.length > 0) {
        const rollState = buildReaderRollState(matched);
        const label = typeof window.ReaderRoll?.formatCardLabel === 'function'
          ? window.ReaderRoll.formatCardLabel(rollState, ROLL_LIMIT)
          : `${rollState.currentRows.length} / ${ROLL_LIMIT}`;
        countPerSlug.set(slug, {
          label,
          currentCount: rollState.currentRows.length,
          currentNumber: rollState.currentNumber,
        });
        readerSearchPerSlug.set(slug, normalizeLibrarySearch(matched.map(readerSearchTokensForSubmission).join(' ')));
      }
    }

    // Library 그리드 카드만 갱신 (5ft Issue의 editorial 카운트는 그대로)
    const libraryGrid = document.getElementById('filmsGridLibrary');
    if (!libraryGrid) return;

    libraryGrid.querySelectorAll('.film-card').forEach(card => {
      card.dataset.readerSearch = readerSearchPerSlug.get(card.dataset.film || '') || '';
    });

    for (const [slug, progress] of countPerSlug) {
      const card = libraryGrid.querySelector(`.film-card[data-film="${slug}"]`);
      if (!card) continue;
      const countEl = card.querySelector('.film-count');
      const ctaEl = card.querySelector('.film-cta');
      if (countEl) {
        countEl.textContent = progress.label;
        countEl.classList.toggle('has-rolls', progress.currentNumber > 1);
        countEl.setAttribute('aria-label', progress.currentNumber > 1
          ? `현재 ${progress.currentNumber}번째 롤 ${progress.currentCount}/${ROLL_LIMIT}컷`
          : `현재 롤 ${progress.currentCount}/${ROLL_LIMIT}컷`);
      }
      if (ctaEl) ctaEl.textContent = '컷 채우기 →';
    }

    applyLibraryFilter();
  }

  // ════════════════════════════
  // 모달 열기/닫기
  // ════════════════════════════
  const modalOverlay = document.getElementById('modalOverlay');
  const modalContent = document.getElementById('modalContent');
  const modalClose = document.getElementById('modalClose');

  async function waitForApprovedFetcher(timeoutMs = 5000) {
    const step = 100;
    for (let elapsed = 0; elapsed < timeoutMs; elapsed += step) {
      if (
        typeof window.fetchApprovedSubmissions === 'function' &&
        window.MagDB &&
        window.MagDB.isReady()
      ) {
        return window.fetchApprovedSubmissions;
      }
      await new Promise(r => setTimeout(r, step));
    }
    return null;
  }

  // 초기 정적 구독자 사진(data/readers.json) — Supabase 제출과 같은 형태로 매핑.
  // 표시 전용: 문자열 id 를 주지 않아 submissionId 가 빈 값이 되고(라이트박스 ♡ 미노출),
  // createdAt 이 없어 reader roll 에서 가장 오래된(첫 롤) 쪽에 배치된다.
  let staticReadersCache = null;
  async function getStaticReaders() {
    if (staticReadersCache) return staticReadersCache;
    try {
      const rows = await (await fetch('data/readers.json')).json();
      staticReadersCache = (Array.isArray(rows) ? rows : [])
        .filter(r => r && r.published !== false && r.image && r.film)
        .map(r => {
          const ig = String(r.instagram || (r.author || '').replace(/^@/, '')).trim();
          return {
            image: r.image,
            author: r.author || (ig ? '@' + ig : ''),
            instagram: ig,
            instagramUrl: r.instagramUrl || (ig ? `https://instagram.com/${ig}` : ''),
            film: r.film,
          };
        });
    } catch (_) {
      staticReadersCache = [];
    }
    return staticReadersCache;
  }

  async function getApprovedSubmissions({ force = false } = {}) {
    if (!force && approvedSubmissionsCache) return approvedSubmissionsCache;
    if (!force && approvedSubmissionsPromise) return approvedSubmissionsPromise;

    approvedSubmissionsPromise = (async () => {
      const fetcher = await waitForApprovedFetcher();
      const staticReaders = await getStaticReaders();
      if (!fetcher) {
        approvedSubmissionsCache = approvedSubmissionsCache || staticReaders;
        return approvedSubmissionsCache;
      }
      try {
        const rows = await fetcher();
        approvedSubmissionsCache = (Array.isArray(rows) ? rows : []).concat(staticReaders);
        return approvedSubmissionsCache;
      } catch (e) {
        console.warn('승인된 제출 fetch 실패:', e);
        approvedSubmissionsCache = approvedSubmissionsCache || staticReaders;
        return approvedSubmissionsCache;
      } finally {
        approvedSubmissionsPromise = null;
      }
    })();

    return approvedSubmissionsPromise;
  }

  function buildReaderRollState(rows) {
    return window.ReaderRoll.buildState(rows, ROLL_LIMIT);
  }

  async function handleInitialDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const contributor = normalizeContributorKey(params.get('contributor') || routeParam('contributor'));
    const cameraRaw = params.get('camera') || routeParam('camera');
    let filmKey = resolveFilmKey(params.get('film') || params.get('slug') || routeParam('film'));

    // ?camera= 우선 처리 — 카메라 모달 열기 (openCameraModal 가 자체적으로 매칭/대기 처리)
    if (cameraRaw) {
      const ok = await openCameraModal(cameraRaw);
      if (ok) return;
      // 매칭 실패시 그 아래 film/contributor 흐름으로 폴백
    }

    if (!filmKey && contributor) {
      const submissions = await getApprovedSubmissions();
      const personKeyOf = contributorKeyOfSubmission;
      const first = submissions.find(sub => personKeyOf(sub) === contributor);
      if (first) {
        const match = typeof window.findFilmMatch === 'function'
          ? window.findFilmMatch(first.film, filmsData)
          : null;
        filmKey = match?.slug || resolveFilmKey(first.film);
      } else {
        const contributorCard = document.getElementById('filmsGridLibrary');
        if (contributorCard) contributorCard.scrollIntoView({ block: 'start' });
      }
    }

    if (filmKey) openModal(filmKey, { contributor });
  }

  function openModal(filmKey, options = {}) {
    const data = filmsData[filmKey];
    if (!data) return;
    currentFilmKey = filmKey;

    // URL 동기화 — 공유/북마크 가능하게
    try {
      const contributor = normalizeContributorKey(options.contributor);
      history.replaceState(null, '', contributor ? prettyContributorPath(contributor) : prettyFilmPath(filmKey));
    } catch (_) {}

    const isFeatured = data.tier === 'featured';
    const photographers = Array.isArray(data.photographers) ? data.photographers : [];

    // ── 1) Editorial(매거진 게재) 36컷 ──
    let editorialBlock = '';
    if (isFeatured && data.photos?.length) {
      let photosHTML = '';
      data.photos.forEach((photo, idx) => {
        const imgSrc = photo.src || `https://picsum.photos/seed/${photo.seed}/600/750`;
        const webpSrc = photo.src ? photo.src.replace(/\.(jpg|jpeg|png)$/i, '.webp') : null;
        const pictureBlock = webpSrc
          ? `<picture>
               <source srcset="${escapeAttr(webpSrc)}" type="image/webp">
               <img src="${escapeAttr(imgSrc)}" loading="lazy" alt="${escapeAttr(photo.author || '')}" />
             </picture>`
          : `<img src="${escapeAttr(imgSrc)}" loading="lazy" alt="${escapeAttr(photo.author || '')}" />`;
        photosHTML += `
          <div>
            <div class="modal-photo" data-photo-index="${idx}">
              ${pictureBlock}
            </div>
            <p class="modal-photo-caption">${escapeAttr(photo.author || '')}</p>
          </div>
        `;
      });
      editorialBlock = `
        <div class="modal-section">
          <div class="modal-section-head">
            <span class="modal-section-tag">${escapeAttr(data.issue || 'ISSUE')} · EDITORIAL</span>
            <span class="modal-section-meta">사진가 ${escapeAttr(photographers.join(', '))}</span>
            <div class="modal-section-actions">
              <button type="button" class="modal-view-toggle" data-view-toggle aria-label="컨택트 시트로 전환">컨택트 시트</button>
              <button type="button" class="modal-view-save" data-save-roll="editorial" data-film-key="${escapeAttr(filmKey)}" hidden aria-label="필름스트립 이미지로 저장">이미지로 저장</button>
            </div>
          </div>
          <div class="modal-gallery" data-view="grid" id="editorialGallery-${escapeAttr(filmKey)}">
            ${photosHTML}
          </div>
        </div>`;
    }

    // ── 2) Reader's Roll 36 자리 (모든 필름 공통) ──
    // 빈 슬롯 36개를 먼저 그려놓고, 승인된 제출이 있으면 채워 넣음
    let slotsHTML = '';
    for (let i = 0; i < ROLL_LIMIT; i++) {
      slotsHTML += `
        <div class="reader-slot is-empty" data-slot-index="${i}" aria-label="프레임 ${i + 1} — 비어 있음">
          <span class="reader-slot-frame">${String(i + 1).padStart(2, '0')}</span>
        </div>`;
    }
    const readerBlock = `
      <div class="modal-section modal-section-reader">
        <div class="modal-section-head">
          <span class="modal-section-tag">READER'S ROLL</span>
          <span class="modal-section-meta" id="readerRollCounter-${filmKey}">0 / ${ROLL_LIMIT}</span>
        </div>
        <p class="reader-roll-intro">
          ${isFeatured
            ? '독자들이 같은 필름으로 채워가는 또 하나의 한 롤. 빈 자리에 당신의 한 컷을 넣어보세요.'
            : '아직 시작된 롤. 빈 36 자리를 독자들이 함께 채워갑니다. 첫 자리를 차지해 보세요.'}
        </p>
        <div class="reader-roll-controls">
          <div class="reader-roll-control-main">
            <div class="reader-control-group reader-control-group-roll">
              <div class="reader-roll-switcher" id="readerRollSwitcher-${filmKey}" hidden></div>
            </div>
            <div class="reader-control-group reader-control-group-person">
              <div class="reader-person-filter" id="readerPersonFilter-${filmKey}" hidden></div>
            </div>
          </div>
          <div class="modal-section-actions reader-roll-view-actions">
            <span class="reader-control-label">보기·저장</span>
            <button type="button" class="modal-view-toggle" data-view-toggle aria-label="기본 그리드로 전환">기본 그리드</button>
            <div class="reader-save-menu" data-reader-save-menu hidden>
              <button type="button" class="modal-view-save" data-save-menu-toggle="reader" data-film-key="${escapeAttr(filmKey)}" aria-expanded="false" aria-label="이미지 저장 방식 선택">이미지로 저장</button>
              <div class="reader-save-menu-popover" data-save-menu-popover hidden>
                <button type="button" class="reader-save-menu-item" data-save-roll="reader" data-film-key="${escapeAttr(filmKey)}">전체 롤 저장</button>
                <button type="button" class="reader-save-menu-item" data-select-roll="reader" data-film-key="${escapeAttr(filmKey)}">사진 골라 저장</button>
              </div>
            </div>
            <button type="button" class="modal-view-save reader-selected-save" data-save-selected-roll="reader" data-film-key="${escapeAttr(filmKey)}" hidden disabled aria-label="선택한 사진만 이미지로 저장">선택한 0장 저장</button>
            <button type="button" class="modal-view-cancel" data-select-cancel="reader" data-film-key="${escapeAttr(filmKey)}" hidden aria-label="사진 선택 취소">취소</button>
          </div>
        </div>
        <div class="reader-grid" data-view="contact" id="readerGrid-${filmKey}">
          ${slotsHTML}
        </div>
        <div class="reader-contributor-view" id="readerContributorView-${filmKey}" hidden></div>
        <div class="reader-roll-actions">
          <button type="button" class="reader-submit-btn" data-action="open-submission" data-prefill-film="${escapeAttr(data.displayName || data.name)}">
            ${isFeatured ? '컷 채우기' : '첫 컷 채우기'}
          </button>
          <a href="me.html" class="reader-mine-link">내 사진 관리 →</a>
        </div>
      </div>`;

    // ── 3) 모달 헤더 (썸네일 상태 별 분기) ──
    // featured 필름은 EDITORIAL 섹션 헤드에 사진가가 들어가(섹션과 함께 이동) 헤더엔 중복 노출하지 않는다.
    const photographerLine = (!isFeatured && photographers.length)
      ? `<span>Photographers <strong>${escapeAttr(photographers.join(', '))}</strong></span>`
      : '';

    modalContent.innerHTML = `
      <div class="modal-header">
        <span class="modal-brand">${escapeAttr(data.brand || '')}</span>
        <h2 class="modal-name">${escapeAttr(data.displayName || data.name || '')}</h2>
        <p class="modal-desc">${escapeAttr(data.desc || '')}</p>
        <div class="modal-meta">
          <span>ISO <strong>${escapeAttr(data.iso || '')}</strong></span>
          <span>Type <strong>${escapeAttr(data.type || '')}</strong></span>
          <span>Format <strong>${escapeAttr(data.format || '')}</strong></span>
          ${photographerLine}
        </div>
      </div>
      ${options.source === 'library' ? readerBlock + editorialBlock : editorialBlock + readerBlock}
      <section class="modal-comments" data-comments data-page-id="films/${escapeAttr(filmKey)}"></section>
    `;

    modalOverlay.classList.add('open');
    document.body.classList.add('modal-open');
    modalOverlay.scrollTop = 0;

    // 모달이 열릴 때마다 댓글 위젯 초기화 (필름마다 다른 page_id)
    if (window.MagComments) {
      const cmContainer = modalContent.querySelector('[data-comments]');
      if (cmContainer) window.MagComments.init({
        pageId: `films/${filmKey}`,
        container: cmContainer,
      });
    }

    // 에디토리얼 사진: 세로/가로 orientation 클래스 부여
    modalContent.querySelectorAll('.modal-photo img').forEach(classifyPhotoOrientation);

    // Reader's Roll: 승인된 제출을 lazy fetch 해서 빈 자리 채우기
    loadReaderRollForFilm(filmKey, options);
  }

  // 사진 로딩 후 세로형이면 부모(.modal-photo) 또는 본인(<img>)에 is-portrait 클래스 부여.
  // 세로 사진은 CSS 에서 90° 회전 + 가로/세로 swap 후 동일하게 photo window 를 cover.
  function classifyPhotoOrientation(img) {
    const apply = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const portrait = img.naturalHeight > img.naturalWidth;
      const target = img.closest('.modal-photo') || img;
      target.classList.toggle('is-portrait', portrait);
    };
    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener('load', apply, { once: true });
  }

  // ════════════════════════════
  // Reader's Roll: 필름별 승인된 제출 가져와서 슬롯 채우기
  // ════════════════════════════
  async function loadReaderRollForFilm(filmKey, options = {}) {
    const film = filmsData[filmKey];
    if (!film) return;
    const isFeatured = film.tier === 'featured';

    const rawAliases = (film.aliases || []).concat([film.displayName, film.name]).filter(Boolean);
    const normalize = window.normalizeFilmName
      || ((s) => String(s || '').toLowerCase().replace(/[\s\-_+()/.]+/g, ''));

    const grid = document.getElementById(`readerGrid-${filmKey}`);
    const counter = document.getElementById(`readerRollCounter-${filmKey}`);
    const rollSwitcher = document.getElementById(`readerRollSwitcher-${filmKey}`);
    const personFilter = document.getElementById(`readerPersonFilter-${filmKey}`);
    const contributorView = document.getElementById(`readerContributorView-${filmKey}`);
    const submitBtn = modalContent.querySelector('.reader-submit-btn');
    if (!grid) return;

    const rollSource = await readerRollData.createSource({
      rawAliases,
      normalize,
      rollLimit: ROLL_LIMIT,
      currentCameras,
      getStaticReaders,
      getApprovedSubmissions,
      buildReaderRollState,
      resolveCanonicalCameraKey,
    });
    const rangeApi = rollSource.rangeApi;
    const rollTotal = rollSource.rollTotal;
    const currentNumber = rollSource.currentNumber;

    const personKeyOf = contributorKeyOfSubmission;
    const personLabelOf = contributorLabelOfSubmission;
    const rollMeta = (number) => rollSource.rollMeta(number);
    const rollRowsByNumber = (number) => rollSource.rollRowsByNumber(number);
    const rollIntroText = (roll) => readerRollUi.rollIntroText({ roll, rollTotal, rollLimit: ROLL_LIMIT, isFeatured });
    let activeRoll = currentNumber;
    let activePerson = 'all';
    let archiveOpen = false;
    let rollRows = rollSource.cachedRows(activeRoll);
    let visible = rollRows;
    let selectionMode = false;
    let rollLoadToken = 0;
    const selectedExportKeys = new Set();
    const rollIntro = modalContent.querySelector('.reader-roll-intro');
    if (submitBtn) submitBtn.textContent = rollTotal > 0 ? '컷 채우기' : (isFeatured ? '컷 채우기' : '첫 컷 채우기');

    const filmLabelOf = (filmName) => {
      const match = typeof window.findFilmMatch === 'function'
        ? window.findFilmMatch(filmName, filmsData)
        : null;
      return match?.canonical || filmName || 'Unknown Film';
    };

    async function submissionsForPerson(personKey) {
      return rollSource.submissionsForPerson(personKey, personKeyOf);
    }

    const exportKeyOf = (sub) => readerRollUi.exportKeyOf(sub, { personKeyOf });

    function readerSelectionControls() {
      return readerRollUi.readerSelectionControls({ grid, filmKey });
    }

    function updateReaderSelectionControls() {
      readerRollUi.updateReaderSelectionControls({
        grid,
        filmKey,
        visibleCount: visible.length,
        selectionMode,
        selectedCount: selectedExportKeys.size,
      });
    }

    function closeReaderSaveMenu() {
      readerRollUi.closeReaderSaveMenu({ grid, filmKey });
    }

    function setReaderSelectionMode(next) {
      selectionMode = !!next;
      selectedExportKeys.clear();
      closeReaderSaveMenu();
      renderReaderSlots();
      updateReaderSelectionControls();
    }

    function toggleReaderSelection(sub) {
      const key = exportKeyOf(sub);
      if (!key) return;
      if (selectedExportKeys.has(key)) selectedExportKeys.delete(key);
      else selectedExportKeys.add(key);
      renderReaderSlots();
      updateReaderSelectionControls();
    }

    function renderRollSwitcher() {
      readerRollUi.renderRollSwitcher({ rollSwitcher, currentNumber, activeRoll, archiveOpen });
    }

    function renderPersonFilter() {
      readerRollUi.renderPersonFilter({
        personFilter,
        rollRows,
        activePerson,
        personKeyOf,
        personLabelOf,
        escapeAttr,
      });
    }

    function setActivePerson(nextKey) {
      selectionMode = false;
      selectedExportKeys.clear();
      activePerson = nextKey || 'all';
      visible = activePerson === 'all'
        ? rollRows
        : rollRows.filter(sub => personKeyOf(sub) === activePerson);
      if (contributorView) contributorView.hidden = true;
      grid.hidden = false;
      if (rollIntro) {
        rollIntro.textContent = rollIntroText({ ...rollMeta(activeRoll), rows: rollRows });
      }
      // Reader's Roll 섹션 헤더 토글 복귀 (작가 뷰에서 빠져나옴)
      const readerSection = grid.closest('.modal-section-reader');
      const headToggle = readerSection?.querySelector('[data-view-toggle]');
      if (headToggle) headToggle.hidden = false;
      // 저장 버튼은 renderReaderSlots 에서 visible.length 보고 다시 토글됨
      renderReaderSlots();
      renderPersonFilter();
      renderRollSwitcher();
    }

    async function setActiveRoll(nextNumber) {
      const safeNumber = Math.max(1, Math.min(Number(nextNumber) || currentNumber, currentNumber));
      const token = ++rollLoadToken;
      grid.setAttribute('aria-busy', 'true');
      grid.classList.add('is-loading');
      const nextRows = await rollRowsByNumber(safeNumber);
      if (token !== rollLoadToken) return;
      selectionMode = false;
      selectedExportKeys.clear();
      activeRoll = safeNumber;
      activePerson = 'all';
      archiveOpen = activeRoll !== currentNumber ? true : archiveOpen;
      rollRows = nextRows;
      visible = rollRows;
      if (contributorView) contributorView.hidden = true;
      grid.hidden = false;
      if (rollIntro) rollIntro.textContent = rollIntroText({ number: activeRoll, rows: rollRows, current: activeRoll === currentNumber });
      renderReaderSlots();
      renderRollSwitcher();
      renderPersonFilter();
      grid.classList.remove('is-loading');
      grid.setAttribute('aria-busy', 'false');
      if (rangeApi) {
        const next = activeRoll > 1 ? activeRoll - 1 : activeRoll + 1;
        if (next >= 1 && next <= currentNumber) rollRowsByNumber(next).catch(() => {});
      }
    }

    function renderReaderSlots() {
      readerRollUi.renderReaderSlots({
        grid,
        rollLimit: ROLL_LIMIT,
        visible,
        selectedExportKeys,
        selectionMode,
        personKeyOf,
        personLabelOf,
        escapeAttr,
        classifyPhotoOrientation,
        counter,
        activePerson,
        rollRows,
        activeRoll,
        modalContent,
        filmKey,
        exportKey: exportKeyOf,
      });
    }

    async function renderContributorView(personKey) {
      if (!contributorView) return;
      const personEntries = await submissionsForPerson(personKey);
      if (!personEntries.length) return;
      const first = personEntries[0];
      const label = personLabelOf(first);
      const instagram = first.instagram || '';
      const instagramUrl = first.instagramUrl || (instagram ? `https://instagram.com/${instagram.replace(/^@/, '')}` : '');
      const grouped = new Map();
      personEntries.forEach((sub) => {
        const filmName = filmLabelOf(sub.film);
        if (!grouped.has(filmName)) grouped.set(filmName, []);
        grouped.get(filmName).push(sub);
      });
      const groups = [...grouped.entries()].sort((a, b) => {
        const featuredA = a[0] === filmLabelOf(film.displayName || film.name) ? -1 : 0;
        const featuredB = b[0] === filmLabelOf(film.displayName || film.name) ? -1 : 0;
        if (featuredA !== featuredB) return featuredA - featuredB;
        return b[1].length - a[1].length || a[0].localeCompare(b[0], 'ko');
      });

      grid.hidden = true;
      selectionMode = false;
      selectedExportKeys.clear();
      updateReaderSelectionControls();
      if (personFilter) personFilter.hidden = true;
      contributorView.hidden = false;
      if (rollIntro) {
        rollIntro.textContent = `${label}님이 5ft.mag에 올린 전체 Reader's Roll 사진입니다.`;
      }
      if (counter) {
        counter.textContent = `${personEntries.length} photos · ${groups.length} films`;
      }
      try { history.replaceState(null, '', prettyContributorPath(personKey)); } catch (_) {}
      const authorLabel = (instagram || '').replace(/^@/, '') || label;
      const isContribFav = contributorFavKeys.has(personKey);
      contributorView.innerHTML = `
        <div class="reader-contributor-head">
          <div>
            <span class="reader-contributor-kicker">CONTRIBUTOR</span>
            <div class="reader-contributor-name-row">
              <h3>${escapeAttr(label)}</h3>
              <button type="button"
                class="reader-contributor-fav${isContribFav ? ' is-fav' : ''}"
                data-contributor-key="${escapeAttr(personKey)}"
                aria-pressed="${isContribFav ? 'true' : 'false'}"
                aria-label="${isContribFav ? '작가 즐겨찾기 해제' : '작가 즐겨찾기 추가'}"
                title="작가 즐겨찾기">
                <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
                  <path stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"
                        d="M12 21s-7.5-4.5-9.5-9.5C1 7.5 4 4.5 7.5 4.5c2 0 3.6 1 4.5 2.5.9-1.5 2.5-2.5 4.5-2.5 3.5 0 6.5 3 5 7-2 5-9.5 9.5-9.5 9.5z"/>
                </svg>
              </button>
            </div>
            <p>${personEntries.length}컷 · ${groups.length}개 필름</p>
          </div>
          <div class="reader-contributor-actions">
            ${instagramUrl ? `<a href="${escapeAttr(instagramUrl)}" target="_blank" rel="noopener" class="reader-contributor-link">Instagram ↗</a>` : ''}
            <button type="button" class="reader-contributor-link" data-contrib-view-toggle aria-label="컨택트 시트로 전환">컨택트 시트</button>
            <button type="button" class="reader-contributor-back">← ${escapeAttr(film.displayName || film.name)}로 돌아가기</button>
          </div>
        </div>
        <div class="reader-contributor-sections" data-view="grid">
        ${groups.map(([filmName, rows], gIdx) => `
          <section class="reader-contributor-group" data-film-name="${escapeAttr(filmName)}">
            <div class="reader-contributor-group-head">
              <h4>${escapeAttr(filmName)} <span>${rows.length}컷</span></h4>
              <div class="reader-contributor-save-actions">
                <div class="reader-save-menu" data-contrib-save-menu>
                  <button type="button" class="reader-save-btn" data-save-menu-toggle="contrib" data-person-key="${escapeAttr(personKey)}" data-author-label="${escapeAttr(authorLabel)}" data-film-name="${escapeAttr(filmName)}" aria-expanded="false" aria-label="작가별 이미지 저장 방식 선택">이미지로 저장</button>
                  <div class="reader-save-menu-popover" data-save-menu-popover hidden>
                    <button type="button" class="reader-save-menu-item" data-save-contrib data-person-key="${escapeAttr(personKey)}" data-author-label="${escapeAttr(authorLabel)}" data-film-name="${escapeAttr(filmName)}">전체 저장</button>
                    <button type="button" class="reader-save-menu-item" data-select-contrib data-person-key="${escapeAttr(personKey)}" data-author-label="${escapeAttr(authorLabel)}" data-film-name="${escapeAttr(filmName)}">사진 골라 저장</button>
                  </div>
                </div>
                <button type="button" class="reader-save-btn reader-contrib-selected-save" data-save-selected-contrib data-person-key="${escapeAttr(personKey)}" data-author-label="${escapeAttr(authorLabel)}" data-film-name="${escapeAttr(filmName)}" hidden disabled>선택한 0장 저장</button>
                <button type="button" class="modal-view-cancel" data-cancel-contrib-select hidden>취소</button>
              </div>
            </div>
            <div class="reader-contributor-grid" id="contribGrid-${escapeAttr(personKey)}-${gIdx}">
              ${rows.map((sub, idx) => `
                <button type="button" class="reader-contributor-photo" data-person-key="${escapeAttr(personKey)}" data-photo-index="${idx}" data-film-name="${escapeAttr(filmName)}" aria-label="${escapeAttr(filmName)} ${idx + 1}번째 사진 크게 보기" aria-pressed="false">
                  <span class="reader-contributor-photo-window">
                    <img src="${escapeAttr(sub.image)}" alt="" loading="lazy" />
                  </span>
                  <span class="reader-contributor-photo-check" aria-hidden="true"></span>
                  <span class="reader-contributor-photo-caption">${escapeAttr(sub.camera || sub.film || filmName)}</span>
                </button>
              `).join('')}
            </div>
          </section>
        `).join('')}
        </div>`;
      // 컨택트 시트 전환 시 portrait 자동 회전 위해 orientation 분류 실행
      contributorView.querySelectorAll('.reader-contributor-photo img').forEach(classifyPhotoOrientation);
      // Reader's Roll 섹션 헤더의 토글·저장 버튼은 작가 뷰 동안 숨김 (중복 방지)
      const readerSection = contributorView.closest('.modal-section-reader');
      const headToggle = readerSection?.querySelector('[data-view-toggle]');
      const rollSaveMenu = readerSelectionControls().saveMenu;
      if (headToggle) headToggle.hidden = true;
      if (rollSaveMenu) rollSaveMenu.hidden = true;
    }

    await setActiveRoll(currentNumber);

    // 채워진 슬롯 클릭 → reader 라이트박스 (인스타로 바로 점프 X)
    grid.onclick = (e) => {
      const author = e.target.closest('.reader-slot-author[data-person-key]');
      if (selectionMode) {
        const slot = e.target.closest('.reader-slot.is-filled');
        if (!slot) return;
        e.preventDefault();
        e.stopPropagation();
        const idx = parseInt(slot.dataset.slotIndex, 10);
        if (Number.isNaN(idx) || idx >= visible.length) return;
        toggleReaderSelection(visible[idx]);
        return;
      }
      if (author) {
        e.preventDefault();
        e.stopPropagation();
        setActivePerson(author.dataset.personKey);
        return;
      }
      const slot = e.target.closest('.reader-slot.is-filled');
      if (!slot) return;
      const idx = parseInt(slot.dataset.slotIndex, 10);
      if (Number.isNaN(idx) || idx >= visible.length) return;
      openFilmReaderLightbox(visible, idx);
    };
    grid.addEventListener('reader-select-start', () => {
      setReaderSelectionMode(true);
    });
    grid.addEventListener('reader-select-cancel', () => {
      setReaderSelectionMode(false);
    });
    if (rollSwitcher) {
      rollSwitcher.onclick = (e) => {
        const action = e.target.closest('[data-roll-action]');
        if (action) {
          if (action.dataset.rollAction === 'toggle') {
            archiveOpen = !archiveOpen;
            renderRollSwitcher();
          } else if (action.dataset.rollAction === 'current') {
            archiveOpen = false;
            setActiveRoll(currentNumber).catch(err => console.warn('롤 전환 실패:', err));
          }
          return;
        }
        const numberBtn = e.target.closest('.reader-roll-number');
        if (!numberBtn) return;
        const number = parseInt(numberBtn.dataset.rollNumber, 10);
        if (!Number.isNaN(number)) setActiveRoll(number).catch(err => console.warn('롤 전환 실패:', err));
      };
    }
    if (personFilter) {
      personFilter.onclick = (e) => {
        const allFilms = e.target.closest('.reader-person-all');
        if (allFilms) {
          const chip = allFilms.closest('.reader-person-chip');
          if (chip) renderContributorView(chip.dataset.personKey).catch(err => console.warn('작가 모아보기 실패:', err));
          return;
        }
        const chip = e.target.closest('.reader-person-chip');
        if (!chip) return;
        setActivePerson(chip.dataset.personKey);
      };
    }
    if (contributorView) {
      contributorView.onclick = (e) => {
        const fav = e.target.closest('.reader-contributor-fav');
        if (fav) {
          e.preventDefault();
          e.stopPropagation();
          toggleContributorFav(fav);
          return;
        }
        const back = e.target.closest('.reader-contributor-back');
        if (back) {
          setActivePerson(activePerson);
          return;
        }
        const photo = e.target.closest('.reader-contributor-photo');
        if (!photo) return;
        const groupEl = photo.closest('.reader-contributor-group');
        if (groupEl?.classList.contains('is-selecting')) {
          e.preventDefault();
          e.stopPropagation();
          readerExport.toggleContributorPhotoSelection(photo);
          return;
        }
        const key = photo.dataset.personKey;
        const all = rollSource.fallbackSubmissions
          ? rollSource.fallbackSubmissions.filter(sub => personKeyOf(sub) === key).slice(0, 120)
          : [];
        const filmName = photo.dataset.filmName;
        const group = all.filter(sub => filmLabelOf(sub.film) === filmName);
        const idx = parseInt(photo.dataset.photoIndex, 10);
        if (Number.isNaN(idx) || idx >= group.length) return;
        openFilmReaderLightbox(group, idx);
      };
    }

    const requestedContributor = normalizeContributorKey(options.contributor);
    if (requestedContributor) {
      renderContributorView(requestedContributor).catch(err => console.warn('작가 모아보기 실패:', err));
    }
  }

  // ════════════════════════════
  // Reader 사진을 통합 lightbox 로 열기
  //  (editorial 과 동일한 컴포넌트 사용 — zoom / fullscreen / thumb strip)
  // ════════════════════════════
  function openFilmReaderLightbox(matched, index) {
    filmsLightbox.openReader(matched.map(toLightboxReaderPhoto), index);
  }

  function closeModal() {
    modalOverlay.classList.remove('open');
    document.body.classList.remove('modal-open');
    currentFilmKey = null;
    currentCameraKey = null;
    // URL 에서 film/camera/contributor 제거
    try {
      const u = new URL(location.href);
      let dirty = false;
      if (u.searchParams.has('film'))        { u.searchParams.delete('film'); dirty = true; }
      if (u.searchParams.has('camera'))      { u.searchParams.delete('camera'); dirty = true; }
      if (u.searchParams.has('contributor')) { u.searchParams.delete('contributor'); dirty = true; }
      if (dirty || /^\/(?:film|camera|contributor)\//.test(u.pathname)) {
        history.replaceState(null, '', filmsBasePath());
      }
    } catch (_) {}
  }

  // ════════════════════════════
  // 카메라 모달 — 같은 카메라로 찍힌 reader 사진을 필름별로 그룹화해 표시
  //   입력: normalized model key (e.g. 'm6') 또는 raw 카메라 문자열 ('Leica M6')
  //   - cameraIndex 가 비어있어도 approvedSubmissions 에서 직접 필터링해 동작
  // ════════════════════════════
  async function openCameraModal(input) {
    if (!input) return false;
    const submissions = await getApprovedSubmissions();
    if (!Array.isArray(submissions) || !submissions.length) {
      console.warn('[openCameraModal] 승인된 제출이 없어 카메라 모달을 열 수 없음');
      return false;
    }
    // 입력을 normalized key 로 변환
    const norm = (typeof window.normalizeCamera === 'function')
      ? window.normalizeCamera(input)
      : { key: String(input).toLowerCase().replace(/\s+/g, ''), brand: null };
    let key = norm.key;
    if (!key) {
      // 입력 자체가 cameraIndex 에 있는 key 일 수도 있음 (e.g. deep-link 가 이미 정규화된 값 전달)
      key = cameraIndex.has(input) ? input : '';
    }
    if (!key) { console.warn('[openCameraModal] key 도출 실패:', input); return false; }

    // submissions 에서 같은 key 의 사진들 직접 필터링 — cameraIndex 의존 X
    const matched = submissions.filter(s => {
      const cam = s.camera || '';
      if (!cam) return false;
      return resolveCanonicalCameraKey(window.normalizeCamera(cam).key) === key;
    });
    if (!matched.length) {
      console.warn('[openCameraModal] 매칭되는 사진 없음:', input, '→ key=', key);
      return false;
    }

    currentCameraKey = key;
    currentFilmKey = null;

    // cameraIndex 에 메타 없으면 그 자리에서 즉석 생성
    let info = cameraIndex.get(key);
    if (!info) {
      const pickDisplay = window.pickCameraDisplay || ((arr) => arr[0] || '');
      const originals = matched.map(s => s.camera).filter(Boolean);
      info = {
        display: pickDisplay(originals) || norm.original || input,
        brand: norm.brand,
        count: matched.length,
      };
      cameraIndex.set(key, info);
    }

    // URL 동기화
    try {
      history.replaceState(null, '', prettyCameraPath(key));
    } catch (_) {}

    // 필름별 그룹화
    const byFilm = new Map();
    for (const s of matched) {
      const filmName = (s.film || '').trim() || '(필름 미상)';
      if (!byFilm.has(filmName)) byFilm.set(filmName, []);
      byFilm.get(filmName).push(s);
    }
    const sortedFilms = [...byFilm.entries()].sort((a, b) => b[1].length - a[1].length);

    // 라이트박스용 평탄화
    cameraModalPhotos = [];
    const sectionsHtml = sortedFilms.map(([filmName, rows]) => {
      const cellsHtml = rows.map((s) => {
        const idx = cameraModalPhotos.length;
        cameraModalPhotos.push({
          src: s.image,
          author: s.submitterName || s.author || '',
          instagram: s.instagram || '',
          instagramUrl: s.instagramUrl || '',
          film: s.film || filmName,
          camera: s.camera || info.display,
          caption: s.caption || '',
          contributorKey: contributorKeyOfSubmission(s),
          submissionId: typeof s.id === 'string' ? s.id.replace(/^sub-/, '') : (s.submissionId || ''),
        });
        return `
          <div class="modal-photo" data-camera-photo-idx="${idx}">
            <img src="${escapeAttr(s.image)}" alt="" loading="lazy" />
            <div class="modal-photo-caption">${escapeHtml(s.submitterName || s.author || '익명')}</div>
          </div>`;
      }).join('');
      return `
        <section class="modal-camera-section">
          <h3 class="modal-camera-section-title">
            <button type="button" class="modal-camera-film-jump" data-film-name="${escapeAttr(filmName)}">${escapeHtml(filmName)}</button>
            <span>${rows.length}컷</span>
          </h3>
          <div class="modal-gallery">${cellsHtml}</div>
        </section>`;
    }).join('');

    const brandLabel = info.brand ? info.brand.toUpperCase() : 'CAMERA';
    document.getElementById('modalContent').innerHTML = `
      <div class="modal-header">
        <span class="modal-brand">${escapeHtml(brandLabel)}</span>
        <h2 class="modal-name">${escapeHtml(info.display)}</h2>
        <p class="modal-desc">${matched.length}컷 · ${byFilm.size}개 필름</p>
      </div>
      ${sectionsHtml || '<p class="modal-empty">아직 이 카메라로 찍힌 사진이 없어요.</p>'}
    `;

    // 사진 클릭 → reader 라이트박스
    document.querySelectorAll('#modalContent .modal-photo[data-camera-photo-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const i = Number(el.dataset.cameraPhotoIdx) || 0;
        showLightboxFromCameraModal(i);
      });
    });
    // 필름명 클릭 → 필름 모달로 점프
    document.querySelectorAll('#modalContent .modal-camera-film-jump').forEach(el => {
      el.addEventListener('click', () => {
        const name = el.dataset.filmName;
        const match = typeof window.findFilmMatch === 'function' && window.findFilmMatch(name, filmsData);
        const slug = match?.slug || resolveFilmKey(name);
        if (slug) openModal(slug);
      });
    });

    modalOverlay.classList.add('open');
    document.body.classList.add('modal-open');
    return true;
  }

  let cameraModalPhotos = [];
  function showLightboxFromCameraModal(index) {
    filmsLightbox.openReader(cameraModalPhotos.map(toLightboxReaderPhoto), index);
  }

  // 필름 카드 클릭
  document.querySelectorAll('.film-card').forEach(card => {
    card.addEventListener('click', () => {
      openModal(card.dataset.film, { source: card.closest('#filmsGridLibrary') ? 'library' : 'issue' });
    });
  });

  // 닫기 버튼
  modalClose.addEventListener('click', closeModal);

  // 공유 버튼
  const modalShare = document.getElementById('modalShare');
  if (modalShare) {
    modalShare.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentCameraKey) shareCameraLink(currentCameraKey, cameraIndex.get(currentCameraKey));
      else if (currentFilmKey) shareFilmLink(currentFilmKey, filmsData[currentFilmKey]);
    });
  }

  // 오버레이 빈 공간 클릭 시 닫기
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  function setPhotoFavoriteState(subId, on) {
    if (on) photoFavIds.add(subId);
    else photoFavIds.delete(subId);
  }

  async function ensurePhotoFavoriteSession() {
    if (!window.MagDB || !window.MagDB.isReady()) {
      window.notify?.('잠시 후 다시 시도해주세요.', 'info');
      return false;
    }
    const sess = await window.MagDB.auth.getSession();
    if (!sess) {
      if (!confirm('즐겨찾기는 로그인이 필요해요. Google로 로그인할까요?')) return false;
      window.MagDB.auth.signInWithGoogle(window.location.href.split('#')[0]);
      return false;
    }
    return true;
  }

  function resolveLightboxFilmSlug(name) {
    const match = typeof window.findFilmMatch === 'function' && window.findFilmMatch(name, filmsData);
    return match?.slug || resolveFilmKey(name);
  }

  function resolveLightboxCameraKey(cameraName) {
    if (!cameraName || typeof window.normalizeCamera !== 'function') return '';
    const key = resolveCanonicalCameraKey(window.normalizeCamera(cameraName).key);
    return key && cameraIndex.has(key) ? key : '';
  }

  async function openContributorFromLightbox(rawKey) {
    const key = normalizeContributorKey(rawKey);
    if (!key) return;

    let targetFilmKey = currentFilmKey;
    if (!targetFilmKey) {
      const submissions = await getApprovedSubmissions();
      const first = submissions.find(sub => contributorKeyOfSubmission(sub) === key);
      if (first) targetFilmKey = resolveLightboxFilmSlug(first.film);
    }
    if (targetFilmKey) openModal(targetFilmKey, { contributor: key });
  }

  const filmsLightbox = window.FilmsLightbox.create({
    getCurrentFilmKey: () => currentFilmKey,
    getEditorialPhotos: () => (currentFilmKey && filmsData[currentFilmKey]?.photos) || [],
    getEditorialFilm: () => filmsData[currentFilmKey] || {},
    normalizeContributorKey,
    resolveFilmSlug: resolveLightboxFilmSlug,
    resolveCameraKey: resolveLightboxCameraKey,
    openFilm: (filmKey) => openModal(filmKey),
    openCamera: (cameraKey) => openCameraModal(cameraKey),
    openContributor: openContributorFromLightbox,
    hasPhotoFavorite: (subId) => photoFavIds.has(subId),
    setPhotoFavorite: setPhotoFavoriteState,
    ensureFavoriteSession: ensurePhotoFavoriteSession,
    togglePhotoFavorite: (subId, wasFav) => window.MagDB.favorites.toggle('submission', subId, wasFav),
    isModalOpen: () => modalOverlay.classList.contains('open'),
    closeModal,
    notify: window.notify,
  });

  async function loadPhotoFavorites() {
    if (!window.MagDB || !window.MagDB.isReady()) return;
    try {
      const sess = await window.MagDB.auth.getSession();
      if (!sess) { photoFavIds = new Set(); return; }
      photoFavIds = await window.MagDB.favorites.idsForType('submission');
    } catch (_) {
      photoFavIds = new Set();
    }
  }
  async function loadContributorFavorites() {
    if (!window.MagDB || !window.MagDB.isReady()) return;
    try {
      const sess = await window.MagDB.auth.getSession();
      if (!sess) { contributorFavKeys = new Set(); return; }
      contributorFavKeys = await window.MagDB.favorites.idsForType('contributor');
    } catch (_) {
      contributorFavKeys = new Set();
    }
  }

  async function toggleContributorFav(btn) {
    if (!btn) return;
    if (btn.classList.contains('is-busy')) return;
    const key = btn.dataset.contributorKey;
    if (!key) return;
    if (!window.MagDB || !window.MagDB.isReady()) {
      window.notify?.('잠시 후 다시 시도해주세요.', 'info');
      return;
    }
    const sess = await window.MagDB.auth.getSession();
    if (!sess) {
      if (!confirm('작가 즐겨찾기는 로그인이 필요해요. Google로 로그인할까요?')) return;
      window.MagDB.auth.signInWithGoogle(window.location.href.split('#')[0]);
      return;
    }
    const wasFav = contributorFavKeys.has(key);
    if (wasFav) contributorFavKeys.delete(key); else contributorFavKeys.add(key);
    setContributorFavState(btn, !wasFav);
    btn.classList.add('is-busy');
    const { error } = await window.MagDB.favorites.toggle('contributor', key, wasFav);
    btn.classList.remove('is-busy');
    if (error) {
      if (wasFav) contributorFavKeys.add(key); else contributorFavKeys.delete(key);
      setContributorFavState(btn, wasFav);
      window.notify?.('처리 실패: ' + (error.message || '잠시 후 다시 시도'), 'danger');
    }
  }

  function setContributorFavState(btn, on) {
    btn.classList.toggle('is-fav', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? '작가 즐겨찾기 해제' : '작가 즐겨찾기 추가');
  }

  // 그리드의 사진 클릭 시 라이트박스 열기 (이벤트 위임)
  modalContent.addEventListener('click', (e) => {
    // 컨택트 시트 ↔ 그리드 토글
    const toggleBtn = e.target.closest('[data-view-toggle]');
    if (toggleBtn) {
      const section = toggleBtn.closest('.modal-section');
      const gallery = section?.querySelector('.modal-gallery, .reader-grid');
      if (gallery) {
        const next = gallery.dataset.view === 'contact' ? 'grid' : 'contact';
        gallery.dataset.view = next;
        toggleBtn.textContent = next === 'contact' ? '기본 그리드' : '컨택트 시트';
        toggleBtn.setAttribute('aria-label', next === 'contact' ? '기본 그리드로 전환' : '컨택트 시트로 전환');
        // 에디토리얼 저장 버튼은 컨택트 시트 모드일 때만 노출
        const saveBtn = section?.querySelector('[data-save-roll="editorial"]');
        if (saveBtn) saveBtn.hidden = next !== 'contact';
      }
      return;
    }
    // 작가 뷰 컨택트 시트 토글 — 모든 필름 섹션 한 번에 전환
    const contribToggleBtn = e.target.closest('[data-contrib-view-toggle]');
    if (contribToggleBtn) {
      const view = contribToggleBtn.closest('.reader-contributor-view');
      const sections = view?.querySelector('.reader-contributor-sections');
      if (sections) {
        const next = sections.dataset.view === 'contact' ? 'grid' : 'contact';
        sections.dataset.view = next;
        contribToggleBtn.textContent = next === 'contact' ? '기본 그리드' : '컨택트 시트';
        contribToggleBtn.setAttribute('aria-label', next === 'contact' ? '기본 그리드로 전환' : '컨택트 시트로 전환');
      }
      return;
    }
    // 작가 뷰 필름별 이미지 저장
    const contribSaveBtn = e.target.closest('[data-save-contrib]');
    if (contribSaveBtn) {
      e.preventDefault();
      e.stopPropagation();
      readerExport.handleSaveContribFilmImage(contribSaveBtn);
      return;
    }
    const saveMenuToggle = e.target.closest('[data-save-menu-toggle]');
    if (saveMenuToggle) {
      e.preventDefault();
      e.stopPropagation();
      const menu = saveMenuToggle.closest('[data-reader-save-menu], [data-contrib-save-menu]');
      const popover = menu?.querySelector('[data-save-menu-popover]');
      if (popover) {
        const nextOpen = popover.hidden;
        popover.hidden = !nextOpen;
        saveMenuToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
      }
      return;
    }
    // 작가별 보기: 한 필름 섹션 안에서 원하는 사진만 골라 저장
    const selectContribBtn = e.target.closest('[data-select-contrib]');
    if (selectContribBtn) {
      e.preventDefault();
      e.stopPropagation();
      const group = selectContribBtn.closest('.reader-contributor-group');
      readerExport.setContributorSelectionMode(group, true);
      return;
    }
    const selectedContribSaveBtn = e.target.closest('[data-save-selected-contrib]');
    if (selectedContribSaveBtn) {
      e.preventDefault();
      e.stopPropagation();
      readerExport.handleSaveSelectedContribImage(selectedContribSaveBtn);
      return;
    }
    const cancelContribBtn = e.target.closest('[data-cancel-contrib-select]');
    if (cancelContribBtn) {
      e.preventDefault();
      e.stopPropagation();
      readerExport.setContributorSelectionMode(cancelContribBtn.closest('.reader-contributor-group'), false);
      return;
    }
    // Reader's Roll 선택 저장 모드 시작
    const selectRollBtn = e.target.closest('[data-select-roll]');
    if (selectRollBtn) {
      e.preventDefault();
      e.stopPropagation();
      const filmKey = selectRollBtn.dataset.filmKey;
      const grid = document.getElementById(`readerGrid-${filmKey}`);
      if (grid) {
        grid.dispatchEvent(new CustomEvent('reader-select-start', { bubbles: false }));
      }
      return;
    }
    const selectedSaveBtn = e.target.closest('[data-save-selected-roll]');
    if (selectedSaveBtn) {
      e.preventDefault();
      e.stopPropagation();
      readerExport.handleSaveSelectedRollImage(selectedSaveBtn);
      return;
    }
    const selectCancelBtn = e.target.closest('[data-select-cancel]');
    if (selectCancelBtn) {
      e.preventDefault();
      e.stopPropagation();
      const filmKey = selectCancelBtn.dataset.filmKey;
      const grid = document.getElementById(`readerGrid-${filmKey}`);
      if (grid) {
        grid.dispatchEvent(new CustomEvent('reader-select-cancel', { bubbles: false }));
      }
      return;
    }
    // 이미지로 저장 버튼
    const saveBtn = e.target.closest('[data-save-roll]');
    if (saveBtn) {
      e.preventDefault();
      e.stopPropagation();
      const popover = saveBtn.closest('[data-save-menu-popover]');
      const menuToggle = saveBtn.closest('[data-reader-save-menu], [data-contrib-save-menu]')?.querySelector('[data-save-menu-toggle]');
      if (popover) popover.hidden = true;
      if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
      readerExport.handleSaveRollImage(saveBtn);
      return;
    }
    // 자리 채우기 클릭 시 films 모달을 먼저 닫고 reader-submissions 위젯에 위임
    // (모달 위 모달이 겹쳐 보이는 혼란을 방지)
    if (e.target.closest('.reader-submit-btn')) {
      closeModal();
      return; // 클릭은 계속 버블링 → reader-submissions.js 글로벌 위임이 prefill을 받아 rs-modal 오픈
    }
    const photoEl = e.target.closest('.modal-photo');
    if (!photoEl) return;
    const idx = parseInt(photoEl.dataset.photoIndex, 10);
    if (isNaN(idx)) return;
    filmsLightbox.show(idx, 'editorial');
  });

  // displayName / name 으로 filmsData 안에서 일치 항목 찾아 캐니스터 썸네일 경로 반환
  function findFilmThumbByName(filmName) {
    if (!filmName) return null;
    const target = String(filmName).toLowerCase();
    for (const key of Object.keys(filmsData || {})) {
      const f = filmsData[key];
      const candidates = [f?.displayName, f?.name].filter(Boolean).map(s => s.toLowerCase());
      if (candidates.includes(target)) {
        return (f.canThumbnailStatus === 'set' && f.canThumbnail) ? f.canThumbnail : null;
      }
    }
    return null;
  }

  // ════════════════════════════
  // 라이브러리 보기 전환 (필름별 / 사진 스타일별)
  //   필름별: 기존 라이브러리 그리드 (filmsGridLibrary) 유지
  //   사진 스타일별: 승인된 submissions 전체를 셔플해서 한 그리드로 노출. 카드 클릭 시 통합 lightbox.
  // ════════════════════════════
  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function renderLibraryPhotosBatch() {
    if (!libraryPhotosGrid) return;
    const start = photosVisible;
    const end = Math.min(start + PHOTOS_PAGE_SIZE, photosShuffled.length);
    if (start === 0) libraryPhotosGrid.innerHTML = '';
    const slice = photosShuffled.slice(start, end);
    const html = slice.map((s, i) => {
      const absoluteIndex = start + i;
      const src = escapeAttr(s.image || s.src || '');
      const authorAttr = escapeAttr(s.author || s.submitterName || '');
      const filmAttr   = escapeAttr(s.film || '');
      const authorHtml = escapeHtml(s.author || s.submitterName || '');
      const filmHtml   = escapeHtml(s.film || '');
      const infoHtml = (authorHtml || filmHtml)
        ? `<span class="library-photo-info">`
          + (authorHtml ? `<span class="library-photo-author">${authorHtml}</span>` : '')
          + (filmHtml ? `<span class="library-photo-film">${filmHtml}</span>` : '')
          + `</span>`
        : '';
      return `<button type="button" class="library-photo-card" data-photo-index="${absoluteIndex}" aria-label="${authorAttr ? authorAttr + ' · ' : ''}${filmAttr}">`
        + `<img src="${src}" alt="" loading="lazy" />`
        + infoHtml
        + `</button>`;
    }).join('');
    libraryPhotosGrid.insertAdjacentHTML('beforeend', html);
    photosVisible = end;
    if (libraryPhotosMoreWrap) libraryPhotosMoreWrap.hidden = photosVisible >= photosShuffled.length;
    if (libraryPhotosCount) {
      libraryPhotosCount.textContent = `${photosShuffled.length.toLocaleString('ko-KR')}컷 · ${photosVisible.toLocaleString('ko-KR')}컷 표시 중`;
    }
  }

  // 필름 type 문자열을 4개 카테고리로 매핑
  function filmTypeCategory(typeStr) {
    const t = String(typeStr || '').toLowerCase();
    if (t.includes('tungsten') || t.includes('daylight') || t.includes('cinema') || t.includes('motion')) return 'cinema';
    if (t.includes('slide') || t.includes('e-6')) return 'slide';
    if (t.includes('black') || t.includes('white') || t.includes('b&w') || t.includes('bw')) return 'bw';
    if (t.includes('color')) return 'color';
    return '';
  }

  // submission 의 film 라벨을 filmsData 안에서 찾아 매칭. displayName/name/aliases 비교.
  function lookupFilmForSubmission(s) {
    const label = s && (s.film || s.filmName);
    if (!label || !filmsData) return null;
    const target = normalizeFilmLabel(label);
    if (!target) return null;
    for (const key of Object.keys(filmsData)) {
      const f = filmsData[key];
      if (!f) continue;
      const cands = [f.displayName, f.name, ...(f.aliases || [])].filter(Boolean);
      if (cands.some(c => normalizeFilmLabel(c) === target)) return f;
    }
    return null;
  }

  function normalizePhotoSearchHaystack(s) {
    if (!s) return '';
    const film = lookupFilmForSubmission(s);
    const parts = [
      s.film, s.author, s.submitterName, s.instagram, s.instagramUrl, s.camera, s.caption,
      film?.brand, film?.displayName, film?.name, film?.iso, film?.type,
    ];
    return parts.filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
  }

  function categoryOfSubmission(s) {
    const film = lookupFilmForSubmission(s);
    return film ? filmTypeCategory(film.type) : '';
  }

  function categoryCounts(pool) {
    const c = { all: pool.length, color: 0, bw: 0, slide: 0, cinema: 0 };
    for (const s of pool) {
      const cat = categoryOfSubmission(s);
      if (c[cat] !== undefined) c[cat]++;
    }
    return c;
  }

  function updateChipCounts(counts) {
    if (!libraryPhotosChipsEl) return;
    libraryPhotosChipsEl.querySelectorAll('.library-filter-count').forEach(el => {
      const k = el.dataset.count;
      el.textContent = (counts[k] || 0).toLocaleString('ko-KR');
    });
  }

  function applyPhotosFilter({ reshuffle = true } = {}) {
    if (!libraryPhotosGrid) return;
    let pool = photosPool;
    if (photosCategory !== 'all') pool = pool.filter(s => categoryOfSubmission(s) === photosCategory);
    if (photosQuery) pool = pool.filter(s => normalizePhotoSearchHaystack(s).includes(photosQuery));
    if (reshuffle) photosShuffled = shuffleInPlace(pool.slice());
    else photosShuffled = pool.slice();
    photosVisible = 0;
    libraryPhotosGrid.innerHTML = '';
    if (photosShuffled.length === 0) {
      const hasFilter = photosCategory !== 'all' || !!photosQuery;
      const isEmptyPool = photosPool.length === 0;
      libraryPhotosGrid.innerHTML = window.MagState
        ? window.MagState.empty({
            title: isEmptyPool ? '아직 등록된 사진이 없어요.' : '조건에 맞는 사진이 없어요.',
            desc: isEmptyPool ? '' : '검색어나 필터를 바꿔보세요.',
            actionLabel: hasFilter ? '전체 보기' : '',
            action: 'reset',
          })
        : '<p class="library-photos-empty">조건에 맞는 사진이 없어요.</p>';
      if (hasFilter) {
        window.MagState?.bindAction(libraryPhotosGrid, 'reset', () => {
          photosCategory = 'all';
          photosQuery = '';
          if (libraryPhotosSearchEl) libraryPhotosSearchEl.value = '';
          if (libraryPhotosChipsEl) {
            libraryPhotosChipsEl.querySelectorAll('.library-filter-chip').forEach(c => {
              const on = c.dataset.cat === 'all';
              c.classList.toggle('is-active', on);
              c.setAttribute('aria-selected', on ? 'true' : 'false');
            });
          }
          applyPhotosFilter({ reshuffle: false });
        });
      }
      if (libraryPhotosCount) libraryPhotosCount.textContent = '0컷';
      if (libraryPhotosMoreWrap) libraryPhotosMoreWrap.hidden = true;
      return;
    }
    renderLibraryPhotosBatch();
  }

  async function ensurePhotosShuffled({ force = false } = {}) {
    if (!libraryPhotosGrid) return;
    if (!force && photosPool.length > 0) {
      applyPhotosFilter({ reshuffle: true });
      return;
    }
    if (window.MagState) libraryPhotosGrid.innerHTML = window.MagState.loading({ count: 10, variant: 'square' });
    try {
      const submissions = await getApprovedSubmissions();
      photosPool = (submissions || []).filter(s => s && (s.image || s.src));
      updateChipCounts(categoryCounts(photosPool));
      applyPhotosFilter({ reshuffle: true });
    } catch (err) {
      console.warn('[films] photos view 로드 실패:', err);
      libraryPhotosGrid.innerHTML = window.MagState
        ? window.MagState.error({ title: '사진을 불러오지 못했어요.' })
        : '<p class="library-photos-empty">사진을 불러오지 못했어요.</p>';
      window.MagState?.bindAction(libraryPhotosGrid, 'retry', () => ensurePhotosShuffled({ force: true }));
      if (libraryPhotosCount) libraryPhotosCount.textContent = '';
    }
  }

  function updateLibraryViewToggleUI() {
    if (!libraryViewToggleEl) return;
    libraryViewToggleEl.querySelectorAll('.library-view-btn').forEach(btn => {
      const on = btn.dataset.view === libraryView;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function updateLibraryViewUrl() {
    try {
      const u = new URL(location.href);
      if (libraryView === 'photos') u.searchParams.set('view', 'photos');
      else u.searchParams.delete('view');
      history.replaceState(null, '', u.toString());
    } catch {}
  }

  async function setLibraryView(next) {
    if (next !== 'photos') next = 'films';
    if (next === libraryView) return;
    libraryView = next;
    if (libraryFilmsView)  libraryFilmsView.hidden  = (next !== 'films');
    if (libraryPhotosView) libraryPhotosView.hidden = (next !== 'photos');
    updateLibraryViewToggleUI();
    updateLibraryViewUrl();
    if (next === 'photos') {
      if (libraryPhotosCount && photosShuffled.length === 0) {
        libraryPhotosCount.textContent = '불러오는 중…';
      }
      await ensurePhotosShuffled();
    }
  }

  function openPhotosLightboxAt(index) {
    if (!filmsLightbox || typeof filmsLightbox.openReader !== 'function') return;
    const photos = photosShuffled.map(toLightboxReaderPhoto);
    filmsLightbox.openReader(photos, index);
  }

  if (libraryViewToggleEl) {
    libraryViewToggleEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.library-view-btn');
      if (!btn) return;
      setLibraryView(btn.dataset.view);
    });
  }
  if (libraryPhotosMoreBtn) {
    libraryPhotosMoreBtn.addEventListener('click', () => renderLibraryPhotosBatch());
  }
  if (libraryPhotosShuffleBtn) {
    libraryPhotosShuffleBtn.addEventListener('click', () => {
      if (photosPool.length === 0) ensurePhotosShuffled({ force: true });
      else applyPhotosFilter({ reshuffle: true });
    });
  }
  if (libraryPhotosSearchEl) {
    let searchTimer = null;
    libraryPhotosSearchEl.addEventListener('input', () => {
      const raw = libraryPhotosSearchEl.value || '';
      const norm = raw.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
      if (norm === photosQuery) return;
      photosQuery = norm;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => applyPhotosFilter({ reshuffle: false }), 120);
    });
  }
  const photosSearchBar = document.getElementById('libraryPhotosSearchBar');
  const photosSearchBtn = document.getElementById('libraryPhotosSearchBtn');
  const photosSearchClose = document.getElementById('libraryPhotosSearchClose');
  photosSearchBtn?.addEventListener('click', () => {
    const open = photosSearchBar.hidden;
    photosSearchBar.hidden = !open;
    photosSearchBtn.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(() => libraryPhotosSearchEl?.focus(), 10);
  });
  photosSearchClose?.addEventListener('click', () => {
    photosSearchBar.hidden = true;
    photosSearchBtn?.setAttribute('aria-expanded', 'false');
    if (libraryPhotosSearchEl) {
      libraryPhotosSearchEl.value = '';
      photosQuery = '';
      applyPhotosFilter({ reshuffle: false });
    }
  });
  if (libraryPhotosChipsEl) {
    libraryPhotosChipsEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.library-filter-chip');
      if (!chip) return;
      const cat = chip.dataset.cat || 'all';
      if (cat === photosCategory) return;
      photosCategory = cat;
      libraryPhotosChipsEl.querySelectorAll('.library-filter-chip').forEach(c => {
        const on = c === chip;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      applyPhotosFilter({ reshuffle: false });
    });
  }
  if (libraryPhotosGrid) {
    libraryPhotosGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.library-photo-card');
      if (!card) return;
      const idx = parseInt(card.dataset.photoIndex, 10);
      if (Number.isFinite(idx)) openPhotosLightboxAt(idx);
    });
  }

  // 페이지 로드 시 URL ?view=photos 면 사진 스타일별 모드 진입
  try {
    if (new URL(location.href).searchParams.get('view') === 'photos') {
      setLibraryView('photos');
    }
  } catch {}
