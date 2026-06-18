// 5ft.mag Films card rendering
// Stateless card HTML builder. Page state is passed through options.

(function () {
  'use strict';

  const {
    escapeAttr,
    filterCategoryOf,
  } = window.FilmsUtils;

  function renderFilmCard(slug, film, context = 'library-grid', options = {}) {
    const rollLimit = options.rollLimit || 36;
    const filmFavSlugs = options.filmFavSlugs || new Set();
    const isLibrary = film.tier === 'library';
    const isFeatured = film.tier === 'featured';
    const isEditorialView = context === 'featured-grid' && isFeatured;
    const thumbField = isEditorialView ? 'boxThumbnail' : 'canThumbnail';
    const statusField = isEditorialView ? 'boxThumbnailStatus' : 'canThumbnailStatus';
    const thumbPath = film[thumbField];
    const hasThumb = film[statusField] === 'set' && thumbPath;

    let badgeHtml = '';
    if (isFeatured && film.issue) {
      badgeHtml = `<span class="film-issue-tag">${escapeAttr(film.issue)}</span>`;
    }

    let imgHtml = '';
    if (hasThumb) {
      const webp = thumbPath.replace(/\.(png|jpe?g)$/i, '.webp');
      imgHtml = `
        <picture>
          <source srcset="${escapeAttr(webp)}" type="image/webp">
          <img src="${escapeAttr(thumbPath)}" alt="${escapeAttr(film.displayName || film.name)}" />
        </picture>`;
    } else {
      imgHtml = `
        <div class="film-thumb-pending" role="img" aria-label="${escapeAttr(film.displayName || film.name)} 썸네일 준비 중">
          <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
            <rect x="14" y="8" width="36" height="44" rx="3" />
            <rect x="22" y="16" width="20" height="22" rx="1.5" class="film-thumb-pending-label" />
            <circle cx="32" cy="46" r="2.5" />
            <rect x="20" y="4" width="24" height="6" rx="1.2" />
          </svg>
          <span class="film-thumb-pending-brand">${escapeAttr(film.brand)}</span>
          <span class="film-thumb-pending-status">THUMBNAIL PENDING</span>
        </div>`;
    }

    let countLabel;
    let cta;
    if (isEditorialView) {
      const photoCount = film.photos?.length || 0;
      countLabel = `${photoCount} photos`;
      cta = '사진 보기 →';
    } else {
      const readerCount = 0;
      countLabel = `${readerCount} / ${rollLimit}`;
      cta = readerCount === 0 ? '첫 컷 채우기 →' : '컷 채우기 →';
    }
    const tierClass = isLibrary ? ' film-card-library' : '';

    const searchTokens = [
      film.brand, film.displayName, film.name, film.iso, film.type,
      ...(film.aliases || []), slug,
    ].filter(Boolean).join(' ').toLowerCase();

    const ctaIsUpload = context === 'library-grid';
    const ctaHtml = ctaIsUpload
      ? `<span class="film-cta film-cta-action" role="button" tabindex="0" data-action="open-submission" data-prefill-film="${escapeAttr(film.displayName || film.name)}">${cta}</span>`
      : `<span class="film-cta">${cta}</span>`;

    const isFav = filmFavSlugs.has(slug);
    const favHtml = `
      <span class="film-fav${isFav ? ' is-fav' : ''}" role="button" tabindex="0"
            data-action="toggle-film-fav" data-film-slug="${escapeAttr(slug)}"
            aria-pressed="${isFav}" aria-label="${isFav ? '즐겨찾기 해제' : '즐겨찾기 추가'}">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round"
                d="M12 21s-7.5-4.5-9.5-9.5C1 7.5 4 4.5 7.5 4.5c2 0 3.6 1 4.5 2.5.9-1.5 2.5-2.5 4.5-2.5 3.5 0 6.5 3 5 7-2 5-9.5 9.5-9.5 9.5z"/>
        </svg>
      </span>`;

    // "이 필름으로 쓴 글 N" 표시는 카드가 아니라 모달 desc 아래로 이전 (films-page.js).
    // 카드는 사진·이름 위주의 깔끔한 그리드로 유지.

    return `
      <button class="film-card${tierClass}" data-reveal data-film="${escapeAttr(slug)}" data-tier="${escapeAttr(film.tier)}" data-filter-category="${escapeAttr(filterCategoryOf(film))}" data-brand="${escapeAttr(film.brand || '')}" data-search="${escapeAttr(searchTokens)}">
        <div class="film-img">
          ${badgeHtml}
          ${favHtml}
          ${imgHtml}
          <span class="film-count">${countLabel}</span>
        </div>
        <span class="film-brand">${escapeAttr(film.brand)}</span>
        <h2 class="film-name">${escapeAttr(film.name)}</h2>
        <p class="film-spec"><span class="film-spec-main">ISO ${escapeAttr(film.iso)} · ${escapeAttr(film.type)}</span><span class="film-spec-format">${escapeAttr(film.format)}</span></p>
        ${ctaHtml}
      </button>`;
  }

  window.FilmsCards = {
    renderFilmCard,
  };
})();
