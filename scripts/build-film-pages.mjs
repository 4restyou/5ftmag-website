// /film/<slug>.html 필름 상세 페이지 생성.
//
// 예전에는 소셜 미리보기용 stub(noindex + meta refresh)만 찍어냈다. 그 결과
// 필름 158종이 검색엔진 입장에서는 films.html 한 장으로만 존재했고, 자바스크립트를
// 실행하지 않는 AI 수집기에게는 아예 보이지 않았다. 이제 규격·설명·별칭을 담은
// 실제 페이지를 만들고 색인을 허용한다.
//
// data/films.json 이 원본이다(원본은 Supabase films 테이블, build-films.mjs 가 dump).
// netlify.toml 의 /film/:slug → /film/:slug.html 리다이렉트가 주소를 이어 준다.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, navHtml, mobileNavHtml, footerHtml, footerPublisherHtml, alternatesHtml } from './lib/site-shell.mjs';

const FILMS_JSON = path.join(ROOT, 'data/films.json');
const OUT_DIR = path.join(ROOT, 'film');
const EN_OUT_DIR = path.join(ROOT, 'en/film');
const EN_INDEX_PAGE = path.join(ROOT, 'en/films.html');
const JA_OUT_DIR = path.join(ROOT, 'ja/film');
const JA_INDEX_PAGE = path.join(ROOT, 'ja/films.html');
const REFERENCE_PAGE = path.join(ROOT, 'films.html');
const STORIES_JSON = path.join(ROOT, 'data/stories.json');

const ORIGIN = 'https://www.5ftmag.com';
const SITE_NAME = '5ft magazine';
const FALLBACK_OG = `${ORIGIN}/img/og/5ft-link1.webp`;
const SAME_BRAND_LIMIT = 8;

// 영문판(en/film/<slug>.html)도 같은 함수로 찍는다. 문구만 갈라 둔다.
const TEXT = {
  ko: {
    lang: 'ko', locale: 'ko_KR', inLanguage: 'ko-KR', prefix: '',
    spec: ['브랜드', '감도', '종류', '포맷', '수록 호'],
    fallbackDesc: (parts) => `${parts} 필름. 5ft.mag 필름 카탈로그에서 규격과 독자들이 찍은 사진을 확인하세요.`,
    category: '사진 필름', catalog: '필름 카탈로그', crumb: '현재 위치',
    aliases: '다르게 부르는 이름',
    shotOn: (n) => `${n} 로 찍은 사진`, photoAlt: (n, a) => `${n} 로 찍은 사진${a ? `. 촬영 ${a}` : ''}`,
    articles: (n) => `${n} 를 다룬 글`, sameBrand: (b) => `${b} 의 다른 필름`, thumbAlt: (n) => `${n} 필름`,
    cta: '카탈로그에서는 이 필름으로 찍은 사진을 촬영자·카메라별로 골라 보고, 직접 올릴 수도 있습니다.',
    ctaView: '카탈로그에서 보기', ctaAll: '필름 전체 목록',
    search: '전체 검색', dark: '다크 모드로 전환', menu: '메뉴 열기',
    indexSummary: (n) => `필름 전체 목록 ${n}종`, indexSub: '브랜드별로 정리한 필름 카탈로그입니다. 이름을 누르면 규격과 설명을 볼 수 있어요.', other: '기타',
  },
  en: {
    lang: 'en', locale: 'en_US', inLanguage: 'en', prefix: '/en',
    spec: ['Brand', 'Speed', 'Type', 'Format', 'Featured in'],
    fallbackDesc: (parts) => `${parts} film. See its specs and reader photos in the 5ft.mag film catalog.`,
    category: 'Photographic film', catalog: 'Film catalog', crumb: 'Breadcrumb',
    aliases: 'Also known as',
    shotOn: (n) => `Shot on ${n}`, photoAlt: (n, a) => `Photo shot on ${n}${a ? `. By ${a}` : ''}`,
    articles: (n) => `Articles on ${n}`, sameBrand: (b) => `More from ${b}`, thumbAlt: (n) => `${n} film`,
    cta: 'In the catalog you can browse photos shot on this film by photographer and camera, and upload your own.',
    ctaView: 'View in catalog', ctaAll: 'All films',
    search: 'Search', dark: 'Switch to dark mode', menu: 'Open menu',
    indexSummary: (n) => `All ${n} films`, indexSub: 'The film catalog, sorted by brand. Tap a name to see its specs and description.', other: 'Other',
  },
  ja: {
    lang: 'ja', locale: 'ja_JP', inLanguage: 'ja-JP', prefix: '/ja',
    spec: ['ブランド', '感度', '種類', 'フォーマット', '掲載号'],
    fallbackDesc: (parts) => `${parts} のフィルム。5ft.mag のフィルムカタログで仕様と読者の作例をご覧いただけます。`,
    category: '写真フィルム', catalog: 'フィルムカタログ', crumb: '現在地',
    aliases: '別名',
    shotOn: (n) => `${n} で撮った写真`, photoAlt: (n, a) => `${n} で撮った写真${a ? `。撮影 ${a}` : ''}`,
    articles: (n) => `${n} を取り上げた記事`, sameBrand: (b) => `${b} のほかのフィルム`, thumbAlt: (n) => `${n} フィルム`,
    cta: 'カタログでは、このフィルムで撮った写真を撮影者やカメラごとに見られます。ご自身の写真を投稿することもできます。',
    ctaView: 'カタログで見る', ctaAll: 'フィルム一覧',
    search: '検索', dark: 'ダークモードに切り替え', menu: 'メニューを開く',
    indexSummary: (n) => `フィルム一覧（全${n}種）`, indexSub: 'ブランド別に整理したフィルムカタログです。名前を押すと仕様と説明をご覧いただけます。', other: 'その他',
  },
};
const HANGUL = /[가-힣]/;
// 대표 필름 사진의 촬영자(고정 작가). 영문판은 로마자 표기로(en/about.html 과 같은 표기)
const PERSON_EN = { '박순렬': 'Park Soon Yeol', '노애경': 'Noh Ae-gyeong', '장형수': 'Jang Hyeong-su' };
const personOf = (name, T) => (T.lang !== 'ko' && PERSON_EN[name]) || name;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 자산 버전(?v=)은 films.html 에서 그대로 가져온다. 여기에 하드코딩하면
// bump-version.mjs 로 버전을 올릴 때 생성 페이지만 옛 버전에 묶인다.
// 이 페이지에서만 쓰는 css/film-detail.css 는 다른 HTML 이 참조하지 않아
// bump-version 의 관리 대상이 아니므로, 파일 내용 해시를 버전으로 붙인다.
function assetVersionReader(referenceHtml, ownVersions) {
  return function versioned(assetPath) {
    if (ownVersions[assetPath]) return `/${assetPath}?v=${ownVersions[assetPath]}`;
    const pattern = new RegExp(`${assetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\?v=[0-9a-z-]+)?`);
    const found = referenceHtml.match(pattern);
    return `/${assetPath}${found?.[1] ?? ''}`;
  };
}

async function contentHash(relPath) {
  const buf = await fs.readFile(path.join(ROOT, relPath));
  return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
}

function absoluteImage(candidate) {
  if (!candidate) return FALLBACK_OG;
  if (/^https?:\/\//.test(candidate)) return candidate;
  return `${ORIGIN}/${String(candidate).replace(/^\.?\//, '')}`;
}

function displayNameOf(film) {
  return film.displayName || film.name || film.slug;
}

// 검색·공유에 쓰이는 한 줄 설명. desc 가 비면 규격으로 대체한다.
function descOf(film, T) {
  return ((T.lang === 'ja' && (film.descJa || film.descEn)) || (T.lang === 'en' && film.descEn) || film.desc || '').trim();
}

function descriptionOf(film, T = TEXT.ko) {
  const desc = descOf(film, T);
  if (desc) return desc.length > 180 ? `${desc.slice(0, 177)}…` : desc;
  const parts = [film.brand, film.iso && `ISO ${film.iso}`, film.type, film.format].filter(Boolean);
  return T.fallbackDesc(parts.join(' · '));
}

// 별칭에는 한글 표기가 섞여 있다("코닥 울트라맥스 400"). 검색어와 직접 맞물리는
// 부분이라 페이지에 그대로 노출한다. 표시 이름과 겹치는 항목은 뺀다.
function aliasesOf(film, T = TEXT.ko) {
  const name = displayNameOf(film).toLowerCase();
  const seen = new Set([name]);
  const out = [];
  for (const alias of film.aliases || []) {
    const key = String(alias).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    if (T.lang !== 'ko' && HANGUL.test(key)) continue;   // 외국어판엔 한글 별칭을 싣지 않는다
    seen.add(key);
    out.push(String(alias).trim());
  }
  return out;
}

function specRows(film, T = TEXT.ko) {
  return [
    [T.spec[0], film.brand],
    [T.spec[1], film.iso ? `ISO ${film.iso}` : ''],
    [T.spec[2], film.type],
    [T.spec[3], film.format],
    [T.spec[4], film.issue],
  ].filter(([, value]) => value);
}

function thumbnailOf(film) {
  return film.canThumbnail || film.boxThumbnail
    || (Array.isArray(film.photos) && film.photos[0]?.src) || '';
}

// 독자 투고의 film 값은 표시 이름이나 별칭 중 아무거나로 저장돼 있다.
// 사진을 빠짐없이 찾으려면 후보를 모두 넘긴다.
function filmNameCandidates(film) {
  const names = [film.displayName, film.name, ...(film.aliases || [])]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return [...new Set(names)];
}

function jsonLd(film, sameBrand, T) {
  const name = displayNameOf(film);
  const url = `${ORIGIN}${T.prefix}/film/${film.slug}.html`;
  const properties = specRows(film, T).map(([label, value]) => ({
    '@type': 'PropertyValue', name: label, value: String(value),
  }));
  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description: descriptionOf(film, T),
    url,
    category: T.category,
    inLanguage: T.inLanguage,
  };
  if (film.brand) product.brand = { '@type': 'Brand', name: film.brand };
  const image = thumbnailOf(film);
  if (image) product.image = [absoluteImage(image)];
  const alternateName = aliasesOf(film, T);
  if (alternateName.length) product.alternateName = alternateName;
  if (properties.length) product.additionalProperty = properties;
  if (sameBrand.length) {
    product.isRelatedTo = sameBrand.map((other) => ({
      '@type': 'Product', name: displayNameOf(other), url: `${ORIGIN}${T.prefix}/film/${other.slug}.html`,
    }));
  }

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '5ft magazine', item: `${ORIGIN}${T.prefix}/` },
      { '@type': 'ListItem', position: 2, name: T.catalog, item: `${ORIGIN}${T.prefix}/films.html` },
      { '@type': 'ListItem', position: 3, name, item: url },
    ],
  };
  return [product, breadcrumb]
    .map((node) => `  <script type="application/ld+json">\n${JSON.stringify(node, null, 2)}\n  </script>`)
    .join('\n');
}

// films.html 하단의 브랜드별 전체 목록을 채운다. 카탈로그 카드가 버튼이라
// 이 페이지에는 크롤러가 읽을 본문도, 필름 이름도 없었다.
// 링크는 카탈로그로 보낸다. 상세 페이지(/film/<slug>.html)는 검색 전용이라
// 독자가 그쪽으로 들어가지 않게 하고, 색인은 sitemap 과 상세 페이지끼리의
// 상호 링크로 이뤄진다.
async function writeFilmIndex(films, T = TEXT.ko, page = path.join(ROOT, 'films.html')) {
  const byBrand = new Map();
  for (const film of films) {
    const brand = film.brand || T.other;
    if (!byBrand.has(brand)) byBrand.set(brand, []);
    byBrand.get(brand).push(film);
  }
  const brands = [...byBrand.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  const html = brands.map((brand) => {
    const items = byBrand.get(brand)
      .sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b), 'ko'))
      .map((film) => `        <li><a href="${T.prefix ? `${T.prefix}/` : './'}films.html?film=${encodeURIComponent(film.slug)}">${esc(displayNameOf(film))}</a></li>`)
      .join('\n');
    return `    <div class="film-index-brand">
      <h3>${esc(brand)}</h3>
      <ul>
${items}
      </ul>
    </div>`;
  }).join('\n');

  const source = await fs.readFile(page, 'utf-8').catch(() => null);
  if (source == null) return false;
  // details 로 접어 둔다. 접혀 있어도 마크업은 HTML 에 그대로 남아 크롤러가
  // 읽고 링크를 따라간다. 화면에서만 기본으로 감춘다.
  const next = source.replace(
    /<!-- FILM-INDEX:START -->[\s\S]*?<!-- FILM-INDEX:END -->/,
    `<!-- FILM-INDEX:START -->
  <details class="film-index-fold">
    <summary>${T.indexSummary(films.length)}</summary>
    <p class="film-index-sub">${T.indexSub}</p>
    <div class="film-index-grid">
${html}
    </div>
  </details>
  <!-- FILM-INDEX:END -->`,
  );
  if (next !== source) {
    await fs.writeFile(page, next, 'utf-8');
    return true;
  }
  return false;
}

function render(film, sameBrand, versioned, outFile, articles, T = TEXT.ko) {
  const P = T.prefix;
  const name = displayNameOf(film);
  const title = `${name} | 5ft magazine`;
  const description = descriptionOf(film, T);
  const desc = descOf(film, T);
  const url = `${ORIGIN}${P}/film/${film.slug}.html`;
  const ogImage = absoluteImage(thumbnailOf(film));
  const thumb = thumbnailOf(film);
  const aliases = aliasesOf(film, T);
  const rows = specRows(film, T);

  const specHtml = rows.map(([label, value]) => `
        <div class="film-detail-spec-row">
          <dt>${esc(label)}</dt>
          <dd>${esc(value)}</dd>
        </div>`).join('');

  const aliasHtml = aliases.length ? `
      <section class="film-detail-block">
        <h2>${esc(T.aliases)}</h2>
        <ul class="film-detail-aliases">
${aliases.map((alias) => `          <li>${esc(alias)}</li>`).join('\n')}
        </ul>
      </section>` : '';

  const photos = Array.isArray(film.photos) ? film.photos.filter((p) => p?.src).slice(0, 12) : [];
  const photosHtml = photos.length ? `
      <section class="film-detail-block">
        <h2>${esc(T.shotOn(name))}</h2>
        <div class="film-detail-photos">
${photos.map((photo) => `          <figure>
            <img src="/${esc(String(photo.src).replace(/^\.?\//, ''))}" alt="${esc(T.photoAlt(name, photo.author && personOf(photo.author, T)))}" loading="lazy" decoding="async" />
${photo.author ? `            <figcaption>${esc(personOf(photo.author, T))}</figcaption>` : ''}
          </figure>`).join('\n')}
        </div>
      </section>` : '';

  // 이 필름을 다룬 기사. data/stories.json 의 films 배열이 근거다.
  // 카탈로그 모달의 "이 필름으로 쓴 글" 링크도 같은 데이터를 쓴다.
  const articleHtml = (articles && articles.length) ? `
      <section class="film-detail-block">
        <h2>${esc(T.articles(name))}</h2>
        <ul class="film-detail-articles">
${articles.map((st) => {
    // 일문판은 번역된 글이면 일문 제목·일문 페이지로
    if (T.lang === 'ja' && st.titleJa) {
      return `          <li><a href="/ja/${esc(st.page)}">${esc(st.titleJa)}</a><span>${esc(st.categoryLabel || '')}</span></li>`;
    }
    // 영문판은 번역된 글이면 영문 제목·영문 페이지로
    const en = T.lang === 'en' && st.titleEn;
    return `          <li><a href="/${en ? 'en/' : ''}${esc(st.page)}">${esc(en ? st.titleEn : st.title)}</a><span>${esc(st.categoryLabel || '')}</span></li>`;
  }).join('\n')}
        </ul>
      </section>` : '';

  const brandHtml = sameBrand.length ? `
      <section class="film-detail-block">
        <h2>${esc(T.sameBrand(film.brand))}</h2>
        <ul class="film-detail-siblings">
${sameBrand.map((other) => `          <li><a href="${P}/film/${esc(other.slug)}.html">${esc(displayNameOf(other))}</a><span>${esc([other.iso && `ISO ${other.iso}`, other.format].filter(Boolean).join(' · '))}</span></li>`).join('\n')}
        </ul>
      </section>` : '';

  return `<!DOCTYPE html>
<html lang="${T.lang}" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <base href="/">
  <meta name="color-scheme" content="light dark">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">

  <link rel="alternate" type="application/rss+xml" title="5ft magazine RSS" href="/rss.xml">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${esc(ogImage)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:site_name" content="${esc(SITE_NAME)}">
  <meta property="og:locale" content="${T.locale}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(ogImage)}">

  <link rel="icon" type="image/svg+xml" href="/img/favicon/icon.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="/img/favicon/icon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/img/favicon/icon-16.png">
  <link rel="shortcut icon" href="/img/favicon/favicon.ico">
  <link rel="apple-touch-icon" sizes="180x180" href="/img/favicon/icon-180.png">
  <script src="/js/theme-init.js"></script>${T.lang !== 'ko' ? `\n  <script src="${versioned('js/i18n.js')}"></script>` : ''}
  <link rel="stylesheet" href="/pretendard.css" />
  <link rel="stylesheet" href="${versioned('css/tokens.css')}">
  <link rel="stylesheet" href="${versioned('css/common.css')}">
  <link rel="stylesheet" href="${versioned('css/film-detail.css')}">
${jsonLd(film, sameBrand, T)}
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#111111">
</head>
<body>

<header>
  <div class="header-inner">
    <a href="${P}/" class="site-logo"><img decoding="async" src="/img/symbol-b.svg" alt="5ft magazine" class="logo-light" /><img decoding="async" src="/img/symbol-w.svg" alt="5ft magazine" class="logo-dark" /></a>
    ${navHtml(outFile)}
    <div class="nav-right">
      <a href="${P}/search.html" class="icon-btn" id="headerSearchBtn" aria-label="${T.search}" title="${T.search}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg></a>
      <button class="icon-btn" id="themeBtn" type="button" aria-label="${T.dark}" aria-pressed="false">☽</button>
      <button class="icon-btn hamburger" id="menuBtn" type="button" aria-label="${T.menu}" aria-controls="mobileNav" aria-expanded="false">☰</button>
    </div>
  </div>
  ${mobileNavHtml(outFile)}
</header>

<main class="film-detail">
  <nav class="film-detail-crumb" aria-label="${T.crumb}">
    <a href="${P}/">5ft magazine</a>
    <span aria-hidden="true">›</span>
    <a href="${P}/films.html">${T.catalog}</a>
  </nav>

  <div class="film-detail-head">
    ${thumb ? `<div class="film-detail-thumb"><img src="/${esc(String(thumb).replace(/^\.?\//, ''))}" alt="${esc(T.thumbAlt(name))}" width="240" height="320" decoding="async" /></div>` : ''}
    <div class="film-detail-headline">
      ${film.brand ? `<p class="film-detail-brand">${esc(film.brand)}</p>` : ''}
      <h1>${esc(name)}</h1>
      ${desc ? `<p class="film-detail-desc">${esc(desc)}</p>` : ''}
      <dl class="film-detail-spec">${specHtml}
      </dl>
    </div>
  </div>
${aliasHtml}
${photosHtml}
${articleHtml}
      ${brandHtml}

  <section class="film-detail-block film-reader" id="filmReaderPhotos" hidden
           data-film-slug="${esc(film.slug)}"
           data-film-label="${esc(name)}"
           data-film-names="${esc(JSON.stringify(filmNameCandidates(film)))}"></section>

  <section class="film-detail-cta">
    <p>${T.cta}</p>
    <div class="film-detail-cta-actions">
      <a class="film-detail-btn film-detail-btn-primary" href="${P}/films.html?film=${encodeURIComponent(film.slug)}">${T.ctaView}</a>
      <a class="film-detail-btn" href="${P}/films.html">${T.ctaAll}</a>
    </div>
  </section>
</main>

<footer>
  <div class="footer-inner-left">
    <span class="footer-logo">5ft magazine</span>
    ${footerPublisherHtml(outFile)}
  </div>
  ${footerHtml(outFile)}
  <span class="footer-copy">© 2026 5ft magazine</span>
</footer>

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js" defer></script>
<script src="${versioned('js/db/commerce.js')}" defer></script>
<script src="${versioned('js/db-client.js')}" defer></script>
<script src="${versioned('js/util.js')}" defer></script>
<script src="${versioned('js/site-common.js')}" defer></script>
<script src="${versioned('js/potw-picker.js')}" defer></script>
<script src="${versioned('js/film-detail.js')}" defer></script>
</body>
</html>
`;
}

(async function build() {
  const raw = await fs.readFile(FILMS_JSON, 'utf-8').catch(() => null);
  if (!raw) {
    console.warn('[build-film-pages] data/films.json 없음, skip');
    return;
  }
  const referenceHtml = await fs.readFile(REFERENCE_PAGE, 'utf-8');
  const versioned = assetVersionReader(referenceHtml, {
    'css/film-detail.css': await contentHash('css/film-detail.css'),
    'js/film-detail.js': await contentHash('js/film-detail.js'),
    // i18n.js 는 외국어 페이지만 싣는다. 영문 페이지들과 같은 버전을 쓴다(단일 버전 가드)
    'js/i18n.js': ((await fs.readFile(path.join(ROOT, 'en/about.html'), 'utf-8').catch(() => '')).match(/js\/i18n\.js\?v=([0-9A-Za-z-]+)/) || [])[1],
    // potw-picker.js 는 여기 넣지 않는다. films.html 에도 실려 bump-version 이
    // 관리하므로, 자체 해시를 붙이면 버전이 갈라져 단일 버전 가드에 걸린다.
  });

  const data = JSON.parse(raw);
  const films = (Array.isArray(data)
    ? data
    : Object.entries(data).map(([slug, film]) => ({ ...film, slug: film.slug || slug })))
    .filter((film) => film.slug && /^[a-z0-9-]+$/i.test(film.slug));

  const byBrand = new Map();
  for (const film of films) {
    if (!film.brand) continue;
    if (!byBrand.has(film.brand)) byBrand.set(film.brand, []);
    byBrand.get(film.brand).push(film);
  }

  // 필름 슬러그 → 그 필름을 다룬 발행 기사 (최신순)
  const storiesRaw = await fs.readFile(STORIES_JSON, 'utf-8').catch(() => null);
  const byFilm = new Map();
  if (storiesRaw) {
    const stories = JSON.parse(storiesRaw)
      .filter((st) => st.published !== false && Array.isArray(st.films) && st.films.length)
      .sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')));
    for (const st of stories) {
      for (const slug of st.films) {
        if (!byFilm.has(slug)) byFilm.set(slug, []);
        byFilm.get(slug).push(st);
      }
    }
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(EN_OUT_DIR, { recursive: true });
  await fs.mkdir(JA_OUT_DIR, { recursive: true });

  const written = [];
  for (const film of films) {
    const sameBrand = (byBrand.get(film.brand) || [])
      .filter((other) => other.slug !== film.slug)
      .slice(0, SAME_BRAND_LIMIT);
    for (const [dir, T] of [[OUT_DIR, TEXT.ko], [EN_OUT_DIR, TEXT.en], [JA_OUT_DIR, TEXT.ja]]) {
      const outFile = path.join(dir, `${film.slug}.html`);
      await fs.writeFile(outFile, render(film, sameBrand, versioned, outFile, byFilm.get(film.slug), T), 'utf-8');
      written.push(outFile);
    }
  }
  // 언어 대응 링크는 두 판이 다 써진 뒤에 붙인다(공통 셸과 같은 규칙, scripts/lib/site-shell.mjs)
  for (const file of written) {
    const alternates = alternatesHtml(file);
    if (!alternates) continue;
    const html = await fs.readFile(file, 'utf-8');
    await fs.writeFile(file, html.replace(/(<link rel="canonical" href="[^"]*">)/, `$1\n${alternates}`), 'utf-8');
  }
  const indexUpdated = await writeFilmIndex(films);
  await writeFilmIndex(films, TEXT.en, EN_INDEX_PAGE);
  await writeFilmIndex(films, TEXT.ja, JA_INDEX_PAGE);
  console.log(`[build-film-pages] ${films.length}개 필름 상세 페이지 생성: ${path.relative(ROOT, OUT_DIR)}/`);
  console.log(`[build-film-pages] films.html 전체 목록 ${indexUpdated ? '갱신' : '변경 없음'}`);
  console.log(`[build-film-pages] 기사가 연결된 필름 ${byFilm.size}종`);
})();
