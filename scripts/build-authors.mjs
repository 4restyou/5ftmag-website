#!/usr/bin/env node
/**
 * data/stories.json 기반 작가 아카이브 생성.
 * 빌드와 별도로 `npm run build:authors` 로도 실행할 수 있다.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { assetVersions } from './lib/asset-version.mjs';
import { navHtml, mobileNavHtml, footerHtml, footerPublisherHtml, footerCopyHtml, alternatesHtml } from './lib/site-shell.mjs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPublishedContent } from './story-visibility.mjs';

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
  ['5ft.mag 편집부', '필름 매거진 5ft magazine의 기획과 편집을 맡습니다.'],
  ['Film Social Club', '광주 충장로를 기반으로 필름과 사진 문화를 이어가는 공간입니다.'],
  ['Street Photography Club', '스트리트 포토를 좋아하는 사람들의 모임. 자체 사진첩 시리즈를 발행하고 5ft magazine 매거진을 유통합니다.'],
  ['Shin Noguchi', '일상의 낯선 순간을 거리에서 포착하는 일본의 스트리트 포토그래퍼입니다.'],
  ['Brisnap TV', '필름카메라와 사진 장비를 직접 써보고 소개하는 영상 채널입니다.'],
  ['김현아', '일상과 관계의 결을 짧은 에세이로 기록합니다.'],
  ['명수경', '필름 생활의 작은 장면을 만화로 옮깁니다.'],
  ['강혜원 (앨리카메라 대표)', '앨리카메라를 운영하며 빈티지 카메라와 렌즈를 소개합니다.'],
  ['윤동규', '유튜브 〈수집의 수집〉을 운영하며 다큐멘터리와 사진을 기록합니다.'],
  ['심규동', '사진집 〈고시텔〉·〈1인가구〉를 펴낸 사진가. 사람과 공간의 관계를 카메라로 기록합니다.'],
]);

// 영문판(en/authors*.html) 소개문. 위 한국어 소개문을 그대로 옮긴 것이다(사실을 덧붙이지 않는다).
// 작품·채널 이름은 영문 기사에서 쓰는 표기를 따른다.
const AUTHOR_NOTES_EN = new Map([
  ['5ft.mag 편집부', 'Plans and edits 5ft magazine, a film photography magazine.'],
  ['Film Social Club', 'A space on Chungjang-ro in Gwangju that keeps film and photo culture going.'],
  ['Street Photography Club', 'A group of people who love street photography. They publish their own photobook series and distribute 5ft magazine.'],
  ['Shin Noguchi', 'A Japanese street photographer who catches the strange moments of everyday life on the street.'],
  ['Brisnap TV', 'A video channel that tries out film cameras and photo gear firsthand and reviews them.'],
  ['김현아', 'Writes short essays about the textures of everyday life and relationships.'],
  ['명수경', 'Turns small scenes from life with film into comics.'],
  ['강혜원 (앨리카메라 대표)', 'Runs Ally Cameras and introduces vintage cameras and lenses.'],
  ['윤동규', 'Runs the YouTube channel 〈The Collection of Collecting〉 and records documentaries and photographs.'],
  ['심규동', 'Photographer behind the photobooks 〈Gositel〉 and 〈Single-Person Households〉. He records the relationship between people and spaces with his camera.'],
]);
// 일본어판(ja/authors*.html) 소개문. 위 한국어 소개문을 옮긴 것이다(사실을 덧붙이지 않는다).
// 작품·채널 이름은 일본어 기사에서 쓰는 표기를 따른다.
const AUTHOR_NOTES_JA = new Map([
  ['5ft.mag 편집부', 'フィルム写真マガジン 5ft magazine の企画と編集を担当しています。'],
  ['Film Social Club', '光州・忠壮路を拠点に、フィルムと写真の文化をつないでいくスペースです。'],
  ['Street Photography Club', 'ストリートフォトが好きな人たちの集まり。独自の写真集シリーズを発行し、5ft magazine の流通も手がけています。'],
  ['Shin Noguchi', '日常のふとした不思議な瞬間を街でとらえる、日本のストリートフォトグラファーです。'],
  ['Brisnap TV', 'フィルムカメラや写真機材を実際に使って紹介する動画チャンネルです。'],
  ['김현아', '日常と人との関係の手ざわりを、短いエッセイに記しています。'],
  ['명수경', 'フィルムのある暮らしの小さな場面を漫画にしています。'],
  ['강혜원 (앨리카메라 대표)', 'アリーカメラを営み、ヴィンテージカメラとレンズを紹介しています。'],
  ['윤동규', 'YouTube〈収集の収集〉を運営し、ドキュメンタリーと写真を記録しています。'],
  ['심규동', '写真集〈コシテル〉〈単身世帯〉を出した写真家。人と空間の関係をカメラで記録しています。'],
]);
// 영문 표기. stories.json 의 authorEn 이 있으면 그것을 먼저 쓴다.
const AUTHOR_NAMES_EN = new Map([
  ['5ft.mag 편집부', '5ft.mag Editors'],
  ['김현아', 'Kim Hyun-a'],
  ['명수경', 'Myeong Su-gyeong'],
  ['강혜원 (앨리카메라 대표)', 'Kang Hye-won (CEO, Ally Cameras)'],
  ['윤동규', 'Yoon Dong-gyu'],
  ['심규동', 'Shim Kyu-dong'],
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

// 단체 계정(편집부·클럽)과 개인 필자를 구분한다. 실제로 단체인 byline 을 Person 으로
// 적으면 사실과 다르다. 대신 author 노드에 url 을 붙여 저자 페이지와 이어 준다.
const ORGANIZATION_BYLINES = new Set([
  '5ft.mag 편집부', 'Film Social Club', 'Street Photography Club', 'Brisnap TV',
]);

export function authorEntityType(name) {
  return ORGANIZATION_BYLINES.has(name) ? 'Organization' : 'Person';
}

function ldScript(node, indent = '  ') {
  return `${indent}<script type="application/ld+json">\n${JSON.stringify(node, null, 2)}\n${indent}</script>\n`;
}

function authorStructuredData(author) {
  const url = `${SITE_URL}/authors/${author.slug}.html`;
  const entity = {
    '@type': authorEntityType(author.name),
    name: author.name,
    url,
  };
  if (author.note) entity.description = author.note;
  const links = (author.externalLinks || []).map((link) => link.url).filter(Boolean);
  if (links.length) entity.sameAs = links;

  const profile = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url,
    inLanguage: 'ko-KR',
    isPartOf: { '@type': 'WebSite', name: '5ft magazine', url: `${SITE_URL}/` },
    mainEntity: entity,
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '5ft magazine', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Authors', item: `${SITE_URL}/authors.html` },
      { '@type': 'ListItem', position: 3, name: author.name, item: url },
    ],
  };
  return ldScript(profile) + ldScript(breadcrumb);
}

function authorsIndexStructuredData(authors) {
  return ldScript({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Authors | 5ft magazine',
    url: `${SITE_URL}/authors.html`,
    inLanguage: 'ko-KR',
    isPartOf: { '@type': 'WebSite', name: '5ft magazine', url: `${SITE_URL}/` },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: authors.length,
      itemListElement: authors.map((author, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': authorEntityType(author.name),
          name: author.name,
          url: `${SITE_URL}/authors/${author.slug}.html`,
        },
      })),
    },
  });
}

// 자산 버전은 index.html 에서 읽어 온다. 여기에 하드코딩하면 bump-version 으로
// 버전을 올려도 이 스크립트가 옛 버전을 다시 써서 저자 페이지만 갈라진다.
// css/authors.css 는 index.html 이 참조하지 않는다. about.html 에서 링크되는
// 손으로 관리하는 저자 페이지가 이 자산을 물고 있으므로 그쪽에서 읽는다.
const v = assetVersions(['index.html', 'authors/noh-aegyeong.html']);

function rootHead(title, description, canonicalPath, cssHref = `css/authors.css${v('css/authors.css')}`, structuredData = '') {
  return `<!DOCTYPE html>
<html lang="ko" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${SITE_URL}${canonicalPath}">
  <link rel="alternate" type="application/rss+xml" title="5ft magazine RSS" href="rss.xml">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${SITE_URL}/img/og/5ft-link1.webp">
  <meta property="og:url" content="${SITE_URL}${canonicalPath}">
  <meta property="og:site_name" content="5ft magazine">
  <meta property="og:locale" content="ko_KR">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${SITE_URL}/img/og/5ft-link1.webp">
${structuredData}  <link rel="icon" type="image/svg+xml" href="img/favicon/icon.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="img/favicon/icon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="img/favicon/icon-16.png">
  <link rel="shortcut icon" href="img/favicon/favicon.ico">
  <link rel="apple-touch-icon" sizes="180x180" href="img/favicon/icon-180.png">
  <script src="./js/theme-init.js?v=20261002-e1"></script>
  <link rel="stylesheet" href="pretendard.css" />
  <link rel="stylesheet" href="css/tokens.css${v('css/tokens.css')}">
  <link rel="stylesheet" href="css/common.css${v('css/common.css')}">
  <link rel="stylesheet" href="${cssHref}">
</head>`;
}

function subHead(title, description, canonicalPath, structuredData = '') {
  return rootHead(title, description, canonicalPath, `../css/authors.css${v('css/authors.css')}`, structuredData)
    .replaceAll('href="rss.xml"', 'href="../rss.xml"')
    .replaceAll('href="img/', 'href="../img/')
    .replaceAll('href="pretendard.css"', 'href="../pretendard.css"')
    .replaceAll('href="css/', 'href="../css/')
    .replaceAll('src="./js/', 'src="../js/');
}

// 내비게이션·푸터는 data/site-shell.json 이 원본이다. 예전에는 여기에 마크업을
// 박아 두어서, 배포할 때마다 저자 페이지가 옛 내비게이션("Books", 네이버 스토어
// Shop 링크)으로 덮여 쓰이고 있었다. shell:sync 로 고쳐도 다음 빌드에서 되돌아갔다.
function header(outFile, prefix = '') {
  return `<header>
  <div class="header-inner">
    <a href="${prefix}index.html" class="site-logo"><img src="${prefix}img/symbol-b.svg" alt="5ft magazine" class="logo-light" /><img src="${prefix}img/symbol-w.svg" alt="5ft magazine" class="logo-dark" /></a>
    ${navHtml(outFile)}
    <div class="nav-right">
      <a href="${prefix}search.html" class="icon-btn" id="headerSearchBtn" aria-label="전체 검색" title="전체 검색"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg></a>
      <button class="icon-btn" id="themeBtn" type="button" aria-label="다크 모드로 전환" aria-pressed="false">☽</button>
      <button class="icon-btn hamburger" id="menuBtn" type="button" aria-label="메뉴 열기" aria-controls="mobileNav" aria-expanded="false">☰</button>
    </div>
  </div>
  ${mobileNavHtml(outFile)}
</header>`;
}

function footer(outFile, prefix = '') {
  return `<footer>
  <div class="footer-inner-left">
    <span class="footer-logo">5ft magazine</span>
    <span class="footer-publisher">발행처 4rest · 편집 박순렬 · 전남광주통합특별시 동구 충장로46번길 8, 2층</span>
  </div>
  ${footerHtml(outFile)}
  <span class="footer-copy">© 2026 5ft magazine</span>
</footer>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="${prefix}js/db-client.js${v('js/db-client.js')}"></script>
<script src="${prefix}js/site-common.js${v('js/site-common.js')}"></script>`;
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
  .filter((story) => isPublishedContent(story) && story.author)
  .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

const authors = new Map();
for (const story of stories) {
  const author = story.author;
  if (!authors.has(author)) {
    authors.set(author, {
      name: author,
      slug: slugify(author),
      note: AUTHOR_NOTES.get(author) || '5ft magazine에 글과 사진으로 참여한 contributor입니다.',
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

const listHtml = `${rootHead('Authors | 5ft magazine', '5ft magazine에 참여한 작가와 contributor의 글을 한곳에서 모아봅니다.', '/authors.html', undefined, authorsIndexStructuredData(authorList))}
<body>
${header(join(ROOT, 'authors.html'))}
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
${footer(join(ROOT, 'authors.html'))}
</body>
</html>
`;

writeFileSync(join(ROOT, 'authors.html'), listHtml);

for (const author of authorList) {
  const authorFile = join(ROOT, 'authors', `${author.slug}.html`);
  const title = `${author.name} | 5ft magazine Authors`;
  const description = `${author.name}의 5ft magazine 아카이브. ${author.stories.length}개의 글을 모았습니다.`;
  const html = `${subHead(title, description, `/authors/${author.slug}.html`, authorStructuredData(author))}
<body>
${header(authorFile, '../')}
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
${footer(authorFile, '../')}
</body>
</html>
`;
  writeFileSync(join(ROOT, 'authors', `${author.slug}.html`), html);
}

// ── 외국어판: en/authors.html, en/authors/<slug>.html, ja/authors.html, ja/authors/<slug>.html ──
// 같은 입력(data/stories.json)으로 찍는다. 링크·자산은 절대경로(<base href="/"> 때문),
// 그 언어판이 있는 페이지는 /en/ · /ja/ 로 잇는다(sync-site-shell 과 같은 규칙).
// i18n.js 는 외국어 페이지만 싣는다. 다른 영문 페이지와 같은 버전을 쓴다(단일 버전 가드)
const i18nVersion = (readFileSync(join(ROOT, 'en/about.html'), 'utf8').match(/js\/i18n\.js(\?v=[0-9A-Za-z-]+)/) || [])[1] || '';
const articlesLabel = (n) => `${n} ${n === 1 ? 'Article' : 'Articles'}`;

const FOREIGN = {
  en: {
    lang: 'en', locale: 'en_US',
    siteDesc: 'An archive of writing by the authors and contributors of 5ft magazine, all in one place.',
    heroLead: 'An archive of the people behind the writing, photos, interviews and reviews.',
    gridLabel: 'Authors', search: 'Search', dark: 'Switch to dark mode', menu: 'Open menu',
    name: (author) => author.stories.find((story) => story.authorEn)?.authorEn || AUTHOR_NAMES_EN.get(author.name) || author.name,
    note: (author) => AUTHOR_NOTES_EN.get(author.name) || 'A contributor of writing and photographs to 5ft magazine.',
    description: (name, n) => `The 5ft magazine archive of ${name}. ${articlesLabel(n)}.`,
    listLabel: (name) => `Articles by ${name}`,
    // 영문 페이지가 있는 글만 영문 제목·요약과 /en/ 주소로 잇는다. 없으면 한국어판으로.
    story: (story) => (Boolean(story.titleEn) && existsSync(join(ROOT, 'en', story.page))
      ? { prefix: 'en/', title: story.titleEn, excerpt: story.excerptEn || '' }
      : { prefix: '', title: story.title, excerpt: story.excerpt || '' }),
  },
  ja: {
    lang: 'ja', locale: 'ja_JP',
    siteDesc: '5ft magazine に参加した執筆者とコントリビューターの記事を一か所にまとめたアーカイブです。',
    heroLead: '文章、写真、インタビュー、レビューをつくった人たちのアーカイブです。',
    gridLabel: '執筆者一覧', search: '検索', dark: 'ダークモードに切り替え', menu: 'メニューを開く',
    name: (author) => author.stories.find((story) => story.authorJa)?.authorJa
      || author.stories.find((story) => story.authorEn)?.authorEn || AUTHOR_NAMES_EN.get(author.name) || author.name,
    note: (author) => AUTHOR_NOTES_JA.get(author.name) || '5ft magazine に文章や写真で参加したコントリビューターです。',
    description: (name, n) => `${name}の5ft magazineアーカイブ。記事${n}本を集めました。`,
    listLabel: (name) => `${name}の記事一覧`,
    // 일본어 페이지가 있는 글은 일본어로, 없으면 영문판, 그것도 없으면 한국어판으로 잇는다.
    story: (story) => {
      if (story.titleJa && existsSync(join(ROOT, 'ja', story.page))) {
        return { prefix: 'ja/', title: story.titleJa, excerpt: story.excerptJa || '' };
      }
      return FOREIGN.en.story(story);
    },
  },
};

function foreignHref(L, page) {
  return existsSync(join(ROOT, L.lang, page)) ? `/${L.lang}/${page}` : `/${page}`;
}

function foreignAuthor(L, author) {
  return {
    ...author,
    name: L.name(author),
    entityType: authorEntityType(author.name),
    note: L.note(author),
  };
}

function foreignStructuredData(L, author) {
  const url = `${SITE_URL}/${L.lang}/authors/${author.slug}.html`;
  const entity = { '@type': author.entityType, name: author.name, url, description: author.note };
  const links = (author.externalLinks || []).map((link) => link.url).filter(Boolean);
  if (links.length) entity.sameAs = links;
  return ldScript({
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url,
    inLanguage: L.lang,
    isPartOf: { '@type': 'WebSite', name: '5ft magazine', url: `${SITE_URL}/${L.lang}/` },
    mainEntity: entity,
  }) + ldScript({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '5ft magazine', item: `${SITE_URL}/${L.lang}/` },
      { '@type': 'ListItem', position: 2, name: 'Authors', item: `${SITE_URL}/${L.lang}/authors.html` },
      { '@type': 'ListItem', position: 3, name: author.name, item: url },
    ],
  });
}

function foreignIndexStructuredData(L, list) {
  return ldScript({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Authors | 5ft magazine',
    url: `${SITE_URL}/${L.lang}/authors.html`,
    inLanguage: L.lang,
    isPartOf: { '@type': 'WebSite', name: '5ft magazine', url: `${SITE_URL}/${L.lang}/` },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: list.length,
      itemListElement: list.map((author, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: { '@type': author.entityType, name: author.name, url: `${SITE_URL}/${L.lang}/authors/${author.slug}.html` },
      })),
    },
  });
}

function foreignHead(L, title, description, canonicalPath, structuredData) {
  return `<!DOCTYPE html>
<html lang="${L.lang}" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${SITE_URL}${canonicalPath}">
  <link rel="alternate" type="application/rss+xml" title="5ft magazine RSS" href="/rss.xml">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${SITE_URL}/img/og/5ft-link1.webp">
  <meta property="og:url" content="${SITE_URL}${canonicalPath}">
  <meta property="og:site_name" content="5ft magazine">
  <meta property="og:locale" content="${L.locale}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${SITE_URL}/img/og/5ft-link1.webp">
${structuredData}  <link rel="icon" type="image/svg+xml" href="/img/favicon/icon.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="/img/favicon/icon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/img/favicon/icon-16.png">
  <link rel="shortcut icon" href="/img/favicon/favicon.ico">
  <link rel="apple-touch-icon" sizes="180x180" href="/img/favicon/icon-180.png">
  <script src="/js/theme-init.js?v=20261002-e1"></script>
  <script src="/js/i18n.js${i18nVersion}"></script>
  <link rel="stylesheet" href="/pretendard.css" />
  <link rel="stylesheet" href="/css/tokens.css${v('css/tokens.css')}">
  <link rel="stylesheet" href="/css/common.css${v('css/common.css')}">
  <link rel="stylesheet" href="/css/authors.css${v('css/authors.css')}">
</head>`;
}

function foreignHeader(L, outFile) {
  return `<header>
  <div class="header-inner">
    <a href="/${L.lang}/" class="site-logo"><img src="/img/symbol-b.svg" alt="5ft magazine" class="logo-light" /><img src="/img/symbol-w.svg" alt="5ft magazine" class="logo-dark" /></a>
    ${navHtml(outFile)}
    <div class="nav-right">
      <a href="${foreignHref(L, 'search.html')}" class="icon-btn" id="headerSearchBtn" aria-label="${L.search}" title="${L.search}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg></a>
      <button class="icon-btn" id="themeBtn" type="button" aria-label="${L.dark}" aria-pressed="false">☽</button>
      <button class="icon-btn hamburger" id="menuBtn" type="button" aria-label="${L.menu}" aria-controls="mobileNav" aria-expanded="false">☰</button>
    </div>
  </div>
  ${mobileNavHtml(outFile)}
</header>`;
}

function foreignFooter(outFile) {
  return `<footer>
  <div class="footer-inner-left">
    <span class="footer-logo">5ft magazine</span>
    ${footerPublisherHtml(outFile)}
  </div>
  ${footerHtml(outFile)}
  ${footerCopyHtml(outFile)}
</footer>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="/js/db-client.js${v('js/db-client.js')}"></script>
<script src="/js/site-common.js${v('js/site-common.js')}"></script>`;
}

function foreignStoryCard(L, story) {
  const { prefix, title, excerpt } = L.story(story);
  const image = story.thumbnail
    ? `<img src="/${escapeHtml(story.thumbnail.replace(/^\.?\//, ''))}" alt="${escapeHtml(title)}" loading="lazy">`
    : `<span class="author-story-placeholder">${escapeHtml(title)}</span>`;
  return `<a class="author-story-card" href="/${prefix}${escapeHtml(story.page)}">
    <div class="author-story-img ${story.thumbnail ? '' : 'is-text'}">${image}</div>
    <div class="author-story-body">
      <span class="author-story-meta">${escapeHtml(story.categoryLabel || story.category || '')} · ${escapeHtml(formatDate(story.date))}</span>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(excerpt)}</p>
    </div>
  </a>`;
}

const written = [join(ROOT, 'authors.html')];
for (const L of [FOREIGN.en, FOREIGN.ja]) {
  const list = authorList.map((author) => foreignAuthor(L, author));
  mkdirSync(join(ROOT, L.lang, 'authors'), { recursive: true });

  const indexFile = join(ROOT, L.lang, 'authors.html');
  writeFileSync(indexFile, `${foreignHead(L, 'Authors | 5ft magazine', L.siteDesc, `/${L.lang}/authors.html`, foreignIndexStructuredData(L, list))}
<body>
${foreignHeader(L, indexFile)}
<main class="authors-page">
  <section class="authors-hero">
    <span class="authors-kicker">CONTRIBUTORS</span>
    <h1>Authors</h1>
    <p>${L.heroLead}</p>
  </section>
  <section class="authors-grid" aria-label="${L.gridLabel}">
    ${list.map((author) => `<a class="author-card" href="/${L.lang}/authors/${author.slug}.html">
      <span class="author-count">${articlesLabel(author.stories.length)}</span>
      <h2>${escapeHtml(author.name)}</h2>
      <p>${escapeHtml(author.note)}</p>
    </a>`).join('\n    ')}
  </section>
</main>
${foreignFooter(indexFile)}
</body>
</html>
`);
  written.push(indexFile);

  for (const author of list) {
    const authorFile = join(ROOT, L.lang, 'authors', `${author.slug}.html`);
    const title = `${author.name} | 5ft magazine Authors`;
    const description = L.description(author.name, author.stories.length);
    writeFileSync(authorFile, `${foreignHead(L, title, description, `/${L.lang}/authors/${author.slug}.html`, foreignStructuredData(L, author))}
<body>
${foreignHeader(L, authorFile)}
<main class="authors-page author-detail-page">
  <section class="authors-hero">
    <a class="authors-back" href="/${L.lang}/authors.html">← Authors</a>
    <span class="authors-kicker">${articlesLabel(author.stories.length).toUpperCase()}</span>
    <h1>${escapeHtml(author.name)}</h1>
    <p>${escapeHtml(author.note)}</p>
  </section>
  <section class="author-story-list" aria-label="${escapeHtml(L.listLabel(author.name))}">
    ${author.stories.map((story) => foreignStoryCard(L, story)).join('\n    ')}
  </section>
</main>
${foreignFooter(authorFile)}
</body>
</html>
`);
    if (L.lang === 'en') written.push(join(ROOT, 'authors', `${author.slug}.html`));
    written.push(authorFile);
  }
}

// 언어 대응 링크(hreflang)는 두 판이 다 써진 뒤에 붙인다. shell:sync 가 넣는 것과 같은 마크업이라
// 다음 빌드가 shell:sync 결과를 되돌리지 않는다.
for (const file of written) {
  const alternates = alternatesHtml(file);
  if (!alternates) continue;
  const html = readFileSync(file, 'utf8');
  writeFileSync(file, html.replace(/(<link rel="canonical" href="[^"]*">)/, `$1\n${alternates}`));
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

console.log(`Authors generated: ${authorList.length} (ko + en + ja)`);
