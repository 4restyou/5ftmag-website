// @vitest-environment jsdom
// '최근 사진 순' 정렬: 최근 사진이 올라온 필름이 앞, 사진이 없는 필름은 뒤에서 이름순.
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';

let sortLibrary;
beforeAll(() => {
  // films-library-filters.js 는 IIFE 로 window.FilmsLibraryFilters 를 단다. 필요한 DOM 없이 sortLibrary 만 쓴다.
  window.i18n = { t: (ko) => ko, url: (u) => u, lang: 'ko', isEn: false };
  new Function(fs.readFileSync('js/films-library-filters.js', 'utf8'))();
  ({ sortLibrary } = window.FilmsLibraryFilters.create({ filmsGridLibrary: document.createElement('div'), escapeAttr: String, escapeHtml: String, filterCategoryOf: () => 'color', isMobileFilms: () => false }));
});

describe('sortLibrary recent', () => {
  it('최근 사진 시각이 큰 필름부터, 사진 없는 필름은 이름순으로 뒤에', () => {
    const entries = [
      ['a', { brand: 'A', name: 'Old' }],
      ['b', { brand: 'B', name: 'None' }],
      ['c', { brand: 'C', name: 'New' }],
      ['d', { brand: 'A', name: 'Blank' }],
    ];
    const latestPhotos = new Map([['a', 1000], ['c', 5000]]);
    const out = sortLibrary(entries, new Set(), { mode: 'recent', latestPhotos }).map(([slug]) => slug);
    expect(out).toEqual(['c', 'a', 'd', 'b']);
  });
});
