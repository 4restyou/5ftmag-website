(function () {
  'use strict';

  const FILTER_LABELS = {
    all: '전체',
    color: '컬러',
    bw: '흑백',
    slide: '슬라이드',
    cinema: '영화용',
  };
  const MOBILE_LIBRARY_INITIAL = 30;
  const MOBILE_LIBRARY_STEP = 30;

  function normalizeSearch(value) {
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

  function create({
    filmsGridLibrary,
    escapeAttr,
    escapeHtml,
    filterCategoryOf,
    isMobileFilms,
  }) {
    let currentFilter = 'all';
    let currentBrands = new Set();
    const currentCameras = new Set();
    let currentSearch = '';
    let libraryMobileVisible = MOBILE_LIBRARY_INITIAL;
    const cameraKeysByFilmSlug = new Map();
    const cameraIndex = new Map();
    const cameraAliasMap = new Map();

    function hasActiveFilter() {
      return currentFilter !== 'all' ||
        currentBrands.size > 0 ||
        currentCameras.size > 0 ||
        currentSearch.trim() !== '';
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

    function resetMobileLimit() {
      libraryMobileVisible = MOBILE_LIBRARY_INITIAL;
    }

    function updateMoreButton(matchedCount) {
      const wrap = document.getElementById('libraryMoreWrap');
      const btn = document.getElementById('libraryMoreBtn');
      if (!wrap || !btn) return;
      const shouldPage = isMobileFilms() && !hasActiveFilter() && matchedCount > libraryMobileVisible;
      wrap.hidden = !shouldPage;
      if (!shouldPage) return;
      btn.textContent = `필름 더 보기 (${matchedCount - libraryMobileVisible})`;
    }

    function renderFilterChips(libraryFilms) {
      const filterBar = document.getElementById('libraryFilter');
      if (!filterBar) return;
      const counts = { all: libraryFilms.length };
      for (const [, film] of libraryFilms) {
        const cat = filterCategoryOf(film);
        counts[cat] = (counts[cat] || 0) + 1;
      }
      const order = ['all', 'color', 'bw', 'slide', 'cinema'];
      filterBar.innerHTML = order
        .filter(key => counts[key])
        .map(key => `
          <button type="button" class="ft-chip library-filter-chip${key === currentFilter ? ' is-active' : ''}"
                  data-filter="${key}" role="tab" aria-selected="${key === currentFilter}">
            ${FILTER_LABELS[key]}<span class="ft-chip-count library-filter-count">${counts[key]}</span>
          </button>
        `).join('');
      filterBar.querySelectorAll('.library-filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          currentFilter = chip.dataset.filter;
          resetMobileLimit();
          apply();
          filterBar.querySelectorAll('.library-filter-chip').forEach(nextChip => {
            const active = nextChip.dataset.filter === currentFilter;
            nextChip.classList.toggle('is-active', active);
            nextChip.setAttribute('aria-selected', active ? 'true' : 'false');
          });
        });
      });
    }

    function apply() {
      const q = normalizeSearch(currentSearch);
      const mobileCapped = isMobileFilms() && !hasActiveFilter();
      let matched = 0;
      if (!filmsGridLibrary) return;
      filmsGridLibrary.querySelectorAll('.film-card').forEach(card => {
        const cat = card.dataset.filterCategory;
        const brand = card.dataset.brand || '';
        const slug = card.dataset.film || '';
        const tokens = normalizeSearch(`${card.dataset.search || ''} ${card.dataset.readerSearch || ''}`);
        const matchCat = currentFilter === 'all' || cat === currentFilter;
        const matchBrand = currentBrands.size === 0 || currentBrands.has(brand);
        const cameraKeysForFilm = cameraKeysByFilmSlug.get(slug);
        const matchCamera = currentCameras.size === 0 ||
          (cameraKeysForFilm && [...currentCameras].some(key => cameraKeysForFilm.has(key)));
        const matchSearch = !q || tokens.includes(q);
        const matches = matchCat && matchBrand && matchCamera && matchSearch;
        const brandHit = !!q && normalizeSearch(brand).includes(q);
        card.classList.toggle('is-brand-hit', matches && brandHit);
        if (matches) matched++;
        card.hidden = !(matches && (!mobileCapped || matched <= libraryMobileVisible));
      });
      const emptyEl = document.getElementById('libraryEmpty');
      if (emptyEl) emptyEl.hidden = matched !== 0;
      updateMoreButton(matched);
      updateAdvancedFilterToggle();
    }

    function renderBrandSelect(libraryFilms) {
      const root = document.getElementById('libraryBrandMS');
      if (!root) return;
      const brands = new Set();
      for (const [, film] of libraryFilms) if (film.brand) brands.add(film.brand);
      const sorted = Array.from(brands).sort((a, b) => a.localeCompare(b, 'en'));
      for (const brand of [...currentBrands]) if (!brands.has(brand)) currentBrands.delete(brand);
      buildMultiselect(root, '브랜드', sorted.map(brand => ({ value: brand, label: brand })),
        () => currentBrands,
        (set) => {
          currentBrands = set;
          resetMobileLimit();
          apply();
        });
    }

    function rebuildCameraIndex(submissions, filmsBySlug) {
      cameraKeysByFilmSlug.clear();
      cameraIndex.clear();
      if (!Array.isArray(submissions) || !submissions.length) return;
      const normalize = window.normalizeFilmName
        || ((value) => String(value || '').toLowerCase().replace(/[\s\-_+()/.]+/g, ''));
      const slugAliases = new Map();
      for (const slug of Object.keys(filmsBySlug || {})) {
        const film = filmsBySlug[slug];
        const aliases = (film.aliases || []).concat([film.displayName, film.name]).filter(Boolean);
        slugAliases.set(slug, new Set(aliases.map(normalize)));
      }
      const buckets = new Map();
      for (const submission of submissions) {
        const cam = submission.camera || '';
        if (!cam.trim()) continue;
        const normalized = (typeof window.normalizeCamera === 'function')
          ? window.normalizeCamera(cam)
          : { key: cam.toLowerCase().replace(/\s+/g, ''), brand: null, original: cam };
        if (!normalized.key) continue;
        if (!buckets.has(normalized.key)) {
          buckets.set(normalized.key, { originals: [], brand: normalized.brand, slugSet: new Set() });
        }
        const bucket = buckets.get(normalized.key);
        bucket.originals.push(normalized.original);
        if (!bucket.brand && normalized.brand) bucket.brand = normalized.brand;
        const filmNorm = normalize(submission.film);
        for (const [slug, aliasSet] of slugAliases) {
          if (aliasSet.has(filmNorm)) {
            bucket.slugSet.add(slug);
            if (!cameraKeysByFilmSlug.has(slug)) cameraKeysByFilmSlug.set(slug, new Set());
            cameraKeysByFilmSlug.get(slug).add(normalized.key);
          }
        }
      }
      const pickDisplay = window.pickCameraDisplay || ((arr) => arr[0] || '');
      for (const [key, bucket] of buckets) {
        cameraIndex.set(key, {
          display: pickDisplay(bucket.originals),
          brand: bucket.brand,
          count: bucket.originals.length,
        });
      }
    }

    async function applyCameraOverrides() {
      cameraAliasMap.clear();
      if (!window.MagDB || !window.MagDB.isReady() || !window.MagDB.cameraOverrides) return;
      let overrides = null;
      try { overrides = await window.MagDB.cameraOverrides.list(); } catch (_) {}
      if (!overrides || !overrides.size) return;

      for (const [key, override] of overrides) {
        if (override.alias_of) cameraAliasMap.set(key, override.alias_of);
      }
      for (const [aliasKey, canonicalKey] of cameraAliasMap) {
        const alias = cameraIndex.get(aliasKey);
        if (!alias) continue;
        let canonical = cameraIndex.get(canonicalKey);
        if (!canonical) {
          canonical = { display: alias.display, brand: alias.brand, count: 0 };
          cameraIndex.set(canonicalKey, canonical);
        }
        canonical.count += alias.count || 0;
        cameraIndex.delete(aliasKey);
        for (const [, keys] of cameraKeysByFilmSlug) {
          if (keys.has(aliasKey)) {
            keys.delete(aliasKey);
            keys.add(canonicalKey);
          }
        }
      }
      for (const [key, info] of cameraIndex) {
        const override = overrides.get(key);
        if (override && !override.alias_of) {
          info.brand = override.brand;
          if (override.display) info.display = override.display;
        }
      }
    }

    function resolveCanonicalCameraKey(key) {
      return cameraAliasMap.get(key) || key;
    }

    function renderCameraSelect() {
      const root = document.getElementById('libraryCameraMS');
      if (!root) return;
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
      const options = [];
      for (const brand of sortedBrands) {
        const arr = byBrand.get(brand).sort((a, b) => a.display.localeCompare(b.display, 'en'));
        options.push({ groupLabel: brand });
        for (const camera of arr) options.push({ value: camera.key, label: camera.display, meta: String(camera.count) });
      }
      if (unknowns.length) {
        unknowns.sort((a, b) => a.display.localeCompare(b.display, 'en'));
        options.push({ groupLabel: '기타 (브랜드 미확인)' });
        for (const camera of unknowns) options.push({ value: camera.key, label: camera.display, meta: String(camera.count) });
      }
      for (const key of [...currentCameras]) if (!cameraIndex.has(key)) currentCameras.delete(key);
      buildMultiselect(root, '카메라', options,
        () => currentCameras,
        (set) => {
          currentCameras.clear();
          set.forEach(key => currentCameras.add(key));
          resetMobileLimit();
          apply();
        });
    }

    function buildMultiselect(root, labelPrefix, options, getSelected, onChange) {
      const btn = root.querySelector('.ms-dropdown-btn');
      const label = root.querySelector('.ms-dropdown-label');
      const panel = root.querySelector('.ms-dropdown-panel');
      if (!btn || !label || !panel) return;

      root._ms = { labelPrefix, options, getSelected, onChange };

      function refreshLabel() {
        const ctx = root._ms;
        const sel = ctx.getSelected();
        if (sel.size === 0) {
          label.textContent = `${ctx.labelPrefix} 전체`;
        } else if (sel.size === 1) {
          const value = [...sel][0];
          const opt = (ctx.options || []).find(option => option.value === value);
          label.textContent = (opt && opt.label) || value;
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
        const rows = opts.map(option => {
          if (option.groupLabel) {
            return `<div class="ms-dropdown-empty" style="padding:8px 14px 4px;font-weight:var(--fw-heading);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted)">${escapeHtml(option.groupLabel)}</div>`;
          }
          const checked = sel.has(option.value);
          return `<label class="ms-dropdown-option">
            <input type="checkbox" data-value="${escapeAttr(option.value)}" ${checked ? 'checked' : ''} />
            <span class="ms-opt-text">${escapeHtml(option.label)}</span>
            ${option.meta ? `<span class="ms-opt-meta">${escapeHtml(option.meta)}</span>` : ''}
          </label>`;
        }).join('');
        panel.innerHTML = clearBtn + (rows || `<div class="ms-dropdown-empty">옵션 없음</div>`);
        panel.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
          checkbox.addEventListener('change', () => {
            const ctx2 = root._ms;
            const value = checkbox.dataset.value;
            const next = new Set(ctx2.getSelected());
            if (checkbox.checked) next.add(value); else next.delete(value);
            ctx2.onChange(next);
            refreshLabel();
            const headLabel = panel.querySelector('.ms-dropdown-clear-label');
            const clearEl = panel.querySelector('[data-action="ms-clear"]');
            if (headLabel) headLabel.textContent = `${next.size}개 선택`;
            if (clearEl) clearEl.disabled = next.size === 0;
          });
        });
        const clearBtnEl = panel.querySelector('[data-action="ms-clear"]');
        if (clearBtnEl) clearBtnEl.addEventListener('click', (event) => {
          event.stopPropagation();
          root._ms.onChange(new Set());
          renderPanel();
          refreshLabel();
        });
      }

      if (!root.dataset.bound) {
        btn.addEventListener('click', (event) => {
          event.stopPropagation();
          const open = !root.classList.contains('is-open');
          document.querySelectorAll('.ms-dropdown.is-open').forEach(element => {
            if (element !== root) {
              element.classList.remove('is-open');
              element.querySelector('.ms-dropdown-btn')?.setAttribute('aria-expanded', 'false');
              const p = element.querySelector('.ms-dropdown-panel');
              if (p) p.hidden = true;
            }
          });
          root.classList.toggle('is-open', open);
          btn.setAttribute('aria-expanded', String(open));
          panel.hidden = !open;
          if (open) renderPanel();
        });
        document.addEventListener('click', (event) => {
          if (!root.contains(event.target) && root.classList.contains('is-open')) {
            root.classList.remove('is-open');
            btn.setAttribute('aria-expanded', 'false');
            panel.hidden = true;
          }
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape' && root.classList.contains('is-open')) {
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

    function bindControls() {
      const input = document.getElementById('librarySearch');
      if (input && !input.dataset.librarySearchBound) {
        let debounce = null;
        input.addEventListener('input', () => {
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            currentSearch = input.value;
            resetMobileLimit();
            apply();
          }, 120);
        });
        input.dataset.librarySearchBound = '1';
      }

      const advancedBtn = document.getElementById('libraryAdvancedToggle');
      const panel = document.getElementById('libraryAdvancedFilters');
      if (advancedBtn && panel && !advancedBtn.dataset.libraryAdvancedBound) {
        advancedBtn.addEventListener('click', () => {
          const open = !panel.classList.contains('is-open');
          panel.classList.toggle('is-open', open);
          advancedBtn.setAttribute('aria-expanded', String(open));
        });
        advancedBtn.dataset.libraryAdvancedBound = '1';
      }

      const moreBtn = document.getElementById('libraryMoreBtn');
      if (moreBtn && !moreBtn.dataset.libraryMoreBound) {
        moreBtn.addEventListener('click', () => {
          libraryMobileVisible += MOBILE_LIBRARY_STEP;
          apply();
        });
        moreBtn.dataset.libraryMoreBound = '1';
      }
    }

    function sortLibrary(entries, filmFavSlugs) {
      return entries.slice().sort((a, b) => {
        const fa = a[1], fb = b[1];
        const favA = filmFavSlugs.has(a[0]) ? 0 : 1;
        const favB = filmFavSlugs.has(b[0]) ? 0 : 1;
        if (favA !== favB) return favA - favB;
        const brandCompare = (fa.brand || '').localeCompare(fb.brand || '', 'ko');
        if (brandCompare !== 0) return brandCompare;
        const nameA = fa.displayName || fa.name || '';
        const nameB = fb.displayName || fb.name || '';
        return nameA.localeCompare(nameB, 'ko', { numeric: true });
      });
    }

    bindControls();

    return {
      cameraIndex,
      currentCameras,
      apply,
      applyCameraOverrides,
      normalizeSearch,
      readerSearchTokensForSubmission,
      rebuildCameraIndex,
      renderBrandSelect,
      renderCameraSelect,
      renderFilterChips,
      resolveCanonicalCameraKey,
      sortLibrary,
    };
  }

  window.FilmsLibraryFilters = {
    create,
    normalizeSearch,
    readerSearchTokensForSubmission,
  };
})();
