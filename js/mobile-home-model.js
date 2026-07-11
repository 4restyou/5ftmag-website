// 모바일 홈의 최근 본 필름·추천 상태. DOM 렌더링과 저장 로직을 분리한다.
(function () {
  'use strict';

  function create({ getFilms, pickRecommendedFilms, onChange, key = '5ft-mh-recent', max = 8 }) {
    function getRecent() {
      try {
        const value = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(value) ? value.filter(Boolean) : [];
      } catch (_) {
        return [];
      }
    }

    function pushRecent(slug) {
      if (!slug) return;
      const next = getRecent().filter(item => item !== slug);
      next.unshift(slug);
      try { localStorage.setItem(key, JSON.stringify(next.slice(0, max))); } catch (_) {}
      try { window.MagDB?.personalization?.pushRecentFilm?.(slug); } catch (_) {}
      onChange?.();
    }

    function recentFilms() {
      const map = new Map(getFilms().map(film => [film.slug || film.id, film]));
      return getRecent().map(slug => map.get(slug)).filter(Boolean);
    }

    function recommendations(count = 3) {
      return pickRecommendedFilms(getFilms(), getRecent(), count);
    }

    return { getRecent, pushRecent, recentFilms, recommendations };
  }

  window.MobileHomeModel = { create };
})();
