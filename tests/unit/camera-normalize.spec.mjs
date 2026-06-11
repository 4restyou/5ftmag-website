// js/camera-brands.js (window.normalizeCamera) 단위 테스트.
// 핵심 불변식: 같은 글자라면 (대소문자·띄어쓰기·하이픈 무관) 항상 같은 brand|key.
// 한글·영문 혼용 통일은 범위 밖 (정책상 미지원).

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

beforeAll(() => {
  const code = fs.readFileSync(path.resolve(process.cwd(), 'js/camera-brands.js'), 'utf8');
  // eslint-disable-next-line no-eval
  (0, eval)(code);
});

const idOf = (s) => {
  const r = window.normalizeCamera(s);
  return `${r.brand || '-'}|${r.key}`;
};

describe('window.normalizeCamera — 표기 변형 키 통일', () => {
  const groups = [
    // [대표 표기, ...같은 카메라로 인식해야 하는 변형들]
    ['Nikon F', 'nikonf', 'NIKON F', 'nikon f', 'Nikon-F'],
    ['Pentax MX', 'pentaxmx', 'PENTAX MX'],
    ['Leica M6', 'leicam6', 'LEICA M6', 'Leica m6'],
    ['Contax T', 'contaxt'],
    ['Canon AE-1', 'canonae1', 'CANON AE1', 'canon ae-1'],
    ['Olympus mju', 'olympusmju', 'OLYMPUS MJU'],
    ['Olympus Pen EE-3', 'olympuspenee3', 'OLYMPUS PEN EE3'],
    ['Hasselblad 500CM', 'hasselblad500cm'],
    ['Rollei 35', 'rollei35', 'ROLLEI 35'],
    ['Minox 35', 'minox35'],
  ];

  for (const [canon, ...variants] of groups) {
    it(`"${canon}" 의 변형들이 같은 키로 정규화된다`, () => {
      const expected = idOf(canon);
      for (const v of variants) {
        expect(idOf(v), `${v} → ${idOf(v)} (기대: ${expected})`).toBe(expected);
      }
    });
  }
});

describe('window.normalizeCamera — 고유 모델명 보호 (prefix 분리 오인 방지)', () => {
  it('Canonet 은 canon|et 로 쪼개지지 않는다 (힌트 정확 일치 우선)', () => {
    expect(idOf('Canonet')).toBe('canon|canonet');
    expect(idOf('canonet')).toBe('canon|canonet');
    expect(idOf('CANONET')).toBe('canon|canonet');
  });

  it('pentaxmx 가 olympus pen 으로 오인되지 않는다 (3자 힌트 prefix 차단)', () => {
    const r = window.normalizeCamera('pentaxmx');
    expect(r.brand).toBe('pentax');
    expect(r.key).toBe('mx');
  });
});

describe('window.normalizeCamera — 단독 모델명 브랜드 추정 (기존 동작 회귀)', () => {
  it.each([
    ['M6', 'leica', 'm6'],
    ['AE-1', 'canon', 'ae1'],
    ['mju', 'olympus', 'mju'],
    ['pen ee-3', 'olympus', 'penee3'],
  ])('"%s" → %s|%s', (input, brand, key) => {
    const r = window.normalizeCamera(input);
    expect(r.brand).toBe(brand);
    expect(r.key).toBe(key);
  });

  it('브랜드명만 입력하면 key 없이 brand 만 잡힌다', () => {
    const r = window.normalizeCamera('Leica');
    expect(r.brand).toBe('leica');
    expect(r.key).toBe('');
  });

  it('빈 입력은 빈 결과', () => {
    expect(window.normalizeCamera('')).toMatchObject({ key: '', brand: null });
    expect(window.normalizeCamera(null)).toMatchObject({ key: '', brand: null });
  });
});
