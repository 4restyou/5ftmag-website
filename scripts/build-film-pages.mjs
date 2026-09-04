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
import { ROOT, navHtml, mobileNavHtml, footerHtml } from './lib/site-shell.mjs';

const FILMS_JSON = path.join(ROOT, 'data/films.json');
const OUT_DIR = path.join(ROOT, 'film');
const REFERENCE_PAGE = path.join(ROOT, 'films.html');
const STORIES_JSON = path.join(ROOT, 'data/stories.json');

const ORIGIN = 'https://www.5ftmag.com';
const SITE_NAME = '5ft magazine';
const FALLBACK_OG = `${ORIGIN}/img/og/5ft-link1.webp`;
const SAME_BRAND_LIMIT = 8;

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
function descriptionOf(film) {
  const desc = (film.desc || '').trim();
  if (desc) return desc.length > 180 ? `${desc.slice(0, 177)}…` : desc;
  const parts = [film.brand, film.iso && `ISO ${film.iso}`, film.type, film.format].filter(Boolean);
  return `${parts.join(' · ')} 필름. 5ft.mag 필름 카탈로그에서 규격과 독자들이 찍은 사진을 확인하세요.`;
}

// 별칭에는 한글 표기가 섞여 있다("코닥 울트라맥스 400"). 검색어와 직접 맞물리는
// 부분이라 페이지에 그대로 노출한다. 표시 이름과 겹치는 항목은 뺀다.
function aliasesOf(film) {
  const name = displayNameOf(film).toLowerCase();
  const seen = new Set([name]);
  const out = [];
  for (const alias of film.aliases || []) {
    const key = String(alias).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(alias).trim());
  }
  return out;
}

function specRows(film) {
  return [
    ['브랜드', film.brand],
    ['감도', film.iso ? `ISO ${film.iso}` : ''],
    ['종류', film.type],
    ['포맷', film.format],
    ['수록 호', film.issue],
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

function jsonLd(film, sameBrand) {
  const name = displayNameOf(film);
  const url = `${ORIGIN}/film/${film.slug}.html`;
  const properties = specRows(film).map(([label, value]) => ({
    '@type': 'PropertyValue', name: label, value: String(value),
  }));
  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description: descriptionOf(film),
    url,
    category: '사진 필름',
    inLanguage: 'ko-KR',
  };
  if (film.brand) product.brand = { '@type': 'Brand', name: film.brand };
  const image = thumbnailOf(film);
  if (image) product.image = [absoluteImage(image)];
  const alternateName = aliasesOf(film);
  if (alternateName.length) product.alternateName = alternateName;
  if (properties.length) product.additionalProperty = properties;
  if (sameBrand.length) {
    product.isRelatedTo = sameBrand.map((other) => ({
      '@type': 'Product', name: displayNameOf(other), url: `${ORIGIN}/film/${other.slug}.html`,
    }));
  }

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '5ft magazine', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: '필름 카탈로그', item: `${ORIGIN}/films.html` },
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
async function writeFilmIndex(films) {
  const byBrand = new Map();
  for (const film of films) {
    const brand = film.brand || '기타';
    if (!byBrand.has(brand)) byBrand.set(brand, []);
    byBrand.get(brand).push(film);
  }
  const brands = [...byBrand.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  const html = brands.map((brand) => {
    const items = byBrand.get(brand)
      .sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b), 'ko'))
      .map((film) => `        <li><a href="./films.html?film=${encodeURIComponent(film.slug)}">${esc(displayNameOf(film))}</a></li>`)
      .join('\n');
    return `    <div class="film-index-brand">
      <h3>${esc(brand)}</h3>
      <ul>
${items}
      </ul>
    </div>`;
  }).join('\n');

  const page = path.join(ROOT, 'films.html');
  const source = await fs.readFile(page, 'utf-8');
  // details 로 접어 둔다. 접혀 있어도 마크업은 HTML 에 그대로 남아 크롤러가
  // 읽고 링크를 따라간다. 화면에서만 기본으로 감춘다.
  const next = source.replace(
    /<!-- FILM-INDEX:START -->[\s\S]*?<!-- FILM-INDEX:END -->/,
    `<!-- FILM-INDEX:START -->
  <details class="film-index-fold">
    <summary>필름 전체 목록 ${films.length}종</summary>
    <p class="film-index-sub">브랜드별로 정리한 필름 카탈로그입니다. 이름을 누르면 규격과 설명을 볼 수 있어요.</p>
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

function render(film, sameBrand, versioned, outFile, articles) {
  const name = displayNameOf(film);
  const title = `${name} | 5ft magazine`;
  const description = descriptionOf(film);
  const url = `${ORIGIN}/film/${film.slug}.html`;
  const ogImage = absoluteImage(thumbnailOf(film));
  const thumb = thumbnailOf(film);
  const aliases = aliasesOf(film);
  const rows = specRows(film);

  const specHtml = rows.map(([label, value]) => `
        <div class="film-detail-spec-row">
          <dt>${esc(label)}</dt>
          <dd>${esc(value)}</dd>
        </div>`).join('');

  const aliasHtml = aliases.length ? `
      <section class="film-detail-block">
        <h2>다르게 부르는 이름</h2>
        <ul class="film-detail-aliases">
${aliases.map((alias) => `          <li>${esc(alias)}</li>`).join('\n')}
        </ul>
      </section>` : '';

  const photos = Array.isArray(film.photos) ? film.photos.filter((p) => p?.src).slice(0, 12) : [];
  const photosHtml = photos.length ? `
      <section class="film-detail-block">
        <h2>${esc(name)} 로 찍은 사진</h2>
        <div class="film-detail-photos">
${photos.map((photo) => `          <figure>
            <img src="/${esc(String(photo.src).replace(/^\.?\//, ''))}" alt="${esc(name)} 로 찍은 사진${photo.author ? `. 촬영 ${esc(photo.author)}` : ''}" loading="lazy" decoding="async" />
${photo.author ? `            <figcaption>${esc(photo.author)}</figcaption>` : ''}
          </figure>`).join('\n')}
        </div>
      </section>` : '';

  // 이 필름을 다룬 기사. data/stories.json 의 films 배열이 근거다.
  // 카탈로그 모달의 "이 필름으로 쓴 글" 링크도 같은 데이터를 쓴다.
  const articleHtml = (articles && articles.length) ? `
      <section class="film-detail-block">
        <h2>${esc(name)} 를 다룬 글</h2>
        <ul class="film-detail-articles">
${articles.map((st) => `          <li><a href="/${esc(st.page)}">${esc(st.title)}</a><span>${esc(st.categoryLabel || '')}</span></li>`).join('\n')}
        </ul>
      </section>` : '';

  const brandHtml = sameBrand.length ? `
      <section class="film-detail-block">
        <h2>${esc(film.brand)} 의 다른 필름</h2>
        <ul class="film-detail-siblings">
${sameBrand.map((other) => `          <li><a href="/film/${esc(other.slug)}.html">${esc(displayNameOf(other))}</a><span>${esc([other.iso && `ISO ${other.iso}`, other.format].filter(Boolean).join(' · '))}</span></li>`).join('\n')}
        </ul>
      </section>` : '';

  return `<!DOCTYPE html>
<html lang="ko" data-theme="light">
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
  <meta property="og:locale" content="ko_KR">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(ogImage)}">

  <link rel="icon" type="image/svg+xml" href="/img/favicon/icon.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="/img/favicon/icon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/img/favicon/icon-16.png">
  <link rel="shortcut icon" href="/img/favicon/favicon.ico">
  <link rel="apple-touch-icon" sizes="180x180" href="/img/favicon/icon-180.png">
  <script src="/js/theme-init.js"></script>
  <link rel="stylesheet" href="/pretendard.css" />
  <link rel="stylesheet" href="${versioned('css/tokens.css')}">
  <link rel="stylesheet" href="${versioned('css/common.css')}">
  <link rel="stylesheet" href="${versioned('css/film-detail.css')}">
${jsonLd(film, sameBrand)}
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#111111">
</head>
<body>

<header>
  <div class="header-inner">
    <a href="/" class="site-logo"><img decoding="async" src="/img/symbol-b.svg" alt="5ft magazine" class="logo-light" /><img decoding="async" src="/img/symbol-w.svg" alt="5ft magazine" class="logo-dark" /></a>
    ${navHtml(outFile)}
    <div class="nav-right">
      <a href="/search.html" class="icon-btn" id="headerSearchBtn" aria-label="전체 검색" title="전체 검색"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg></a>
      <button class="icon-btn" id="themeBtn" type="button" aria-label="다크 모드로 전환" aria-pressed="false">☽</button>
      <button class="icon-btn hamburger" id="menuBtn" type="button" aria-label="메뉴 열기" aria-controls="mobileNav" aria-expanded="false">☰</button>
    </div>
  </div>
  ${mobileNavHtml(outFile)}
</header>

<main class="film-detail">
  <nav class="film-detail-crumb" aria-label="현재 위치">
    <a href="/">5ft magazine</a>
    <span aria-hidden="true">›</span>
    <a href="/films.html">필름 카탈로그</a>
  </nav>

  <div class="film-detail-head">
    ${thumb ? `<div class="film-detail-thumb"><img src="/${esc(String(thumb).replace(/^\.?\//, ''))}" alt="${esc(name)} 필름" width="240" height="320" decoding="async" /></div>` : ''}
    <div class="film-detail-headline">
      ${film.brand ? `<p class="film-detail-brand">${esc(film.brand)}</p>` : ''}
      <h1>${esc(name)}</h1>
      ${film.desc ? `<p class="film-detail-desc">${esc(film.desc)}</p>` : ''}
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
    <p>카탈로그에서는 이 필름으로 찍은 사진을 촬영자·카메라별로 골라 보고, 직접 올릴 수도 있습니다.</p>
    <div class="film-detail-cta-actions">
      <a class="film-detail-btn film-detail-btn-primary" href="/films.html?film=${encodeURIComponent(film.slug)}">카탈로그에서 보기</a>
      <a class="film-detail-btn" href="/films.html">필름 전체 목록</a>
    </div>
  </section>
</main>

<footer>
  <div class="footer-inner-left">
    <span class="footer-logo">5ft magazine</span>
    <span class="footer-publisher">발행처 4rest · 편집 박순렬 · 전남광주통합특별시 동구 충장로46번길 8, 2층</span>
  </div>
  ${footerHtml(outFile)}
  <span class="footer-copy">© 2026 5ft magazine</span>
</footer>

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js" defer></script>
<script src="${versioned('js/db/commerce.js')}" defer></script>
<script src="${versioned('js/db-client.js')}" defer></script>
<script src="${versioned('js/util.js')}" defer></script>
<script src="${versioned('js/site-common.js')}" defer></script>
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

  for (const film of films) {
    const sameBrand = (byBrand.get(film.brand) || [])
      .filter((other) => other.slug !== film.slug)
      .slice(0, SAME_BRAND_LIMIT);
    const outFile = path.join(OUT_DIR, `${film.slug}.html`);
    await fs.writeFile(outFile, render(film, sameBrand, versioned, outFile, byFilm.get(film.slug)), 'utf-8');
  }
  const indexUpdated = await writeFilmIndex(films);
  console.log(`[build-film-pages] ${films.length}개 필름 상세 페이지 생성: ${path.relative(ROOT, OUT_DIR)}/`);
  console.log(`[build-film-pages] films.html 전체 목록 ${indexUpdated ? '갱신' : '변경 없음'}`);
  console.log(`[build-film-pages] 기사가 연결된 필름 ${byFilm.size}종`);
})();
