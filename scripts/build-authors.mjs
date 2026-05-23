#!/usr/bin/env node
/**
 * data/stories.json 기반 작가 아카이브 생성.
 * 빌드와 별도로 `npm run build:authors` 로도 실행할 수 있다.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');
const SITE_URL = 'https://www.5ftmag.com';

const AUTHOR_SLUGS = new Map([
  ['5ft.mag 편집부', '5ftmag'],
  ['Film Social Club', 'film-social-club'],
  ['Street Photography Club', 'street-photography-club'],
  ['Shin Noguchi', 'shin-noguchi'],
  ['Brisnap TV', 'brisnap-tv'],
  ['김현아', 'kim-hyuna'],
  ['명수경', 'myeong-sugyeong'],
  ['강혜원 (앨리카메라 대표)', 'kang-hyewon'],
  ['윤동규', 'yoon-donggyu'],
  ['심규동', 'shim-kyudong'],
]);

const AUTHOR_NOTES = new Map([
  ['5ft.mag 편집부', '필름 매거진 5ft.mag의 기획과 편집을 맡습니다.'],
  ['Film Social Club', '광주 충장로를 기반으로 필름과 사진 문화를 이어가는 공간입니다.'],
  ['Street Photography Club', '스트리트 포토를 좋아하는 사람들의 모임. 자체 사진첩 시리즈를 발행하고 5ft.mag 매거진을 유통합니다.'],
  ['Shin Noguchi', '일상의 낯선 순간을 거리에서 포착하는 일본의 스트리트 포토그래퍼입니다.'],
  ['Brisnap TV', '필름카메라와 사진 장비를 직접 써보고 소개하는 영상 채널입니다.'],
  ['김현아', '일상과 관계의 결을 짧은 에세이로 기록합니다.'],
  ['명수경', '필름 생활의 작은 장면을 만화로 옮깁니다.'],
  ['강혜원 (앨리카메라 대표)', '앨리카메라를 운영하며 빈티지 카메라와 렌즈를 소개합니다.'],
  ['윤동규', '유튜브 〈수집의 수집〉을 운영하며 다큐멘터리와 사진을 기록합니다.'],
  ['심규동', '사진집 〈고시텔〉·〈1인가구〉를 펴낸 사진가. 사람과 공간의 관계를 카메라로 기록합니다.'],
]);

const AUTHOR_EXTERNAL_LINKS = new Map([
  ['5ft.mag 편집부', [
    { type: 'instagram', url: 'https://instagram.com/5ft.magazine', label: '@5ft.magazine' },
    { type: 'website',   url: 'https://www.4rest.net',              label: '4rest.net' },
  ]],
  ['Film Social Club', [
    { type: 'instagram', url: 'https://instagram.com/film_socialclub',           label: '@film_socialclub' },
    { type: 'shop',      url: 'https://smartstore.naver.com/film_socialclub',    label: 'Shop' },
  ]],
  ['Street Photography Club', [
    { type: 'shop',      url: 'https://smartstore.naver.com/film_socialclub',    label: 'Shop' },
  ]],
  ['Shin Noguchi', [
    { type: 'website',   url: 'https://www.shinnoguchiphotography.com', label: 'shinnoguchiphotography.com' },
    { type: 'instagram', url: 'https://instagram.com/shinnoguchiphotos', label: '@shinnoguchiphotos' },
  ]],
  ['Brisnap TV', [
    { type: 'youtube',   url: 'https://www.youtube.com/@BRISNAPTV', label: '@BRISNAPTV' },
  ]],
  ['김현아', [
    { type: 'instagram', url: 'https://instagram.com/aaaaa._.nuyh', label: '@aaaaa._.nuyh' },
  ]],
  ['명수경', [
    { type: 'instagram', url: 'https://instagram.com/myeungsk', label: '@myeungsk' },
  ]],
  // 외부 활동 미파악 — 알려지면 추가
  ['강혜원 (앨리카메라 대표)', []],
  ['윤동규', []],
  ['심규동', []],
]);

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function slugify(author) {
  const mapped = AUTHOR_SLUGS.get(author);
  if (mapped) return mapped;
  const ascii = author
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
  return ascii || encodeURIComponent(author);
}

function formatDate(date) {
  if (!date) return '';
  return date.replaceAll('-', '.');
}

function rootHead(title, description, canonicalPath, cssHref = 'css/authors.css?v=20260520-init') {
  return `<!DOCTYPE html>
<html lang="ko" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${SITE_URL}${canonicalPath}">
  <link rel="alternate" type="application/rss+xml" title="5ft.mag RSS" href="rss.xml">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${SITE_URL}/img/og/5ft-link1.webp">
  <meta property="og:url" content="${SITE_URL}${canonicalPath}">
  <meta property="og:site_name" content="5ft.mag">
  <meta property="og:locale" content="ko_KR">
  <link rel="icon" type="image/svg+xml" href="img/favicon/icon.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="img/favicon/icon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="img/favicon/icon-16.png">
  <link rel="shortcut icon" href="img/favicon/favicon.ico">
  <link rel="apple-touch-icon" sizes="180x180" href="img/favicon/icon-180.png">
  <script src="./js/theme-init.js"></script>
  <link rel="stylesheet" href="pretendard.css" />
  <link rel="stylesheet" href="css/tokens.css?v=20260523-lhmuted">
  <link rel="stylesheet" href="css/common.css?v=20260523-navindicator">
  <link rel="stylesheet" href="${cssHref}">
</head>`;
}

function subHead(title, description, canonicalPath) {
  return rootHead(title, description, canonicalPath, '../css/authors.css?v=20260520-init')
    .replaceAll('href="rss.xml"', 'href="../rss.xml"')
    .replaceAll('href="img/', 'href="../img/')
    .replaceAll('href="pretendard.css"', 'href="../pretendard.css"')
    .replaceAll('href="css/', 'href="../css/')
    .replaceAll('src="./js/', 'src="../js/');
}

function header(prefix = '') {
  return `<header>
  <div class="header-inner">
    <a href="${prefix}index.html" class="site-logo"><img src="${prefix}img/symbol-b.svg" alt="5ft.mag" class="logo-light" /><img src="${prefix}img/symbol-w.svg" alt="5ft.mag" class="logo-dark" /></a>
    <ul class="main-nav">
      <li><a href="${prefix}stories.html">Articles</a></li>
      <li><a href="${prefix}films.html">Films</a></li>
      <li><a href="${prefix}about.html">About</a></li>
      <li><a href="https://smartstore.naver.com/film_socialclub" target="_blank" rel="noopener" class="ext">Shop</a></li>
    </ul>
    <div class="nav-right">
      <button class="icon-btn" id="themeBtn" type="button" aria-label="다크 모드로 전환" aria-pressed="false">☽</button>
      <button class="icon-btn hamburger" id="menuBtn" type="button" aria-label="메뉴 열기" aria-controls="mobileNav" aria-expanded="false">☰</button>
    </div>
  </div>
  <nav class="mobile-nav" id="mobileNav">
    <a href="${prefix}stories.html">Articles</a>
    <a href="${prefix}films.html">Films</a>
    <a href="${prefix}about.html">About</a>
    <a href="https://smartstore.naver.com/film_socialclub" target="_blank" rel="noopener">Shop ↗</a>
  </nav>
</header>`;
}

function footer(prefix = '') {
  return `<footer>
  <div class="footer-inner-left">
    <span class="footer-logo">5ft.mag</span>
    <span class="footer-publisher">발행처 4rest · 편집 박순렬 · 광주광역시 동구 충장로46번길 8, 2층</span>
  </div>
  <div class="footer-links">
    <a href="https://smartstore.naver.com/film_socialclub" target="_blank" rel="noopener">Shop ↗</a>
    <a href="https://instagram.com/5ft.magazine" target="_blank" rel="noopener">@5ft.magazine ↗</a>
    <a href="mailto:4rest_design@naver.com">4rest_design@naver.com</a>
    <a href="https://www.4rest.net" target="_blank" rel="noopener">4rest.net ↗</a>
  </div>
  <span class="footer-copy">© 2024 5ft.mag</span>
</footer>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="${prefix}js/db-client.js?v=20260523-cdnproxy"></script>
<script src="${prefix}js/site-common.js?v=20260522-accountmenu"></script>`;
}

function storyCard(story, prefix = '') {
  const image = story.thumbnail
    ? `<img src="${prefix}${escapeHtml(story.thumbnail)}" alt="${escapeHtml(story.title)}" loading="lazy">`
    : `<span class="author-story-placeholder">${escapeHtml(story.title)}</span>`;
  return `<a class="author-story-card" href="${prefix}${escapeHtml(story.page)}">
    <div class="author-story-img ${story.thumbnail ? '' : 'is-text'}">${image}</div>
    <div class="author-story-body">
      <span class="author-story-meta">${escapeHtml(story.categoryLabel || story.category || '')} · ${escapeHtml(formatDate(story.date))}</span>
      <h2>${escapeHtml(story.title)}</h2>
      <p>${escapeHtml(story.excerpt || '')}</p>
    </div>
  </a>`;
}

const stories = JSON.parse(readFileSync(join(ROOT, 'data/stories.json'), 'utf8'))
  .filter((story) => story && story.published !== false && story.author)
  .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

const authors = new Map();
for (const story of stories) {
  const author = story.author;
  if (!authors.has(author)) {
    authors.set(author, {
      name: author,
      slug: slugify(author),
      note: AUTHOR_NOTES.get(author) || '5ft.mag에 글과 사진으로 참여한 contributor입니다.',
      externalLinks: AUTHOR_EXTERNAL_LINKS.get(author) || [],
      stories: [],
    });
  }
  authors.get(author).stories.push(story);
}

const authorList = [...authors.values()]
  .sort((a, b) => b.stories.length - a.stories.length || a.name.localeCompare(b.name, 'ko'));

mkdirSync(join(ROOT, 'authors'), { recursive: true });
mkdirSync(join(ROOT, 'data'), { recursive: true });

const listHtml = `${rootHead('Authors | 5ft.mag', '5ft.mag에 참여한 작가와 contributor의 글을 한곳에서 모아봅니다.', '/authors.html')}
<body>
${header()}
<main class="authors-page">
  <section class="authors-hero">
    <span class="authors-kicker">CONTRIBUTORS</span>
    <h1>Authors</h1>
    <p>글, 사진, 인터뷰와 리뷰를 만든 사람들의 아카이브입니다.</p>
  </section>
  <section class="authors-grid" aria-label="작가 목록">
    ${authorList.map((author) => `<a class="author-card" href="authors/${author.slug}.html">
      <span class="author-count">${author.stories.length} Articles</span>
      <h2>${escapeHtml(author.name)}</h2>
      <p>${escapeHtml(author.note)}</p>
    </a>`).join('\n    ')}
  </section>
</main>
${footer()}
</body>
</html>
`;

writeFileSync(join(ROOT, 'authors.html'), listHtml);

for (const author of authorList) {
  const title = `${author.name} | 5ft.mag Authors`;
  const description = `${author.name}의 5ft.mag 아카이브. ${author.stories.length}개의 글을 모았습니다.`;
  const html = `${subHead(title, description, `/authors/${author.slug}.html`)}
<body>
${header('../')}
<main class="authors-page author-detail-page">
  <section class="authors-hero">
    <a class="authors-back" href="../authors.html">← Authors</a>
    <span class="authors-kicker">${author.stories.length} ARTICLES</span>
    <h1>${escapeHtml(author.name)}</h1>
    <p>${escapeHtml(author.note)}</p>
  </section>
  <section class="author-story-list" aria-label="${escapeHtml(author.name)} 글 목록">
    ${author.stories.map((story) => storyCard(story, '../')).join('\n    ')}
  </section>
</main>
${footer('../')}
</body>
</html>
`;
  writeFileSync(join(ROOT, 'authors', `${author.slug}.html`), html);
}

writeFileSync(
  join(ROOT, 'data/authors.json'),
  `${JSON.stringify(authorList.map((author) => ({
    name: author.name,
    slug: author.slug,
    note: author.note,
    count: author.stories.length,
    page: `authors/${author.slug}.html`,
    externalLinks: author.externalLinks || [],
  })), null, 2)}\n`,
);

console.log(`Authors generated: ${authorList.length}`);
