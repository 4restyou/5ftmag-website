// 영문판(/en/) 기반을 묶어 둔다.
//
// 모든 페이지에 <base href="/"> 가 있어 상대경로는 루트(한국어판) 기준으로 풀린다.
// 그래서 영문 페이지의 셸 링크가 상대경로로 나가면 눈에 띄지 않게 한국어판으로 새어 나간다.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { navHtml, mobileNavHtml, footerPublisherHtml, alternatesHtml, isEnFile, ROOT } from '../../scripts/lib/site-shell.mjs';

const enAbout = join(ROOT, 'en/about.html');
const koAbout = join(ROOT, 'about.html');

describe('공통 셸: 영문 페이지', () => {
  it('en/ 아래 파일만 영문 페이지로 본다', () => {
    expect(isEnFile(enAbout)).toBe(true);
    expect(isEnFile(koAbout)).toBe(false);
    expect(isEnFile(join(ROOT, 'stories/en.html'))).toBe(false);
  });

  it('링크는 모두 절대경로이고, 영문판이 있는 곳은 /en/ 으로 간다', () => {
    const hrefs = [...navHtml(enAbout).matchAll(/href="([^"]+)"/g), ...mobileNavHtml(enAbout).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href.startsWith('/'), href).toBe(true);
    expect(hrefs).toContain('/en/about.html');
    expect(navHtml(enAbout)).toMatch(/href="\/en\/about\.html" class="current"/);
  });

  it('한국어 페이지 링크는 그대로 상대경로다', () => {
    expect(navHtml(koAbout)).toMatch(/href="about\.html" class="current"/);
  });

  it('발행처 줄은 언어를 따른다', () => {
    expect(footerPublisherHtml(enAbout)).not.toMatch(/[가-힣]/);
    expect(footerPublisherHtml(koAbout)).toMatch(/발행처/);
  });

  it('공개 전에는 언어 대응 링크를 넣지 않는다', () => {
    const shell = JSON.parse(readFileSync(join(ROOT, 'data/site-shell.json'), 'utf8'));
    if (shell.en.publish) return;
    expect(alternatesHtml(enAbout)).toBe('');
    expect(alternatesHtml(koAbout)).toBe('');
  });
});

describe('js/i18n.js', () => {
  const src = readFileSync(join(ROOT, 'js/i18n.js'), 'utf8');
  const load = (lang) => {
    document.documentElement.lang = lang;
    delete window.i18n;
    new Function(src)();
    return window.i18n;
  };

  beforeEach(() => { document.documentElement.lang = 'ko'; });

  it('한국어 페이지에선 한국어와 원래 경로', () => {
    const i18n = load('ko');
    expect(i18n.t('최근 글', 'Latest')).toBe('최근 글');
    expect(i18n.url('/stories.html')).toBe('/stories.html');
  });

  it('영문 페이지에선 영문과 /en/ 경로', () => {
    const i18n = load('en');
    expect(i18n.t('최근 글', 'Latest')).toBe('Latest');
    expect(i18n.url('/stories.html?page=2')).toBe('/en/stories.html?page=2');
    expect(i18n.url('/films.html?film=portra400')).toBe('/en/films.html?film=portra400');
    expect(i18n.url('/stories/lee-gapchul.html')).toBe('/en/stories/lee-gapchul.html');
    expect(i18n.url('/')).toBe('/en/');
  });

  it('영문판이 없는 곳(장터·구매 등)은 한국어판으로 둔다', () => {
    const i18n = load('en');
    expect(i18n.url('/market.html')).toBe('/market.html');
    expect(i18n.url('/shop.html')).toBe('/shop.html');
    expect(i18n.url('/en/films.html')).toBe('/en/films.html');
  });
});
