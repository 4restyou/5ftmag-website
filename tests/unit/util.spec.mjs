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

describe('window.MagUtil shape', () => {
  it('exposes escapeHtml, escapeAttr, normalizeFilmLabel', () => {
    expect(Object.keys(window.MagUtil).sort()).toEqual(
      ['escapeAttr', 'escapeHtml', 'normalizeFilmLabel']
    );
  });

  it('is frozen (immutable surface)', () => {
    expect(Object.isFrozen(window.MagUtil)).toBe(true);
  });
});
