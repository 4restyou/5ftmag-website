// 영문판(/en/) 기반을 묶어 둔다.
//
// 모든 페이지에 <base href="/"> 가 있어 상대경로는 루트(한국어판) 기준으로 풀린다.
// 그래서 영문 페이지의 셸 링크가 상대경로로 나가면 눈에 띄지 않게 한국어판으로 새어 나간다.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { navHtml, mobileNavHtml, footerPublisherHtml, alternatesHtml, isEnFile, ROOT } from '../../scripts/lib/site-shell.mjs';
import { leftoverKorean } from '../../scripts/lib/en-text.mjs';

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

  it('언어 대응 링크는 공개 여부(en.publish)를 따른다', () => {
    const shell = JSON.parse(readFileSync(join(ROOT, 'data/site-shell.json'), 'utf8'));
    if (!shell.en.publish) {
      expect(alternatesHtml(enAbout)).toBe('');
      expect(alternatesHtml(koAbout)).toBe('');
      return;
    }
    for (const file of [koAbout, enAbout]) {
      const html = alternatesHtml(file);
      expect(html).toContain('hreflang="ko" href="https://www.5ftmag.com/about.html"');
      expect(html).toContain('hreflang="en" href="https://www.5ftmag.com/en/about.html"');
      expect(html).toContain('hreflang="x-default" href="https://www.5ftmag.com/about.html"');
    }
    // 짝이 없는 페이지(옛 책장 등)엔 넣지 않는다
    expect(alternatesHtml(join(ROOT, 'books-classic.html'))).toBe('');
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

  it('영문판이 없는 곳(관리 화면 등)은 한국어판으로 둔다', () => {
    const i18n = load('en');
    expect(i18n.url('/market.html')).toBe('/en/market.html');
    expect(i18n.url('/shop.html')).toBe('/en/shop.html');
    expect(i18n.url('/authors/kim-hyuna.html')).toBe('/en/authors/kim-hyuna.html');
    expect(i18n.url('/admin/films.html')).toBe('/admin/films.html');
    expect(i18n.url('/en/films.html')).toBe('/en/films.html');
  });
});

describe('영문 기사', () => {
  const enDir = join(ROOT, 'en/stories');
  const pages = existsSync(enDir) ? readdirSync(enDir).filter((f) => f.endsWith('.html')) : [];

  it('한국어가 남지 않았다(원제 병기·주석·작가 매칭 키 제외)', () => {
    const left = pages.flatMap((f) => leftoverKorean(readFileSync(join(enDir, f), 'utf8')).map((l) => `${f}:${l.line} ${l.text.slice(0, 60)}`));
    expect(left).toEqual([]);
  });

  it('언어·주소·AI 번역 안내·원문 링크를 갖췄다', () => {
    for (const f of pages) {
      const html = readFileSync(join(enDir, f), 'utf8');
      expect(html, f).toMatch(/<html lang="en"/);
      expect(html, f).toContain(`<link rel="canonical" href="https://www.5ftmag.com/en/stories/${f}">`);
      expect(html, f).toMatch(/class="article-translation-note"[^]*?href="\/stories\/[^"]+" hreflang="ko"/);
      expect(html, f).toMatch(/js\/i18n\.js\?v=/);
    }
  });

  it('stories.json 의 영문 제목과 영문 페이지가 짝을 이룬다', () => {
    const stories = JSON.parse(readFileSync(join(ROOT, 'data/stories.json'), 'utf8'));
    for (const s of stories.filter((x) => x.titleEn)) {
      expect(existsSync(join(ROOT, 'en', s.page)), s.page).toBe(true);
      expect(s.titleEn, s.id).toMatch(/[A-Za-z]/);
    }
  });
});

describe('MagUtil.localizeStories', () => {
  const src = readFileSync(join(ROOT, 'js/util.js'), 'utf8');
  new Function(src)();
  const { localizeStories } = window.MagUtil;
  const list = [
    { id: 'a', title: '한국어', excerpt: '요약', page: 'stories/a.html', author: '김현아', titleEn: 'English', excerptEn: 'Summary' },
    { id: 'b', title: '번역 전', excerpt: '요약', page: 'stories/b.html' },
  ];

  it('한국어 페이지에선 그대로 둔다', () => {
    expect(localizeStories(list, false)).toBe(list);
  });

  it('영문 페이지에선 번역된 글만 영문 제목·요약·/en/ 주소로, 작가 키는 그대로', () => {
    const [a, b] = localizeStories(list, true);
    expect(a).toMatchObject({ title: 'English', excerpt: 'Summary', page: 'en/stories/a.html', author: '김현아', titleKo: '한국어' });
    expect(b).toBe(list[1]);
  });
});
