// /labs/<region>.html 지역별 현상소 페이지 생성.
//
// labs.html 도 카탈로그 전체를 자바스크립트로 그려서 정적 본문이 440자뿐이었다.
// 현상소 92곳의 주소·스캔 화질·현상 가격이 전부 검색엔진과 AI 수집기에 보이지
// 않았는데, "광주 필름 현상소 가격" 같은 질문에 답이 되는 자료가 정확히 이것이다.
//
// 현상소 하나마다 페이지를 만들지 않고 지역으로 묶은 이유는 두 가지다.
// 검색이 지역 단위로 일어나고("서울 필름 현상소"), 한 곳당 정보량은 한 페이지를
// 채우기에 적다. 대신 지역 페이지 안에 각 현상소의 LocalBusiness 정보를 모두 싣는다.
//
// data/labs.json 이 원본이다(원본은 Supabase labs 테이블, build-labs.mjs 가 dump).

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, navHtml, mobileNavHtml, footerHtml } from './lib/site-shell.mjs';

const LABS_JSON = path.join(ROOT, 'data/labs.json');
const OUT_DIR = path.join(ROOT, 'labs');
const REFERENCE_PAGE = path.join(ROOT, 'labs.html');

const ORIGIN = 'https://www.5ftmag.com';
const SITE_NAME = '5ft magazine';
const FALLBACK_OG = `${ORIGIN}/img/og/5ft-link1.webp`;

// labs-page.js 의 REGION_ORDER 와 같은 순서. 주소 표기용 영문 slug 를 함께 둔다.
const REGIONS = [
  ['서울', 'seoul'], ['경기', 'gyeonggi'], ['인천', 'incheon'], ['강원', 'gangwon'],
  ['대전', 'daejeon'], ['충남', 'chungnam'], ['충북', 'chungbuk'], ['세종', 'sejong'],
  ['대구', 'daegu'], ['경북', 'gyeongbuk'], ['부산', 'busan'], ['울산', 'ulsan'],
  ['경남', 'gyeongnam'], ['광주', 'gwangju'], ['전북', 'jeonbuk'], ['전남', 'jeonnam'],
  ['제주', 'jeju'],
];
const SLUG_BY_REGION = new Map(REGIONS);

// 가격표에 싣는 종류와 포맷. data/labs.json 의 prices 키를 그대로 따른다.
const FILM_KINDS = [['color', '컬러'], ['bw', '흑백'], ['slide', '슬라이드'], ['cinema', '시네마']];
const FORMATS = [['135', '135'], ['120', '120']];

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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

function won(value) {
  return typeof value === 'number' && value > 0 ? `${value.toLocaleString('ko-KR')}원` : '';
}

// 한 현상소의 가격을 종류 × 포맷 표로 만든다. 값이 하나도 없으면 표를 생략한다.
function priceTable(lab) {
  const prices = lab.prices || {};
  const rows = FILM_KINDS.map(([key, label]) => {
    const cells = FORMATS.map(([format]) => {
      const entry = prices[key]?.[format];
      if (!entry) return '';
      const basic = won(entry.basic);
      const high = won(entry.high);
      if (!basic && !high) return '';
      if (basic && high) return `${basic} <span class="lab-price-high">고해상 ${high}</span>`;
      return basic || `고해상 ${high}`;
    });
    return cells.some(Boolean) ? [label, cells] : null;
  }).filter(Boolean);

  if (!rows.length) return '';
  return `
        <table class="lab-price-table">
          <caption class="sr-only">${esc(lab.name)} 현상 가격</caption>
          <thead>
            <tr><th scope="col">종류</th>${FORMATS.map(([, label]) => `<th scope="col">${esc(label)}</th>`).join('')}</tr>
          </thead>
          <tbody>
${rows.map(([label, cells]) => `            <tr><th scope="row">${esc(label)}</th>${cells.map((cell) => `<td>${cell || '<span class="lab-price-none">-</span>'}</td>`).join('')}</tr>`).join('\n')}
          </tbody>
        </table>`;
}

function labCard(lab) {
  const features = (lab.features || '').trim();
  return `
      <article class="lab-entry">
        <h3 class="lab-entry-name">${esc(lab.name)}</h3>
        <p class="lab-entry-address">${esc(lab.address || '')}</p>
        ${lab.scanRes ? `<p class="lab-entry-meta">기본 스캔 ${esc(lab.scanRes)}</p>` : ''}
        ${features ? `<p class="lab-entry-features">${esc(features).replace(/\n/g, '<br />')}</p>` : ''}
        ${priceTable(lab)}
        ${lab.url ? `<p class="lab-entry-link"><a href="${esc(lab.url)}" target="_blank" rel="noopener nofollow">홈페이지 ↗</a></p>` : ''}
      </article>`;
}

function localBusiness(lab) {
  const node = {
    '@type': 'LocalBusiness',
    name: lab.name,
    address: { '@type': 'PostalAddress', addressCountry: 'KR', addressLocality: lab.region, streetAddress: lab.address },
    additionalType: 'https://www.wikidata.org/wiki/Q1155589',
  };
  if (lab.url) node.url = lab.url;
  if (typeof lab.lat === 'number' && typeof lab.lng === 'number') {
    node.geo = { '@type': 'GeoCoordinates', latitude: lab.lat, longitude: lab.lng };
  }
  return node;
}

function jsonLd(region, labs, url) {
  const collection = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${region} 필름 현상소`,
    url,
    inLanguage: 'ko-KR',
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${ORIGIN}/` },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: labs.length,
      itemListElement: labs.map((lab, index) => ({
        '@type': 'ListItem', position: index + 1, item: localBusiness(lab),
      })),
    },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_NAME, item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: '필름 현상소', item: `${ORIGIN}/labs.html` },
      { '@type': 'ListItem', position: 3, name: `${region} 필름 현상소`, item: url },
    ],
  };
  return [collection, breadcrumb]
    .map((node) => `  <script type="application/ld+json">\n${JSON.stringify(node, null, 2)}\n  </script>`)
    .join('\n');
}

function render(region, labs, others, versioned, outFile) {
  const slug = SLUG_BY_REGION.get(region);
  const url = `${ORIGIN}/labs/${slug}.html`;
  const title = `${region} 필름 현상소 ${labs.length}곳 | 5ft magazine`;
  const cheapest = labs
    .map((lab) => lab.prices?.color?.['135']?.basic)
    .filter((value) => typeof value === 'number' && value > 0)
    .sort((a, b) => a - b)[0];
  const description = `${region}의 필름 현상소 ${labs.length}곳을 주소, 스캔 화질, 컬러·흑백·슬라이드 현상 가격과 함께 정리했습니다.${cheapest ? ` 135 컬러 기본 현상은 ${cheapest.toLocaleString('ko-KR')}원부터입니다.` : ''}`;

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
  <meta property="og:image" content="${esc(FALLBACK_OG)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:site_name" content="${esc(SITE_NAME)}">
  <meta property="og:locale" content="ko_KR">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(FALLBACK_OG)}">

  <link rel="icon" type="image/svg+xml" href="/img/favicon/icon.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="/img/favicon/icon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/img/favicon/icon-16.png">
  <link rel="shortcut icon" href="/img/favicon/favicon.ico">
  <link rel="apple-touch-icon" sizes="180x180" href="/img/favicon/icon-180.png">
  <script src="/js/theme-init.js"></script>
  <link rel="stylesheet" href="/pretendard.css" />
  <link rel="stylesheet" href="${versioned('css/tokens.css')}">
  <link rel="stylesheet" href="${versioned('css/common.css')}">
  <link rel="stylesheet" href="${versioned('css/lab-region.css')}">
${jsonLd(region, labs, url)}
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

<main class="lab-region">
  <nav class="lab-region-crumb" aria-label="현재 위치">
    <a href="/">5ft magazine</a>
    <span aria-hidden="true">›</span>
    <a href="/labs.html">필름 현상소</a>
  </nav>

  <header class="lab-region-head">
    <h1>${esc(region)} 필름 현상소</h1>
    <p class="lab-region-count">${labs.length}곳</p>
    <p class="lab-region-desc">${esc(description)}</p>
  </header>

  <div class="lab-region-list">
${labs.map(labCard).join('\n')}
  </div>

  <section class="lab-region-nav">
    <h2>다른 지역</h2>
    <ul>
${others.map(([name, otherSlug, count]) => `      <li><a href="/labs/${esc(otherSlug)}.html">${esc(name)}</a><span>${count}곳</span></li>`).join('\n')}
    </ul>
  </section>

  <section class="lab-region-cta">
    <p>가격과 정보는 바뀔 수 있습니다. 지도에서 위치를 보거나 정정할 내용이 있으면 전체 목록에서 알려주세요.</p>
    <a class="lab-region-btn" href="/labs.html">전국 현상소 목록·지도</a>
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

<script src="${versioned('js/util.js')}" defer></script>
<script src="${versioned('js/site-common.js')}" defer></script>
</body>
</html>
`;
}

// labs.html 하단에 지역별 현상소 목록을 넣는다. 이 페이지도 본문이 440자뿐이라
// 크롤러가 읽을 내용이 없었고, 지역 페이지로 갈 링크도 없었다.
async function writeLabIndex(byRegion) {
  const html = [...byRegion.entries()].map(([region, labs]) => `    <div class="lab-index-region">
      <h3><a href="./labs/${esc(SLUG_BY_REGION.get(region))}.html">${esc(region)}</a> <span>${labs.length}곳</span></h3>
      <ul>
${labs.map((lab) => `        <li>${esc(lab.name)}</li>`).join('\n')}
      </ul>
    </div>`).join('\n');

  const page = path.join(ROOT, 'labs.html');
  const source = await fs.readFile(page, 'utf-8');
  // details 로 접어 둔다. 접혀 있어도 마크업은 HTML 에 그대로 남아 크롤러가
  // 읽고 링크를 따라간다. 화면에서만 기본으로 감춘다.
  const total = [...byRegion.values()].reduce((sum, list) => sum + list.length, 0);
  const next = source.replace(
    /<!-- LAB-INDEX:START -->[\s\S]*?<!-- LAB-INDEX:END -->/,
    `<!-- LAB-INDEX:START -->
  <details class="lab-index-fold">
    <summary>지역별 현상소 ${total}곳</summary>
    <p class="lab-index-sub">지역 이름을 누르면 그 지역 현상소의 주소와 현상 가격을 한 번에 볼 수 있어요.</p>
    <div class="lab-index-grid">
${html}
    </div>
  </details>
  <!-- LAB-INDEX:END -->`,
  );
  if (next !== source) {
    await fs.writeFile(page, next, 'utf-8');
    return true;
  }
  return false;
}

(async function build() {
  const raw = await fs.readFile(LABS_JSON, 'utf-8').catch(() => null);
  if (!raw) {
    console.warn('[build-lab-pages] data/labs.json 없음, skip');
    return;
  }
  const referenceHtml = await fs.readFile(REFERENCE_PAGE, 'utf-8');
  const versioned = assetVersionReader(referenceHtml, {
    'css/lab-region.css': await contentHash('css/lab-region.css'),
  });

  const parsed = JSON.parse(raw);
  const labs = (Array.isArray(parsed) ? parsed : parsed.labs || [])
    .filter((lab) => lab?.name && SLUG_BY_REGION.has(lab.region));

  const byRegion = new Map();
  for (const [region] of REGIONS) {
    const inRegion = labs.filter((lab) => lab.region === region)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    if (inRegion.length) byRegion.set(region, inRegion);
  }

  await fs.mkdir(OUT_DIR, { recursive: true });

  for (const [region, inRegion] of byRegion) {
    const others = [...byRegion.entries()]
      .filter(([name]) => name !== region)
      .map(([name, list]) => [name, SLUG_BY_REGION.get(name), list.length]);
    const outFile = path.join(OUT_DIR, `${SLUG_BY_REGION.get(region)}.html`);
    await fs.writeFile(outFile, render(region, inRegion, others, versioned, outFile), 'utf-8');
  }

  const indexUpdated = await writeLabIndex(byRegion);
  const skipped = labs.length - [...byRegion.values()].reduce((sum, list) => sum + list.length, 0);
  console.log(`[build-lab-pages] ${byRegion.size}개 지역 페이지 생성 (현상소 ${labs.length}곳${skipped ? `, 지역 미분류 ${skipped}곳 제외` : ''}): ${path.relative(ROOT, OUT_DIR)}/`);
  console.log(`[build-lab-pages] labs.html 지역 목록 ${indexUpdated ? '갱신' : '변경 없음'}`);
})();
