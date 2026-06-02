// 5ft.mag Films shared utilities
// Pure helpers only: no DOM mutation and no Supabase calls.

(function () {
  'use strict';

  const escapeAttr = window.MagUtil.escapeAttr;

  function normalizeFilmLabel(value) {
    return String(value ?? '').toLowerCase().replace(/[\s\-_+()/.]+/g, '');
  }

  function normalizeContributorKey(value) {
    return String(value ?? '').trim().replace(/^@/, '').toLowerCase();
  }

  function filterCategoryOf(film) {
    const type = String(film?.type || '').toLowerCase();
    if (type.includes('color negative')) return 'color';
    if (type.includes('black') || type.includes('white')) return 'bw';
    if (type.includes('slide') || type.includes('e-6') || type.includes('reversal')) return 'slide';
    if (type.includes('tungsten') || type.includes('daylight') || type.includes('cinema')) return 'cinema';
    return 'other';
  }

  function isMobileFilms() {
    return window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  }

  window.FilmsUtils = {
    escapeAttr,
    escapeHtml: escapeAttr,
    normalizeFilmLabel,
    normalizeContributorKey,
    filterCategoryOf,
    isMobileFilms,
  };
})();
