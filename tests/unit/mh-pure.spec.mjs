// js/mh-pure.js 단위 테스트.
// IIFE 안에서 (typeof window !== 'undefined') 체크로 브라우저/Node 둘 다 사용 가능.
// Node 환경에선 module.exports 로 노출되므로 require 로 가져옴.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

// js/mh-pure.js 를 cjs 로 평가 — module 객체를 직접 만들어 IIFE 안의 module.exports 를 잡음
const code = fs.readFileSync(path.resolve(process.cwd(), 'js/mh-pure.js'), 'utf8');
const mod = { exports: {} };
const fn = new Function('module', 'window', code);
fn(mod, undefined);
const MH = mod.exports;

describe('MHPure.shuffleInPlace', () => {
  it('returns same array (in-place)', () => {
    const arr = [1, 2, 3];
    expect(MH.shuffleInPlace(arr)).toBe(arr);
  });
  it('preserves length and elements (multiset)', () => {
    const arr = [1, 2, 3, 4, 5];
    MH.shuffleInPlace(arr);
    expect(arr.length).toBe(5);
    expect(arr.slice().sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it('empty array safe', () => {
    expect(MH.shuffleInPlace([])).toEqual([]);
  });
});

describe('MHPure.daysAgo', () => {
  it('returns 0 for now', () => {
    const now = new Date('2026-06-14T12:00:00Z').getTime();
    expect(MH.daysAgo('2026-06-14T12:00:00Z', now)).toBe(0);
  });
  it('returns positive integer for past', () => {
    const now = new Date('2026-06-14T12:00:00Z').getTime();
    expect(MH.daysAgo('2026-06-07T12:00:00Z', now)).toBe(7);
  });
  it('returns 999 for invalid input', () => {
    expect(MH.daysAgo()).toBe(999);
    expect(MH.daysAgo('not-a-date')).toBe(999);
    expect(MH.daysAgo(null)).toBe(999);
  });
});

describe('MHPure.filmAliasList', () => {
  it('combines name + displayName + aliases, dedupes', () => {
    const f = { name: 'Portra 400', displayName: 'Kodak Portra 400', aliases: ['Portra 400', 'PORTRA400'] };
    expect(MH.filmAliasList(f)).toEqual(['Portra 400', 'Kodak Portra 400', 'PORTRA400']);
  });
  it('handles missing fields', () => {
    expect(MH.filmAliasList({ name: 'X' })).toEqual(['X']);
    expect(MH.filmAliasList({})).toEqual([]);
    expect(MH.filmAliasList()).toEqual([]);
  });
});

describe('MHPure.contributorKeyOf', () => {
  it('prefers instagram, lowercased, no @', () => {
    expect(MH.contributorKeyOf({ instagram: '@5ft.magazine', submitterName: '박순렬', author: 'x' })).toBe('5ft.magazine');
  });
  it('falls back to submitterName', () => {
    expect(MH.contributorKeyOf({ submitterName: 'PARK Sunryeol' })).toBe('park sunryeol');
  });
  it('returns empty for empty inputs', () => {
    expect(MH.contributorKeyOf({})).toBe('');
    expect(MH.contributorKeyOf()).toBe('');
  });
});

describe('MHPure.categoryMatchesType', () => {
  it('all 은 항상 통과', () => {
    expect(MH.categoryMatchesType('all', '')).toBe(true);
    expect(MH.categoryMatchesType('all', 'color negative')).toBe(true);
  });
  it('color', () => {
    expect(MH.categoryMatchesType('color', 'Color Negative')).toBe(true);
    expect(MH.categoryMatchesType('color', 'B&W')).toBe(false);
  });
  it('bw 변종', () => {
    expect(MH.categoryMatchesType('bw', 'Black & White')).toBe(true);
    expect(MH.categoryMatchesType('bw', 'BW film')).toBe(true);
    expect(MH.categoryMatchesType('bw', 'monochrome')).toBe(true);
  });
  it('slide 변종', () => {
    expect(MH.categoryMatchesType('slide', 'E-6 Reversal Slide')).toBe(true);
    expect(MH.categoryMatchesType('slide', 'Reversal')).toBe(true);
  });
  it('cinema 변종', () => {
    expect(MH.categoryMatchesType('cinema', 'Tungsten 800T')).toBe(true);
    expect(MH.categoryMatchesType('cinema', 'Daylight Cinema')).toBe(true);
  });
});

describe('MHPure.brandFilter', () => {
  const films = [
    { brand: 'Kodak',    name: 'Portra 400', type: 'Color Negative' },
    { brand: 'Ilford',   name: 'HP5 Plus',   type: 'Black & White' },
    { brand: 'Cinestill', name: '800T',      type: 'Tungsten',     displayName: 'Cinestill 800T' },
  ];
  it('all + 빈 쿼리 → 모두 통과', () => {
    expect(films.filter(MH.brandFilter('', 'all')).length).toBe(3);
  });
  it('color 카테고리', () => {
    expect(films.filter(MH.brandFilter('', 'color')).map(f => f.name)).toEqual(['Portra 400']);
  });
  it('쿼리 매칭 (이름)', () => {
    expect(films.filter(MH.brandFilter('hp5', 'all')).map(f => f.name)).toEqual(['HP5 Plus']);
  });
  it('쿼리 매칭 (브랜드)', () => {
    expect(films.filter(MH.brandFilter('cinestill', 'all')).map(f => f.brand)).toEqual(['Cinestill']);
  });
  it('카테고리 + 쿼리 같이', () => {
    expect(films.filter(MH.brandFilter('800t', 'cinema')).length).toBe(1);
    expect(films.filter(MH.brandFilter('800t', 'color')).length).toBe(0);
  });
});

describe('MHPure.matchFilmByName + filmSlugByName', () => {
  const films = [
    { slug: 'portra-400', name: 'Portra 400', displayName: 'Kodak Portra 400', aliases: ['PORTRA400'] },
    { slug: 'hp5',        name: 'HP5 Plus',   displayName: 'Ilford HP5 Plus' },
  ];
  it('정확 일치', () => {
    expect(MH.filmSlugByName('Portra 400', films)).toBe('portra-400');
  });
  it('대소문자 무시 + 별칭', () => {
    expect(MH.filmSlugByName('portra400', films)).toBe('portra-400');
  });
  it('미일치는 빈 문자열', () => {
    expect(MH.filmSlugByName('Unknown Film', films)).toBe('');
    expect(MH.filmSlugByName('', films)).toBe('');
  });
});

describe('MHPure.photoMatchesCategory + photoMatchesQuery', () => {
  const films = [
    { name: 'Portra 400', type: 'Color Negative' },
    { name: 'HP5 Plus',   type: 'Black & White' },
  ];
  it('photo film 의 카테고리로 매칭', () => {
    expect(MH.photoMatchesCategory({ film: 'Portra 400' }, 'color', films)).toBe(true);
    expect(MH.photoMatchesCategory({ film: 'Portra 400' }, 'bw', films)).toBe(false);
    expect(MH.photoMatchesCategory({ film: 'HP5 Plus' }, 'bw', films)).toBe(true);
  });
  it('all 은 항상 통과', () => {
    expect(MH.photoMatchesCategory({ film: 'Unknown' }, 'all', films)).toBe(true);
  });
  it('photo film 못 찾으면 카테고리 매칭 실패', () => {
    expect(MH.photoMatchesCategory({ film: 'Unknown' }, 'color', films)).toBe(false);
  });
  it('photoMatchesQuery — film 이름에 포함되면 true', () => {
    expect(MH.photoMatchesQuery({ film: 'Portra 400' }, 'portra')).toBe(true);
    expect(MH.photoMatchesQuery({ film: 'HP5' }, 'portra')).toBe(false);
    expect(MH.photoMatchesQuery({ film: 'HP5' }, '')).toBe(true);
  });
});
