// window.FilmsUtils 단위 테스트.
// films-utils.js 는 IIFE 안에 window.FilmsUtils 를 노출시키는 클라 모듈이라
// jsdom 환경의 globalThis.window 에 그대로 실행시켜 사용.
// 의존하는 window.MagUtil 은 util.js 를 먼저 로드해서 채워둔다.

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

beforeAll(() => {
  const utilCode  = fs.readFileSync(path.resolve(process.cwd(), 'js/util.js'), 'utf8');
  const filmsCode = fs.readFileSync(path.resolve(process.cwd(), 'js/films-utils.js'), 'utf8');
  // eslint-disable-next-line no-eval
  (0, eval)(utilCode);
  // eslint-disable-next-line no-eval
  (0, eval)(filmsCode);
});

describe('window.FilmsUtils.contributorKeyOfSubmission', () => {
  it('uses instagram first, normalized', () => {
    expect(window.FilmsUtils.contributorKeyOfSubmission({
      instagram: '@5ft.magazine',
      submitterName: '박순렬',
      author: 'shouldnt-show',
    })).toBe('5ft.magazine');
  });

  it('falls back to submitterName when instagram is missing', () => {
    expect(window.FilmsUtils.contributorKeyOfSubmission({
      submitterName: '박순렬',
      author: 'fallback',
    })).toBe('박순렬');
  });

  it('falls back to author when both instagram and submitterName are missing', () => {
    expect(window.FilmsUtils.contributorKeyOfSubmission({
      author: 'Park',
    })).toBe('park');
  });

  it('returns empty string for empty / missing submission', () => {
    expect(window.FilmsUtils.contributorKeyOfSubmission({})).toBe('');
    expect(window.FilmsUtils.contributorKeyOfSubmission()).toBe('');
    expect(window.FilmsUtils.contributorKeyOfSubmission(null)).toBe('');
  });

  it('strips leading @ and lowercases', () => {
    expect(window.FilmsUtils.contributorKeyOfSubmission({ instagram: '@Mixed.Case' }))
      .toBe('mixed.case');
  });
});

describe('window.FilmsUtils.contributorLabelOfSubmission', () => {
  it('prefers submitterName over author and instagram', () => {
    expect(window.FilmsUtils.contributorLabelOfSubmission({
      submitterName: '박순렬',
      author: 'park',
      instagram: '@5ft.magazine',
    })).toBe('박순렬');
  });

  it('falls back to author then instagram', () => {
    expect(window.FilmsUtils.contributorLabelOfSubmission({
      author: 'park',
      instagram: '@5ft.magazine',
    })).toBe('park');
    expect(window.FilmsUtils.contributorLabelOfSubmission({
      instagram: '@5ft.magazine',
    })).toBe('@5ft.magazine');
  });

  it('returns "이름 없음" placeholder for empty submission', () => {
    expect(window.FilmsUtils.contributorLabelOfSubmission({})).toBe('이름 없음');
    expect(window.FilmsUtils.contributorLabelOfSubmission()).toBe('이름 없음');
    expect(window.FilmsUtils.contributorLabelOfSubmission(null)).toBe('이름 없음');
  });

  it('does NOT strip @ from instagram in display label', () => {
    // 라벨은 표시용이라 instagram handle 의 @ 가 그대로 남아야 함
    // (key 만 normalize, 라벨은 원형 유지)
    expect(window.FilmsUtils.contributorLabelOfSubmission({ instagram: '@handle' }))
      .toBe('@handle');
  });
});

describe('window.FilmsUtils.resolveFilmKey', () => {
  const filmsData = {
    'portra-400': {
      name: 'Portra 400',
      displayName: 'Kodak Portra 400',
      aliases: ['Portra400', 'PORTRA 400'],
    },
    'tri-x-400': {
      name: 'Tri-X 400',
      displayName: 'Kodak Tri-X 400',
      aliases: ['TriX 400'],
    },
    'cinestill-800t': {
      name: 'CineStill 800T',
      displayName: 'CineStill 800T',
      // aliases 없는 경우 — name/displayName 만으로 매칭
    },
  };

  it('returns slug as-is when input already matches a slug', () => {
    expect(window.FilmsUtils.resolveFilmKey('portra-400', filmsData)).toBe('portra-400');
  });

  it('resolves by displayName / name alias', () => {
    expect(window.FilmsUtils.resolveFilmKey('Kodak Portra 400', filmsData)).toBe('portra-400');
    expect(window.FilmsUtils.resolveFilmKey('Portra 400', filmsData)).toBe('portra-400');
    expect(window.FilmsUtils.resolveFilmKey('Tri-X 400', filmsData)).toBe('tri-x-400');
  });

  it('resolves alias entries with separator differences', () => {
    // normalizeFilmLabel 이 공백/하이픈/언더스코어를 제거하므로 동치
    expect(window.FilmsUtils.resolveFilmKey('PORTRA-400', filmsData)).toBe('portra-400');
    expect(window.FilmsUtils.resolveFilmKey('portra_400', filmsData)).toBe('portra-400');
    expect(window.FilmsUtils.resolveFilmKey('  Portra  400  ', filmsData)).toBe('portra-400');
  });

  it('matches when only name/displayName are present (no aliases array)', () => {
    expect(window.FilmsUtils.resolveFilmKey('cinestill 800t', filmsData)).toBe('cinestill-800t');
    expect(window.FilmsUtils.resolveFilmKey('CineStill800T', filmsData)).toBe('cinestill-800t');
  });

  it('returns empty string when no match is found', () => {
    expect(window.FilmsUtils.resolveFilmKey('Velvia 50', filmsData)).toBe('');
    expect(window.FilmsUtils.resolveFilmKey('unknown-stock', filmsData)).toBe('');
  });

  it('returns empty string for empty / nullish input', () => {
    expect(window.FilmsUtils.resolveFilmKey('', filmsData)).toBe('');
    expect(window.FilmsUtils.resolveFilmKey(null, filmsData)).toBe('');
    expect(window.FilmsUtils.resolveFilmKey(undefined, filmsData)).toBe('');
    expect(window.FilmsUtils.resolveFilmKey('   ', filmsData)).toBe('');
  });

  it('returns empty string when filmsData is missing or empty', () => {
    expect(window.FilmsUtils.resolveFilmKey('Portra 400', {})).toBe('');
    expect(window.FilmsUtils.resolveFilmKey('Portra 400', undefined)).toBe('');
    expect(window.FilmsUtils.resolveFilmKey('Portra 400', null)).toBe('');
  });

  it('survives film entries with missing name/displayName/aliases', () => {
    const sparse = {
      'mystery': {},
      'portra-400': { name: 'Portra 400' },
    };
    expect(window.FilmsUtils.resolveFilmKey('Portra 400', sparse)).toBe('portra-400');
    // 첫 슬러그가 빈 객체여도 throw 하지 않고 다음 항목으로 진행
    expect(window.FilmsUtils.resolveFilmKey('mystery', sparse)).toBe('mystery');
  });
});

describe('window.FilmsUtils.toLightboxReaderPhoto', () => {
  it('maps a full submission to the lightbox shape', () => {
    const out = window.FilmsUtils.toLightboxReaderPhoto({
      id: 'sub-abc123',
      image: 'https://cdn/photo.jpg',
      webp: 'https://cdn/photo.webp',
      author: '박순렬',
      submitterName: '박순렬',
      instagram: '@5ft.magazine',
      film: 'Portra 400',
      camera: 'Leica M6',
      caption: '광주 충장로',
      instagramUrl: 'https://instagram.com/5ft.magazine',
    });
    expect(out).toEqual({
      src: 'https://cdn/photo.jpg',
      webp: 'https://cdn/photo.webp',
      author: '박순렬',
      instagram: '@5ft.magazine',
      film: 'Portra 400',
      camera: 'Leica M6',
      caption: '광주 충장로',
      instagramUrl: 'https://instagram.com/5ft.magazine',
      contributorKey: '5ft.magazine',
      submissionId: 'abc123',
      _source: 'reader',
    });
  });

  it('falls back webp to image, image to src', () => {
    expect(window.FilmsUtils.toLightboxReaderPhoto({ src: 'fallback.jpg' }))
      .toMatchObject({ src: 'fallback.jpg', webp: 'fallback.jpg' });
    expect(window.FilmsUtils.toLightboxReaderPhoto({ image: 'i.jpg' }))
      .toMatchObject({ src: 'i.jpg', webp: 'i.jpg' });
  });

  it('strips the sub- prefix from submissionId', () => {
    expect(window.FilmsUtils.toLightboxReaderPhoto({ id: 'sub-xyz' }).submissionId).toBe('xyz');
    // prefix 없는 id 는 그대로 사용
    expect(window.FilmsUtils.toLightboxReaderPhoto({ id: 'raw-uuid' }).submissionId).toBe('raw-uuid');
  });

  it('prefers explicit submissionId over id when id is non-string', () => {
    expect(window.FilmsUtils.toLightboxReaderPhoto({ id: 42, submissionId: 'real-id' }).submissionId)
      .toBe('real-id');
  });

  it('honors a pre-resolved contributorKey', () => {
    const out = window.FilmsUtils.toLightboxReaderPhoto({
      contributorKey: 'precomputed',
      instagram: '@should-not-override',
    });
    expect(out.contributorKey).toBe('precomputed');
  });

  it('derives contributorKey from instagram/submitterName when absent', () => {
    expect(window.FilmsUtils.toLightboxReaderPhoto({ instagram: '@HandleMixed' }).contributorKey)
      .toBe('handlemixed');
    expect(window.FilmsUtils.toLightboxReaderPhoto({ submitterName: '박순렬' }).contributorKey)
      .toBe('박순렬');
  });

  it('produces safe defaults for empty input', () => {
    const out = window.FilmsUtils.toLightboxReaderPhoto({});
    expect(out).toEqual({
      src: undefined,
      webp: undefined,
      author: '',
      instagram: '',
      film: '',
      camera: '',
      caption: '',
      instagramUrl: '',
      contributorKey: '',
      submissionId: '',
      _source: 'reader',
    });
  });

  it('marks output as reader-source so lightbox can branch on it', () => {
    expect(window.FilmsUtils.toLightboxReaderPhoto({}). _source).toBe('reader');
  });
});

describe('window.FilmsUtils shape', () => {
  it('exposes the expected helpers', () => {
    expect(Object.keys(window.FilmsUtils).sort()).toEqual([
      'contributorKeyOfSubmission',
      'contributorLabelOfSubmission',
      'escapeAttr',
      'escapeHtml',
      'filterCategoryOf',
      'isMobileFilms',
      'normalizeContributorKey',
      'normalizeFilmLabel',
      'resolveFilmKey',
      'toLightboxReaderPhoto',
    ]);
  });
});

describe('window.FilmsUtils.filterCategoryOf (existing helper, regression coverage)', () => {
  it('detects color negative', () => {
    expect(window.FilmsUtils.filterCategoryOf({ type: 'Color Negative' })).toBe('color');
  });

  it('detects black and white', () => {
    expect(window.FilmsUtils.filterCategoryOf({ type: 'Black & White' })).toBe('bw');
    expect(window.FilmsUtils.filterCategoryOf({ type: 'monochrome white' })).toBe('bw');
  });

  it('detects slide / reversal', () => {
    expect(window.FilmsUtils.filterCategoryOf({ type: 'Color Slide' })).toBe('slide');
    expect(window.FilmsUtils.filterCategoryOf({ type: 'E-6 reversal' })).toBe('slide');
  });

  it('detects cinema stocks', () => {
    expect(window.FilmsUtils.filterCategoryOf({ type: 'Tungsten cinema' })).toBe('cinema');
    expect(window.FilmsUtils.filterCategoryOf({ type: 'Daylight cinema' })).toBe('cinema');
  });

  it('falls back to "other" for unknown/missing types', () => {
    expect(window.FilmsUtils.filterCategoryOf({ type: 'Polaroid' })).toBe('other');
    expect(window.FilmsUtils.filterCategoryOf({})).toBe('other');
    expect(window.FilmsUtils.filterCategoryOf()).toBe('other');
  });
});
