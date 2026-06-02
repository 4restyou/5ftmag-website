  // 테마/메뉴는 js/site-common.js 에서 처리됨

  // ════════════════════════════
  // 필름 데이터: data/films.json에서 로딩 + 그리드 렌더링
  // ════════════════════════════
  let filmsData = {};
  const ROLL_LIMIT = 36;

  const filmsGridFeatured = document.getElementById('filmsGridFeatured');
  const filmsGridLibrary  = document.getElementById('filmsGridLibrary');

  const {
    escapeAttr,
    escapeHtml,
    normalizeFilmLabel,
    normalizeContributorKey,
    filterCategoryOf,
    isMobileFilms,
  } = window.FilmsUtils;
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

  const readerExport = window.FilmsReaderExport.create({
    getFilm: (filmKey) => filmsData[filmKey] || {},
    findFilmThumbByName,
    notify: window.notify,
  });

  const FILTER_LABELS = {
    all: '전체',
    color: 'Color',
    bw: 'B&W',
    slide: 'Slide',
    cinema: 'Cinema',
  };
  let currentFilter = 'all';
  // 다중 선택: 비어 있으면 "전체" 로 간주, 값 있으면 OR 매칭
  let currentBrands  = new Set();
  let currentCameras = new Set();   // 카메라 model key (브랜드 prefix 제거 후 정규화)
  let currentSearch = '';
  const MOBILE_LIBRARY_INITIAL = 30;
  const MOBILE_LIBRARY_STEP = 30;
  let libraryMobileVisible = MOBILE_LIBRARY_INITIAL;
  // slug → Set<cameraKey>  — 어떤 필름 카드가 현재 카메라 필터에 매칭되는지 빠르게 조회
  const cameraKeysByFilmSlug = new Map();
  // cameraKey → { display, brand, count } — 드롭다운 옵션 빌드용
  const cameraIndex = new Map();
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

  function hasActiveLibraryFilter() {
    return currentFilter !== 'all' ||
      currentBrands.size > 0 ||
      currentCameras.size > 0 ||
      currentSearch.trim() !== '';
  }

  function normalizeLibrarySearch(value) {
    return String(value || '').toLowerCase().replace(/@/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function readerSearchTokensForSubmission(submission) {
    const instagram = String(submission.instagram || '').trim();
    const instagramBare = instagram.replace(/^@+/, '');
    return [
      submission.submitterName,
      submission.author,
      instagram,
      instagramBare,
      submission.camera,
    ].filter(Boolean).join(' ');
  }

  function contributorKeyOfSubmission(submission = {}) {
    return normalizeContributorKey(submission.instagram || submission.submitterName || submission.author || '');
  }

  function contributorLabelOfSubmission(submission = {}) {
    return submission.submitterName || submission.author || submission.instagram || '이름 없음';
  }

  function activeAdvancedFilterCount() {
    return (currentFilter !== 'all' ? 1 : 0) + currentBrands.size + currentCameras.size;
  }

  function updateAdvancedFilterToggle() {
    const btn = document.getElementById('libraryAdvancedToggle');
    const panel = document.getElementById('libraryAdvancedFilters');
    if (!btn || !panel) return;
    const count = activeAdvancedFilterCount();
    btn.textContent = count > 0 ? `필터 ${count}` : '필터';
    btn.classList.toggle('has-active', count > 0);
    if (count > 0 && isMobileFilms()) {
      panel.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
    }
  }

  function resetMobileLibraryLimit() {
    libraryMobileVisible = MOBILE_LIBRARY_INITIAL;
  }

  function updateLibraryMoreButton(matchedCount) {
    const wrap = document.getElementById('libraryMoreWrap');
    const btn = document.getElementById('libraryMoreBtn');
    if (!wrap || !btn) return;
    const shouldPage = isMobileFilms() && !hasActiveLibraryFilter() && matchedCount > libraryMobileVisible;
    wrap.hidden = !shouldPage;
    if (!shouldPage) return;
    btn.textContent = `필름 더 보기 (${matchedCount - libraryMobileVisible})`;
  }

  function resolveFilmKey(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    if (filmsData[raw]) return raw;
    const q = normalizeFilmLabel(raw);
    for (const [slug, film] of Object.entries(filmsData || {})) {
      const aliases = (film.aliases || []).concat([film.displayName, film.name]).filter(Boolean);
      if (aliases.some(alias => normalizeFilmLabel(alias) === q)) return slug;
    }
    return '';
  }

  function renderLibraryFilterChips(libraryFilms) {
    const filterBar = document.getElementById('libraryFilter');
    if (!filterBar) return;
    // 사용 중인 카테고리 + 개수 집계
    const counts = { all: libraryFilms.length };
    for (const [, f] of libraryFilms) {
      const cat = filterCategoryOf(f);
      counts[cat] = (counts[cat] || 0) + 1;
    }
    const order = ['all', 'color', 'bw', 'slide', 'cinema'];
    filterBar.innerHTML = order
      .filter(k => counts[k])
      .map(k => `
        <button type="button" class="library-filter-chip${k === currentFilter ? ' is-active' : ''}"
                data-filter="${k}" role="tab" aria-selected="${k === currentFilter}">
          ${FILTER_LABELS[k]}<span class="library-filter-count">${counts[k]}</span>
        </button>
      `).join('');
    filterBar.querySelectorAll('.library-filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        currentFilter = chip.dataset.filter;
        resetMobileLibraryLimit();
        applyLibraryFilter();
        filterBar.querySelectorAll('.library-filter-chip').forEach(c => {
          const active = c.dataset.filter === currentFilter;
          c.classList.toggle('is-active', active);
          c.setAttribute('aria-selected', active ? 'true' : 'false');
        });
      });
    });
  }

  function applyLibraryFilter() {
    const q = normalizeLibrarySearch(currentSearch);
    const mobileCapped = isMobileFilms() && !hasActiveLibraryFilter();
    let matched = 0;
    let visible = 0;
    filmsGridLibrary.querySelectorAll('.film-card').forEach(card => {
      const cat = card.dataset.filterCategory;
      const brand = card.dataset.brand || '';
      const slug = card.dataset.film || '';
      const tokens = normalizeLibrarySearch(`${card.dataset.search || ''} ${card.dataset.readerSearch || ''}`);
      const matchCat    = currentFilter === 'all' || cat === currentFilter;
      const matchBrand  = currentBrands.size === 0 || currentBrands.has(brand);
      const cameraKeysForFilm = cameraKeysByFilmSlug.get(slug);
      const matchCamera = currentCameras.size === 0 ||
                          (cameraKeysForFilm && [...currentCameras].some(k => cameraKeysForFilm.has(k)));
      const matchSearch = !q || tokens.includes(q);
      const matches = matchCat && matchBrand && matchCamera && matchSearch;
      if (matches) matched++;
      const show = matches && (!mobileCapped || matched <= libraryMobileVisible);
      card.hidden = !show;
      if (show) visible++;
    });
    const emptyEl = document.getElementById('libraryEmpty');
    if (emptyEl) emptyEl.hidden = matched !== 0;
    updateLibraryMoreButton(matched);
    updateAdvancedFilterToggle();
  }

  // 브랜드 dropdown 옵션 빌드 — 다중 선택 체크박스
  function renderLibraryBrandSelect(libraryFilms) {
    const root = document.getElementById('libraryBrandMS');
    if (!root) return;
    const brands = new Set();
    for (const [, f] of libraryFilms) if (f.brand) brands.add(f.brand);
    const sorted = Array.from(brands).sort((a, b) => a.localeCompare(b, 'en'));
    // 존재하지 않는 brand 가 currentBrands 에 있으면 정리
    for (const b of [...currentBrands]) if (!brands.has(b)) currentBrands.delete(b);
    buildMultiselect(root, '브랜드', sorted.map(b => ({ value: b, label: b })),
      () => currentBrands,
      (set) => { currentBrands = set; resetMobileLibraryLimit(); applyLibraryFilter(); });
  }

  // 카메라 드롭다운 — reader_submissions 의 카메라 컬럼 집계
  //   1) 모든 승인된 제출을 normalizeCamera 로 그룹화 (model key 기준)
  //   2) 같은 model key 내에서 가장 자주 쓰인 원본 표기를 display 로 채택
  //   3) brand 가 인식되면 '브랜드 — 모델' 형식으로 가독성 보강
  //   4) 사전에 없는 브랜드는 optgroup 으로 분리 → 편집부가 사전에 추가하면 됨
  function rebuildCameraIndex(submissions, filmsBySlug) {
    cameraKeysByFilmSlug.clear();
    cameraIndex.clear();
    if (!Array.isArray(submissions) || !submissions.length) return;
    const normalize = window.normalizeFilmName
      || ((s) => String(s || '').toLowerCase().replace(/[\s\-_+()/.]+/g, ''));
    // 미리 슬러그별 alias set 만들어두기 (반복 매칭 절약)
    const slugAliases = new Map();
    for (const slug of Object.keys(filmsBySlug || {})) {
      const f = filmsBySlug[slug];
      const aliases = (f.aliases || []).concat([f.displayName, f.name]).filter(Boolean);
      slugAliases.set(slug, new Set(aliases.map(normalize)));
    }
    // model key → { originals: [], brand, slugSet }
    const buckets = new Map();
    for (const s of submissions) {
      const cam = s.camera || '';
      if (!cam.trim()) continue;
      const n = (typeof window.normalizeCamera === 'function')
        ? window.normalizeCamera(cam)
        : { key: cam.toLowerCase().replace(/\s+/g, ''), brand: null, original: cam };
      if (!n.key) continue;
      if (!buckets.has(n.key)) buckets.set(n.key, { originals: [], brand: n.brand, slugSet: new Set() });
      const b = buckets.get(n.key);
      b.originals.push(n.original);
      if (!b.brand && n.brand) b.brand = n.brand;
      // 이 사진이 매핑되는 필름 slug 찾기 — 카드 노출 조건에 사용
      const filmNorm = normalize(s.film);
      for (const [slug, aliasSet] of slugAliases) {
        if (aliasSet.has(filmNorm)) {
          b.slugSet.add(slug);
          if (!cameraKeysByFilmSlug.has(slug)) cameraKeysByFilmSlug.set(slug, new Set());
          cameraKeysByFilmSlug.get(slug).add(n.key);
        }
      }
    }
    // display 결정 + 노출 카운트
    const pickDisplay = window.pickCameraDisplay || ((arr) => arr[0] || '');
    for (const [key, b] of buckets) {
      cameraIndex.set(key, {
        display: pickDisplay(b.originals),
        brand: b.brand,
        count: b.originals.length,
      });
    }
  }

  // DB 의 camera_brand_overrides 적용 — 정적 사전이 못 잡은 모델의 브랜드를
  // 편집부가 admin 페이지에서 지정한 값으로 덮어씀.
  // alias_of 가 설정된 행은 그 모델을 다른 canonical 모델로 병합.
  const cameraAliasMap = new Map(); // aliasKey → canonicalKey (필터/모달에서 참조)
  async function applyCameraOverrides() {
    cameraAliasMap.clear();
    if (!window.MagDB || !window.MagDB.isReady() || !window.MagDB.cameraOverrides) return;
    let overrides = null;
    try { overrides = await window.MagDB.cameraOverrides.list(); } catch (_) {}
    if (!overrides || !overrides.size) return;

    // 1) 별칭 매핑 먼저 수집
    for (const [k, o] of overrides) {
      if (o.alias_of) cameraAliasMap.set(k, o.alias_of);
    }
    // 2) cameraIndex 에서 alias 항목을 canonical 항목에 병합
    for (const [aliasKey, canonicalKey] of cameraAliasMap) {
      const alias = cameraIndex.get(aliasKey);
      if (!alias) continue;
      let canonical = cameraIndex.get(canonicalKey);
      if (!canonical) {
        // canonical 이 아직 cameraIndex 에 없는 경우 — alias 자료로 신규 entry 만들기
        canonical = { display: alias.display, brand: alias.brand, count: 0 };
        cameraIndex.set(canonicalKey, canonical);
      }
      canonical.count += alias.count || 0;
      cameraIndex.delete(aliasKey);
      // 카드별 필름 슬러그 집합도 alias → canonical 로 redirect
      for (const [slug, keys] of cameraKeysByFilmSlug) {
        if (keys.has(aliasKey)) {
          keys.delete(aliasKey);
          keys.add(canonicalKey);
        }
      }
    }
    // 3) 일반 brand/display 오버라이드 적용
    for (const [key, info] of cameraIndex) {
      const o = overrides.get(key);
      if (o && !o.alias_of) {
        info.brand = o.brand;
        if (o.display) info.display = o.display;
      }
    }
  }
  // 외부에서 사용할 alias 해소 헬퍼
  function resolveCanonicalCameraKey(key) {
    return cameraAliasMap.get(key) || key;
  }

  function renderLibraryCameraSelect() {
    const root = document.getElementById('libraryCameraMS');
    if (!root) return;
    // 브랜드 별 그룹화 + 미인식 카메라 — 알파벳 정렬
    const byBrand = new Map();
    const unknowns = [];
    for (const [key, info] of cameraIndex) {
      if (info.brand) {
        if (!byBrand.has(info.brand)) byBrand.set(info.brand, []);
        byBrand.get(info.brand).push({ key, ...info });
      } else {
        unknowns.push({ key, ...info });
      }
    }
    const sortedBrands = Array.from(byBrand.keys()).sort((a, b) => a.localeCompare(b, 'en'));
    // 옵션 평면화 — 브랜드 헤더 텍스트는 dropdown panel 내부에서 처리 (group separator)
    const options = [];
    for (const brand of sortedBrands) {
      const arr = byBrand.get(brand).sort((a, b) => a.display.localeCompare(b.display, 'en'));
      options.push({ groupLabel: brand });
      for (const c of arr) options.push({ value: c.key, label: c.display, meta: String(c.count) });
    }
    if (unknowns.length) {
      unknowns.sort((a, b) => a.display.localeCompare(b.display, 'en'));
      options.push({ groupLabel: '기타 (브랜드 미확인)' });
      for (const c of unknowns) options.push({ value: c.key, label: c.display, meta: String(c.count) });
    }
    // 사라진 카메라는 제거
    for (const k of [...currentCameras]) if (!cameraIndex.has(k)) currentCameras.delete(k);
    buildMultiselect(root, '카메라', options,
      () => currentCameras,
      (set) => { currentCameras = set; resetMobileLibraryLimit(); applyLibraryFilter(); });
  }

  // 공통 다중 선택 dropdown 빌더
  //   options: [{ value, label, meta? } | { groupLabel }]
  //   getSelected: () => Set<string>
  //   onChange: (Set<string>) => void
  function buildMultiselect(root, labelPrefix, options, getSelected, onChange) {
    const btn   = root.querySelector('.ms-dropdown-btn');
    const label = root.querySelector('.ms-dropdown-label');
    const panel = root.querySelector('.ms-dropdown-panel');
    if (!btn || !label || !panel) return;

    // 재호출시 최신 options/getSelected/onChange/labelPrefix 가 click handler 에서 보이도록
    // 클로저 대신 root 에 저장한다. listener 는 한 번만 wiring.
    root._ms = { labelPrefix, options, getSelected, onChange };

    function refreshLabel() {
      const ctx = root._ms;
      const sel = ctx.getSelected();
      if (sel.size === 0) {
        label.textContent = `${ctx.labelPrefix} 전체`;
      } else if (sel.size === 1) {
        const v = [...sel][0];
        const opt = (ctx.options || []).find(o => o.value === v);
        label.textContent = (opt && opt.label) || v;
      } else {
        label.innerHTML = `${escapeHtml(ctx.labelPrefix)} <span class="ms-count">${sel.size}</span>`;
      }
    }

    function renderPanel() {
      const ctx = root._ms;
      const opts = ctx.options || [];
      const sel = ctx.getSelected();
      const clearBtn = `<div class="ms-dropdown-panel-head">
        <span class="ms-dropdown-clear-label" style="font-size:11px;color:var(--text-muted);letter-spacing:0.06em">${sel.size}개 선택</span>
        <button type="button" class="ms-dropdown-clear" data-action="ms-clear" ${sel.size === 0 ? 'disabled' : ''}>전체 해제</button>
      </div>`;
      const rows = opts.map(o => {
        if (o.groupLabel) {
          return `<div class="ms-dropdown-empty" style="padding:8px 14px 4px;font-weight:var(--fw-heading);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted)">${escapeHtml(o.groupLabel)}</div>`;
        }
        const checked = sel.has(o.value);
        return `<label class="ms-dropdown-option">
          <input type="checkbox" data-value="${escapeAttr(o.value)}" ${checked ? 'checked' : ''} />
          <span class="ms-opt-text">${escapeHtml(o.label)}</span>
          ${o.meta ? `<span class="ms-opt-meta">${escapeHtml(o.meta)}</span>` : ''}
        </label>`;
      }).join('');
      panel.innerHTML = clearBtn + (rows || `<div class="ms-dropdown-empty">옵션 없음</div>`);
      panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', (e) => {
          const ctx2 = root._ms;
          const v = cb.dataset.value;
          const next = new Set(ctx2.getSelected());
          if (cb.checked) next.add(v); else next.delete(v);
          ctx2.onChange(next);
          refreshLabel();
          // panel 헤더의 카운트·전체 해제 버튼 disabled 상태 즉시 갱신
          const headLabel = panel.querySelector('.ms-dropdown-clear-label');
          const clearEl = panel.querySelector('[data-action="ms-clear"]');
          if (headLabel) headLabel.textContent = `${next.size}개 선택`;
          if (clearEl) clearEl.disabled = next.size === 0;
        });
      });
      const clearBtnEl = panel.querySelector('[data-action="ms-clear"]');
      if (clearBtnEl) clearBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        root._ms.onChange(new Set());
        renderPanel();
        refreshLabel();
      });
    }

    // 첫 wiring 한 번만
    if (!root.dataset.bound) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !root.classList.contains('is-open');
        // 다른 dropdown 닫기
        document.querySelectorAll('.ms-dropdown.is-open').forEach(el => {
          if (el !== root) {
            el.classList.remove('is-open');
            el.querySelector('.ms-dropdown-btn')?.setAttribute('aria-expanded', 'false');
            const p = el.querySelector('.ms-dropdown-panel'); if (p) p.hidden = true;
          }
        });
        root.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', String(open));
        panel.hidden = !open;
        if (open) renderPanel();
      });
      document.addEventListener('click', (e) => {
        if (!root.contains(e.target) && root.classList.contains('is-open')) {
          root.classList.remove('is-open');
          btn.setAttribute('aria-expanded', 'false');
          panel.hidden = true;
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && root.classList.contains('is-open')) {
          root.classList.remove('is-open');
          btn.setAttribute('aria-expanded', 'false');
          panel.hidden = true;
        }
      });
      root.dataset.bound = '1';
    }
    refreshLabel();
    if (!panel.hidden) renderPanel();
  }

  // 검색 입력 핸들러 (페이지 로드 직후 한 번 wiring)
  (function bindLibrarySearch() {
    const input = document.getElementById('librarySearch');
    if (!input) return;
    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        currentSearch = input.value;
        resetMobileLibraryLimit();
        applyLibraryFilter();
      }, 120);
    });
  })();

  (function bindLibraryAdvancedToggle() {
    const btn = document.getElementById('libraryAdvancedToggle');
    const panel = document.getElementById('libraryAdvancedFilters');
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
      const open = !panel.classList.contains('is-open');
      panel.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
  })();

  (function bindLibraryMore() {
    const btn = document.getElementById('libraryMoreBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      libraryMobileVisible += MOBILE_LIBRARY_STEP;
      applyLibraryFilter();
    });
  })();

  // Library 정렬: 좋아요한 필름 먼저 → 브랜드 알파벳 → displayName 알파벳
  // (Featured 는 매거진 발행 순서가 의미 있으므로 정렬하지 않음)
  function sortLibrary(entries) {
    return entries.slice().sort((a, b) => {
      const fa = a[1], fb = b[1];
      const favA = filmFavSlugs.has(a[0]) ? 0 : 1;
      const favB = filmFavSlugs.has(b[0]) ? 0 : 1;
      if (favA !== favB) return favA - favB;
      const bc = (fa.brand || '').localeCompare(fb.brand || '', 'ko');
      if (bc !== 0) return bc;
      const na = fa.displayName || fa.name || '';
      const nb = fb.displayName || fb.name || '';
      return na.localeCompare(nb, 'ko', { numeric: true });
    });
  }

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

  // 필름 카탈로그 — Supabase 직접 fetch (admin/films 변경 즉시 반영).
  // DB 가 일시 down 일 때 정적 data/films.json 으로 fallback.
  (async () => {
    try {
      for (let i = 0; i < 60; i++) {
        if (window.MagDB && window.MagDB.isReady()) break;
        await new Promise(r => setTimeout(r, 50));
      }
      let data = null;
      if (window.MagDB && window.MagDB.isReady() && window.MagDB.films?.listAsObject) {
        try {
          const obj = await window.MagDB.films.listAsObject();
          if (obj && Object.keys(obj).length) data = obj;
        } catch (err) {
          console.warn('[films] DB catalog fallback:', err?.message || err);
        }
      }
      if (!data) {
        const res = await fetch('data/films.json');
        data = await res.json();
      } else {
        // DB 에는 없지만 data/films.json 에 등록된 slug 를 보강.
        // (신규 항목을 admin/films 로 DB 에 옮기기 전까지 정적 JSON 으로 노출)
        try {
          const staticRes = await fetch('data/films.json');
          const staticObj = await staticRes.json();
          let supplemented = 0;
          for (const [slug, entry] of Object.entries(staticObj || {})) {
            if (!data[slug]) { data[slug] = entry; supplemented++; }
          }
          if (supplemented) {
            console.info('[films] supplemented from static JSON:', supplemented);
          }
        } catch (_) { /* 정적 JSON 실패는 무시 */ }
      }
      filmsData = data;
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
            <div class="reader-roll-switcher" id="readerRollSwitcher-${filmKey}" hidden></div>
            <div class="reader-person-filter" id="readerPersonFilter-${filmKey}" hidden></div>
          </div>
          <div class="modal-section-actions reader-roll-view-actions">
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
  function toLightboxReaderPhoto(item = {}) {
    return {
      src: item.image || item.src,
      webp: item.webp || item.image || item.src,
      author: item.author || item.submitterName || '',
      instagram: item.instagram || '',
      film: item.film || '',
      camera: item.camera || '',
      caption: item.caption || '',
      instagramUrl: item.instagramUrl || '',
      contributorKey: item.contributorKey || contributorKeyOfSubmission(item),
      submissionId: typeof item.id === 'string' ? item.id.replace(/^sub-/, '') : (item.submissionId || ''),
      _source: 'reader',
    };
  }

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
