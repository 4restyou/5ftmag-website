'use strict';
// 5ft.mag 모바일 홈의 순수 함수 모듈.
// mobile-home.js 의 IIFE 안에서 정의되던 알고리즘 로직 일부를 추출해
// window.MHPure 로 노출. DOM 의존 없이 입력 → 출력만 다루는 함수만 모음.
// 유닛 테스트(tests/unit/mh-pure.spec.mjs) 에서 직접 검증.

(function () {
  // 배열을 in-place Fisher-Yates 셔플
  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ISO 날짜 → 며칠 전 (실패 시 999)
  function daysAgo(iso, now = Date.now()) {
    if (!iso) return 999;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 999;
    return Math.floor((now - d.getTime()) / (1000 * 60 * 60 * 24));
  }

  // 필름의 모든 별칭 모음 (name + displayName + aliases 중복 제거)
  function filmAliasList(f) {
    const names = new Set();
    [f?.name, f?.displayName, ...(Array.isArray(f?.aliases) ? f.aliases : [])]
      .filter(Boolean).forEach(n => names.add(String(n)));
    return [...names];
  }

  // 사진 row 의 촬영자 식별 키 (instagram > submitterName > author 순)
  function contributorKeyOf(row) {
    return String(row?.instagram || row?.submitterName || row?.author || '')
      .trim().replace(/^@/, '').toLowerCase();
  }

  // 필름 카테고리 매칭 — t 는 f.type 의 lowercase
  function categoryMatchesType(category, t) {
    if (!category || category === 'all') return true;
    t = String(t || '').toLowerCase();
    if (category === 'color')  return t.includes('color');
    if (category === 'bw')     return t.includes('black') || t.includes('bw') || t.includes('mono');
    if (category === 'slide')  return t.includes('slide') || t.includes('e-6') || t.includes('reversal');
    if (category === 'cinema') return t.includes('tungsten') || t.includes('daylight') || t.includes('cinema');
    return true;
  }

  // 멀티 select 카테고리 — Set 또는 배열. 비어있거나 4종 모두 포함이면 "전체" 와 동의.
  // 하나라도 매칭되면 true (OR 의미).
  const ALL_CATEGORIES = ['color', 'bw', 'slide', 'cinema'];
  function categoriesMatchType(categories, t) {
    const arr = Array.isArray(categories) ? categories : [...(categories || [])];
    if (arr.length === 0 || arr.length >= ALL_CATEGORIES.length) return true;
    return arr.some(c => categoryMatchesType(c, t));
  }

  // 필름 검색·필터 factory — query + category(단일) 또는 categories(set/배열) 둘 다 허용.
  // 호환: 기존 (query, 'color') 도 동작. 신규 (query, ['color','bw']) / (query, new Set([...])).
  function brandFilter(query, category) {
    const q = (query || '').trim().toLowerCase();
    const useMulti = Array.isArray(category) || (category && typeof category === 'object' && typeof category.has === 'function');
    return (f) => {
      if (useMulti) {
        if (!categoriesMatchType(category, f?.type)) return false;
      } else if (!categoryMatchesType(category, f?.type)) return false;
      if (!q) return true;
      const hay = `${f.brand || ''} ${f.name || ''} ${f.displayName || ''} ${f.aliases?.join(' ') || ''}`.toLowerCase();
      return hay.includes(q);
    };
  }

  // 사진 row → 어울리는 필름 카탈로그 항목 찾기 (이름 정규화 매칭)
  function matchFilmByName(filmName, films) {
    const needle = String(filmName || '').toLowerCase().trim();
    if (!needle) return null;
    return films.find(x =>
      [x.name, x.displayName, ...(Array.isArray(x.aliases) ? x.aliases : [])]
        .filter(Boolean).map(n => String(n).toLowerCase().trim()).includes(needle)
    ) || null;
  }

  function filmSlugByName(filmName, films) {
    const hit = matchFilmByName(filmName, films);
    return hit ? (hit.slug || hit.id || '') : '';
  }

  function photoMatchesCategory(row, category, films) {
    if (!category || category === 'all') return true;
    const useMulti = Array.isArray(category) || (category && typeof category === 'object' && typeof category.has === 'function');
    if (useMulti) {
      const arr = Array.isArray(category) ? category : [...category];
      if (arr.length === 0 || arr.length >= ALL_CATEGORIES.length) return true;
    }
    const f = matchFilmByName(row?.film, films);
    if (!f) return false;
    return useMulti
      ? categoriesMatchType(category, f.type)
      : categoryMatchesType(category, f.type);
  }

  function photoMatchesQuery(row, q) {
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return true;
    return String(row?.film || '').toLowerCase().includes(needle);
  }

  const api = {
    shuffleInPlace, daysAgo, filmAliasList, contributorKeyOf,
    categoryMatchesType, categoriesMatchType, ALL_CATEGORIES,
    brandFilter, matchFilmByName, filmSlugByName,
    photoMatchesCategory, photoMatchesQuery,
  };

  // Browser: window.MHPure / Node (tests): export
  if (typeof window !== 'undefined') {
    window.MHPure = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
