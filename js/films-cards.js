// 5ft.mag Films card rendering
// Stateless card HTML builder. Page state is passed through options.

(function () {
  'use strict';

  const {
    escapeAttr,
    filterCategoryOf,
  } = window.FilmsUtils;
  const i18n = window.i18n;
  const tr = i18n.t;

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
        <div class="film-thumb-pending" role="img" aria-label="${escapeAttr(tr(`${film.displayName || film.name} 썸네일 준비 중`, `${film.displayName || film.name} thumbnail coming soon`, `${film.displayName || film.name} のサムネイルは準備中`))}">
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
      cta = tr('사진 보기 →', 'View photos →', '写真を見る →');
    } else {
      const readerCount = 0;
      countLabel = `${readerCount} / ${rollLimit}`;
      cta = readerCount === 0 ? tr('첫 컷 채우기 →', 'Add the first frame →', '最初の1コマを投稿する →') : tr('컷 채우기 →', 'Add a frame →', '1コマ投稿する →');
    }
    const tierClass = isLibrary ? ' film-card-library' : '';

    const searchTokens = [
      film.brand, film.displayName, film.name, film.iso, film.type,
      ...(film.aliases || []), slug,
    ].filter(Boolean).join(' ').toLowerCase();

    // 투고 CTA 는 하트처럼 카드 링크 밖의 형제 버튼이다. 링크 안에는 같은 글자의 빈 자리
    // (.film-cta-slot, 보이지 않음)를 남겨 카드 높이를 그대로 두고, 버튼을 그 자리에 겹친다.
    const ctaIsUpload = context === 'library-grid';
    const ctaHtml = ctaIsUpload
      ? `<span class="film-cta film-cta-slot" aria-hidden="true">${cta}</span>`
      : `<span class="film-cta">${cta}</span>`;
    const ctaButtonHtml = ctaIsUpload
      ? `<button type="button" class="film-cta film-cta-action" data-action="open-submission" data-prefill-film="${escapeAttr(film.displayName || film.name)}">${cta}</button>`
      : '';

    // 하트는 카드 링크(<a>) 안이 아니라 형제 버튼이다. 안에 두면 버튼 안의 버튼이 되어
    // 키보드·스크린리더가 둘을 구분하지 못한다. 위치는 CSS 에서 절대 위치로 겹친다.
    const isFav = filmFavSlugs.has(slug);
    const favHtml = `
      <button type="button" class="film-fav${isFav ? ' is-fav' : ''}"
            data-action="toggle-film-fav" data-film-slug="${escapeAttr(slug)}"
            aria-pressed="${isFav}" aria-label="${isFav ? tr('즐겨찾기 해제', 'Remove from favorites', 'お気に入りから外す') : tr('즐겨찾기 추가', 'Add to favorites', 'お気に入りに追加')}">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round"
                d="M12 21s-7.5-4.5-9.5-9.5C1 7.5 4 4.5 7.5 4.5c2 0 3.6 1 4.5 2.5.9-1.5 2.5-2.5 4.5-2.5 3.5 0 6.5 3 5 7-2 5-9.5 9.5-9.5 9.5z"/>
        </svg>
      </button>`;

    // "이 필름으로 쓴 글 N" 표시는 카드가 아니라 모달 desc 아래로 이전 (films-page.js).
    // 카드는 사진·이름 위주의 깔끔한 그리드로 유지.

    const href = i18n.url(`/films.html?film=${encodeURIComponent(slug)}`);
    return `
      <div class="film-card${tierClass}" data-reveal data-film="${escapeAttr(slug)}" data-tier="${escapeAttr(film.tier)}" data-filter-category="${escapeAttr(filterCategoryOf(film))}" data-brand="${escapeAttr(film.brand || '')}" data-search="${escapeAttr(searchTokens)}">
        <a class="film-card-link" href="${escapeAttr(href)}">
          <div class="film-img">
            ${badgeHtml}
            ${imgHtml}
            <span class="film-count">${countLabel}</span>
          </div>
          <span class="film-brand">${escapeAttr(film.brand)}</span>
          <h2 class="film-name">${escapeAttr(film.name)}</h2>
          <p class="film-spec"><span class="film-spec-main">ISO ${escapeAttr(film.iso)} · ${escapeAttr(film.type)}</span><span class="film-spec-format">${escapeAttr(film.format)}</span></p>
          ${ctaHtml}
        </a>
        ${ctaButtonHtml}
        ${favHtml}
      </div>`;
  }

  window.FilmsCards = {
    renderFilmCard,
  };
})();
