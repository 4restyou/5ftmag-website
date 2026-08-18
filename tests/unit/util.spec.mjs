// js/util.js (window.MagUtil) 단위 테스트.
// util.js 는 IIFE 안에 window.MagUtil 을 세팅하는 클라 모듈이라
// jsdom 환경의 globalThis.window 에 그대로 실행시켜 사용.

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

beforeAll(() => {
  // jsdom 환경에서 import.meta.url 이 http 스키마라 fs 가 읽지 못한다.
  // 프로젝트 루트(process.cwd) 기준 상대 경로로 읽는다 (vitest 는 root 에서 실행).
  const code = fs.readFileSync(path.resolve(process.cwd(), 'js/util.js'), 'utf8');
  // indirect eval → global scope 에서 실행 (window 접근 가능).
  // eslint-disable-next-line no-eval
  (0, eval)(code);
});

describe('window.MagUtil.escapeHtml', () => {
  it('returns empty string for nullish input', () => {
    expect(window.MagUtil.escapeHtml(null)).toBe('');
    expect(window.MagUtil.escapeHtml(undefined)).toBe('');
  });

  it('escapes the five reserved HTML entities', () => {
    expect(window.MagUtil.escapeHtml('<script>alert("xss")</script>'))
      .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(window.MagUtil.escapeHtml("It's & < > \" all"))
      .toBe('It&#39;s &amp; &lt; &gt; &quot; all');
  });

  it('passes through safe characters (Korean / Latin / digits)', () => {
    expect(window.MagUtil.escapeHtml('hello world 안녕 123'))
      .toBe('hello world 안녕 123');
  });

  it('coerces non-string input to string', () => {
    expect(window.MagUtil.escapeHtml(42)).toBe('42');
    expect(window.MagUtil.escapeHtml(true)).toBe('true');
    expect(window.MagUtil.escapeHtml(0)).toBe('0');
  });

  it('handles & first (no double-escape)', () => {
    // & 가 < 보다 나중에 처리되면 &lt; 가 &amp;lt; 로 다시 escape 되는 버그가 생긴다.
    // 정상이라면 한 번만 처리.
    expect(window.MagUtil.escapeHtml('A & B < C')).toBe('A &amp; B &lt; C');
  });

  it('returns empty string for empty input', () => {
    expect(window.MagUtil.escapeHtml('')).toBe('');
  });
});

describe('window.MagUtil.escapeAttr', () => {
  it('is currently equivalent to escapeHtml', () => {
    const samples = ['hello', 'a "b" c', "it's <ok>", '한글'];
    for (const s of samples) {
      expect(window.MagUtil.escapeAttr(s)).toBe(window.MagUtil.escapeHtml(s));
    }
  });
});

describe('window.MagUtil.normalizeFilmLabel', () => {
  it('lowercases and strips separator characters', () => {
    expect(window.MagUtil.normalizeFilmLabel('Portra 400')).toBe('portra400');
    expect(window.MagUtil.normalizeFilmLabel('PORTRA-400')).toBe('portra400');
    expect(window.MagUtil.normalizeFilmLabel('Kodak_Portra+400')).toBe('kodakportra400');
    expect(window.MagUtil.normalizeFilmLabel('Tri/X.400 (ISO)')).toBe('trix400iso');
  });

  it('preserves Korean characters', () => {
    expect(window.MagUtil.normalizeFilmLabel('포트라 400')).toBe('포트라400');
    expect(window.MagUtil.normalizeFilmLabel('포 트 라')).toBe('포트라');
  });

  it('handles nullish input', () => {
    expect(window.MagUtil.normalizeFilmLabel(null)).toBe('');
    expect(window.MagUtil.normalizeFilmLabel(undefined)).toBe('');
    expect(window.MagUtil.normalizeFilmLabel('')).toBe('');
  });

  it('coerces non-string input to string', () => {
    expect(window.MagUtil.normalizeFilmLabel(400)).toBe('400');
  });

  it('produces same key for common alias variants (search invariant)', () => {
    const variants = ['Portra 400', 'portra400', 'PORTRA-400', 'portra_400', 'portra+400'];
    const keys = variants.map((v) => window.MagUtil.normalizeFilmLabel(v));
    expect(new Set(keys).size).toBe(1);
  });
});

describe('formatPrice', () => {
  const f = (...args) => window.MagUtil.formatPrice(...args);

  it('formats numbers with ko-KR thousands separator', () => {
    expect(f(30000)).toBe('30,000원');
    expect(f('30000000')).toBe('30,000,000원');
  });

  it('returns the empty fallback for missing or non-positive values', () => {
    expect(f('')).toBe('');
    expect(f(null)).toBe('');
    expect(f(0)).toBe('');
    // admin 목록은 빈칸 대신 대시를 쓴다
    expect(f(0, { empty: '—' })).toBe('—');
    expect(f(undefined, { empty: '—' })).toBe('—');
  });

  it('keeps non-numeric text only when keepText is set (market/me)', () => {
    expect(f('가격 협의', { keepText: true })).toBe('가격 협의');
    expect(f('가격 협의')).toBe('');
  });

  it('escapes kept text (user input path)', () => {
    expect(f('<script>x</script>', { keepText: true })).not.toContain('<script>');
  });
});


describe('window.MagUtil.pickByAuthorRoundRobin', () => {
  // 버킷 순서 셔플을 끄고(항상 0) 결정적으로 검증한다.
  const pick = (pool, count, authorOf) =>
    window.MagUtil.pickByAuthorRoundRobin(pool, count, authorOf, () => 0);
  const shot = (author, id) => ({ author, id });

  it('가장 흔한 작가가 칸을 독식하지 않는다', () => {
    const pool = [
      ...Array.from({ length: 20 }, (_, i) => shot('A', `a${i}`)),
      shot('B', 'b0'), shot('C', 'c0'),
    ];
    const got = pick(pool, 6);
    const fromA = got.filter((p) => p.author === 'A').length;
    // A 가 20장이어도 다른 작가가 먼저 한 바퀴를 받는다
    expect(new Set(got.map((p) => p.author))).toEqual(new Set(['A', 'B', 'C']));
    expect(fromA).toBe(4);
  });

  it('작가가 한 명뿐이면 그 작가 사진으로 채운다', () => {
    const pool = Array.from({ length: 5 }, (_, i) => shot('A', `a${i}`));
    expect(pick(pool, 3).map((p) => p.id)).toEqual(['a0', 'a1', 'a2']);
  });

  it('최근순 풀을 주면 각 작가의 최신 컷이 먼저 뽑힌다', () => {
    // 최근 3장이 전부 A — 잘라내지 않고 뒤로 거슬러 올라가 B·C 를 찾아야 한다
    const pool = [
      shot('A', 'a-new1'), shot('A', 'a-new2'), shot('A', 'a-new3'),
      shot('B', 'b-new'), shot('B', 'b-old'),
      shot('C', 'c-new'),
    ];
    const got = pick(pool, 3).map((p) => p.id);
    expect(got.sort()).toEqual(['a-new1', 'b-new', 'c-new']);
  });

  it('작성자 미상은 한 명으로 묶지 않는다', () => {
    const pool = [shot('', 'x1'), shot('', 'x2'), shot('  ', 'x3')];
    expect(pick(pool, 3)).toHaveLength(3);
  });

  it('작가 이름은 대소문자·공백 차이를 같은 사람으로 본다', () => {
    const pool = [shot('Kim', 'k1'), shot(' kim ', 'k2'), shot('Lee', 'l1')];
    const got = pick(pool, 2).map((p) => p.id);
    expect(got.sort()).toEqual(['k1', 'l1']);
  });

  it('요청 수가 풀보다 크면 있는 만큼만 준다', () => {
    expect(pick([shot('A', 'a')], 10)).toHaveLength(1);
  });

  it('빈 입력·0 이하 요청을 안전하게 처리한다', () => {
    expect(pick([], 5)).toEqual([]);
    expect(pick(null, 5)).toEqual([]);
    expect(pick([shot('A', 'a')], 0)).toEqual([]);
    expect(pick([shot('A', 'a')], -1)).toEqual([]);
  });

  it('작가 키를 뽑는 함수를 직접 줄 수 있다', () => {
    const pool = [
      { by: 'A', id: 'a1' }, { by: 'A', id: 'a2' }, { by: 'B', id: 'b1' },
    ];
    const got = pick(pool, 2, (p) => p.by).map((p) => p.id);
    expect(got.sort()).toEqual(['a1', 'b1']);
  });

  it('원본 배열을 건드리지 않는다', () => {
    const pool = [shot('A', 'a1'), shot('B', 'b1')];
    const copy = [...pool];
    pick(pool, 2);
    expect(pool).toEqual(copy);
  });
});

describe('window.MagUtil shape', () => {
  it('exposes the shared browser utilities', () => {
    expect(Object.keys(window.MagUtil).sort()).toEqual(
      ['escapeAttr', 'escapeHtml', 'formatPrice', 'isPublishedContent', 'normalizeFilmLabel', 'pickByAuthorRoundRobin', 'seoulTodayIso']
    );
  });

  it('is frozen (immutable surface)', () => {
    expect(Object.isFrozen(window.MagUtil)).toBe(true);
  });
});
