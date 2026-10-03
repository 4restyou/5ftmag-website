import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const utilSource = readFileSync('js/util.js', 'utf8');
let previousUtil;
let previousI18n;

beforeEach(() => {
  previousUtil = window.MagUtil;
  previousI18n = window.i18n;
  new Function(utilSource)();
});

afterEach(() => {
  window.MagUtil = previousUtil;
  window.i18n = previousI18n;
});

describe('shared conservative KRW parsing', () => {
  it.each([
    [230000, 230000], ['230,000', 230000], ['23', 23], ['6', 6], [0, 0], ['0원', 0],
    ['23만원 / 택포', 230000], ['6만원 / 택포', 60000], ['5만원 (택포)', 50000],
    ['2.5만원', 25000], ['2.5천원', 2500], ['1.001만원', 10010], ['23.000원', 23],
    ['KRW 230,000 / shipping incl.', 230000], ['₩ 60,000 (배송비 포함)', 60000],
    ['250,000 won (shipping incl.)', 250000], ['60,000ウォン / 送料込み', 60000],
    ['6만원 ( 배송비 포함 )', 60000], ['9007199254740991', Number.MAX_SAFE_INTEGER],
  ])('parses %s as %s won', (value, amount) => {
    expect(window.MagUtil.parseKrwPrice(value)).toBe(amount);
  });

  it.each([
    false, true, null, undefined, {}, [], NaN, Infinity, -23, 23.5, '', '23,00', '2e5', '$23',
    '23 / 6', '23만원 / 6만원', '23만원~25만원', '23만원 (배송비 3000원)',
    '23만원 / 택포 2개', '23만원 / 협의', '23만원 /', '23만원 / (택포)',
    '9007199254740992', '1.00000000000000001원', '0.00001만원',
    '<b>23만원</b>', '가격 협의', 'negotiable', '무료',
  ])('does not infer an amount from %s', value => {
    expect(window.MagUtil.parseKrwPrice(value)).toBeNull();
  });

  it('exposes the parser on the frozen utility surface', () => {
    expect(typeof window.MagUtil.parseKrwPrice).toBe('function');
    expect(Object.isFrozen(window.MagUtil)).toBe(true);
  });
});

describe.each([
  ['ko', '원'], ['en', ' won'], ['ja', 'ウォン'],
])('monetary formatting in %s', (lang, unit) => {
  beforeEach(() => { window.i18n = { lang }; });

  it.each([
    [230000, '230,000'], ['230,000원', '230,000'], ['23', '23'], ['6', '6'],
    ['23만원 / 택포', '230,000'], ['6만원 / 택포', '60,000'],
    ['5만원 (택포)', '50,000'], ['2.5만원', '25,000'], ['2.5천원', '2,500'],
    ['KRW 230,000 / shipping incl.', '230,000'], ['60,000ウォン (送料込み)', '60,000'],
  ])('formats %s with the correct multiplier and unit', (value, amount) => {
    expect(window.MagUtil.formatPrice(value)).toBe(amount + unit);
    expect(window.MagUtil.formatPrice(value, { keepText: true })).toBe(amount + unit);
  });

  it.each(['23 / 6', '23만원 / 6만원', '23만원 (배송비 3000원)', '23abc', '가격 협의', '23,00'])('keeps ambiguous text %s only when requested', value => {
    expect(window.MagUtil.formatPrice(value)).toBe('');
    expect(window.MagUtil.formatPrice(value, { keepText: true })).toBe(value);
  });

  it('escapes kept text even when it contains digits', () => {
    expect(window.MagUtil.formatPrice('<b>23만원</b> & "협의"', { keepText: true }))
      .toBe('&lt;b&gt;23만원&lt;/b&gt; &amp; &quot;협의&quot;');
  });

  it('preserves empty and non-positive fallbacks', () => {
    for (const value of [null, undefined, '', 0, -23, false]) {
      expect(window.MagUtil.formatPrice(value, { empty: '-' })).toBe('-');
    }
    expect(window.MagUtil.formatPrice(0, { keepText: true })).toBe('0');
    expect(window.MagUtil.formatPrice('  ', { keepText: true, empty: '-' })).toBe('-');
  });
});
