// /labs/<region>.html 지역별 현상소·수리점 페이지 생성.
//
// labs.html 도 카탈로그 전체를 자바스크립트로 그려서 정적 본문이 440자뿐이었다.
// 현상소 92곳의 주소·스캔 화질·현상 가격이 전부 검색엔진과 AI 수집기에 보이지
// 않았는데, "광주 필름 현상소 가격" 같은 질문에 답이 되는 자료가 정확히 이것이다.
//
// 현상소 하나마다 페이지를 만들지 않고 지역으로 묶은 이유는 두 가지다.
// 검색이 지역 단위로 일어나고("서울 필름 현상소"), 한 곳당 정보량은 한 페이지를
// 채우기에 적다. 대신 지역 페이지 안에 각 현상소의 LocalBusiness 정보를 모두 싣는다.
//
// 수리점(repair_shops)도 같은 페이지에 싣는다. 수리점은 지금까지 자바스크립트로만
// 그려서 "부산 카메라 수리점" 같은 검색에 한 줄도 걸리지 않았다. 목록이 있어도
// 검색에서 찾을 수 없으면 없는 것과 같다.
//
// data/labs.json 과 data/repairs.json 이 원본이다(원본은 Supabase labs ·
// repair_shops 테이블, build-labs.mjs · build-repairs.mjs 가 dump).

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, navHtml, mobileNavHtml, footerHtml } from './lib/site-shell.mjs';

const LABS_JSON = path.join(ROOT, 'data/labs.json');
const REPAIRS_JSON = path.join(ROOT, 'data/repairs.json');
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
  // 2026-07-01 전남광주통합특별시 출범으로 광주·전남이 하나가 됐다.
  // 옛 주소 /labs/gwangju · /labs/jeonnam 은 netlify.toml 에서 이리로 넘긴다.
  ['경남', 'gyeongnam'], ['전남광주', 'jeonnamgwangju'], ['전북', 'jeonbuk'],
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

// 수리점 한 곳. 현상소와 같은 .lab-entry 마크업을 쓰고 담는 값만 다르다.
// 가격표 대신 전문 분야와 연락처가 들어간다.
function repairEntry(shop) {
  const description = (shop.description || '').trim();
  return `
      <article class="lab-entry">
        <h3 class="lab-entry-name">${esc(shop.name)}</h3>
        ${shop.address ? `<p class="lab-entry-address">${esc(shop.address)}</p>` : ''}
        ${shop.specialty ? `<p class="lab-entry-meta">전문 ${esc(shop.specialty)}</p>` : ''}
        ${shop.contact ? `<p class="lab-entry-meta">연락처 ${esc(shop.contact)}</p>` : ''}
        ${description ? `<p class="lab-entry-features">${esc(description).replace(/\n/g, '<br />')}</p>` : ''}
        ${shop.url ? `<p class="lab-entry-link"><a href="${esc(shop.url)}" target="_blank" rel="noopener nofollow">홈페이지 ↗</a></p>` : ''}
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

// contact 는 "010-0000-0000 · 0504-...", "카톡 아이디" 처럼 자유 형식이다.
// 전화번호로 읽히는 첫 토막만 telephone 에 넣고, 아니면 아예 넣지 않는다.
// 구조화 데이터에 전화가 아닌 값을 전화로 적으면 검색 결과에 그대로 나간다.
function telephoneOf(contact) {
  const first = String(contact || '').split('·')[0].trim();
  return /^[0-9][0-9-]{7,}$/.test(first) ? first : null;
}

// 현상소 쪽은 additionalType 에 위키데이터 항목을 달아 두었다. 수리점에는
// 달지 않는다. 카메라 수리업에 맞는 항목을 확인하지 못했고, 구조화 데이터에
// 엉뚱한 항목을 적으면 검색엔진이 업종을 잘못 읽는다. 업종은 knowsAbout 과
// description 으로 전한다.
function repairBusiness(shop) {
  const node = {
    '@type': 'LocalBusiness',
    name: shop.name,
  };
  if (shop.address) {
    node.address = {
      '@type': 'PostalAddress', addressCountry: 'KR',
      addressLocality: shop.region, streetAddress: shop.address,
    };
  }
  if (shop.specialty) node.knowsAbout = shop.specialty;
  if (shop.description) node.description = shop.description;
  const tel = telephoneOf(shop.contact);
  if (tel) node.telephone = tel;
  if (shop.url) node.url = shop.url;
  return node;
}

function itemList(name, items, toNode) {
  return {
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem', position: index + 1, item: toNode(item),
    })),
  };
}

// 제목과 설명에 쓰는 한 줄. 수리점이 없는 지역은 예전과 같은 문구를 유지한다.
function headline(region, labs, repairs) {
  const parts = [];
  if (labs.length) parts.push(`필름 현상소 ${labs.length}곳`);
  if (repairs.length) parts.push(`카메라 수리점 ${repairs.length}곳`);
  return `${region} ${parts.join(' · ')}`;
}

function jsonLd(region, labs, repairs, url) {
  const collection = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${region} 필름 현상소`,
    url,
    inLanguage: 'ko-KR',
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${ORIGIN}/` },
    mainEntity: [
      labs.length ? itemList(`${region} 필름 현상소`, labs, localBusiness) : null,
      repairs.length ? itemList(`${region} 카메라 수리점`, repairs, repairBusiness) : null,
    ].filter(Boolean),
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_NAME, item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: '필름 현상소', item: `${ORIGIN}/labs.html` },
      { '@type': 'ListItem', position: 3, name: headline(region, labs, repairs), item: url },
    ],
  };
  return [collection, breadcrumb]
    .map((node) => `  <script type="application/ld+json">\n${JSON.stringify(node, null, 2)}\n  </script>`)
    .join('\n');
}

function render(region, labs, repairs, others, versioned, outFile) {
  const slug = SLUG_BY_REGION.get(region);
  const url = `${ORIGIN}/labs/${slug}.html`;
  const title = `${headline(region, labs, repairs)} | 5ft magazine`;
  const cheapest = labs
    .map((lab) => lab.prices?.color?.['135']?.basic)
    .filter((value) => typeof value === 'number' && value > 0)
    .sort((a, b) => a - b)[0];
  const sentences = [];
  if (labs.length) {
    sentences.push(`${region}의 필름 현상소 ${labs.length}곳을 주소, 스캔 화질, 컬러·흑백·슬라이드 현상 가격과 함께 정리했습니다.`);
    if (cheapest) sentences.push(`135 컬러 기본 현상은 ${cheapest.toLocaleString('ko-KR')}원부터입니다.`);
  }
  if (repairs.length) {
    sentences.push(`${region}에서 카메라를 맡길 수 있는 수리점 ${repairs.length}곳의 전문 분야와 연락처도 함께 실었습니다.`);
  }
  const description = sentences.join(' ');
  const heading = repairs.length
    ? (labs.length ? `${region} 필름 현상소와 카메라 수리점` : `${region} 카메라 수리점`)
    : `${region} 필름 현상소`;
  const countLine = [
    labs.length ? `현상소 ${labs.length}곳` : '',
    repairs.length ? `수리점 ${repairs.length}곳` : '',
  ].filter(Boolean).join(' · ');

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
${jsonLd(region, labs, repairs, url)}
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
    <h1>${esc(heading)}</h1>
    <p class="lab-region-count">${esc(countLine)}</p>
    <p class="lab-region-desc">${esc(description)}</p>
  </header>

  <div class="lab-region-list">
${labs.map(labCard).join('\n')}
  </div>
${repairs.length ? `
  <section class="lab-region-repairs" aria-labelledby="repairTitle">
    <h2 id="repairTitle">${esc(region)} 카메라 수리점 ${repairs.length}곳</h2>
    <p class="lab-region-sub">필름카메라를 맡길 수 있는 곳입니다. 취급 기종과 비용은 바뀔 수 있으니 가기 전에 물어보시는 편이 좋습니다.</p>
    <div class="lab-region-list">
${repairs.map(repairEntry).join('\n')}
    </div>
  </section>` : ''}

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
// 크롤러가 읽을 내용이 없었다. 링크는 이 목록의 지역 필터로 보낸다.
// 지역 페이지(/labs/<region>.html)는 검색 전용이라 독자가 그쪽으로 들어가지
// 않게 하고, 색인은 sitemap 과 지역 페이지끼리의 상호 링크로 이뤄진다.
// labs.html 의 마커 한 쌍 사이를 채운다. 현상소와 수리점이 같은 모양이라
// 마커 이름과 문구만 달리 받는다.
async function writeIndex(marker, summary, sub, groups, itemHref) {
  const line = (item) => (itemHref
    ? `        <li><a href="${esc(itemHref(item))}">${esc(item.name)}</a></li>`
    : `        <li>${esc(item.name)}</li>`);
  const html = groups.map(([label, href, items]) => `    <div class="lab-index-region">
      <h3><a href="${esc(href)}">${esc(label)}</a> <span>${items.length}곳</span></h3>
      <ul>
${items.map(line).join('\n')}
      </ul>
    </div>`).join('\n');

  const page = path.join(ROOT, 'labs.html');
  const source = await fs.readFile(page, 'utf-8');
  // details 로 접어 둔다. 접혀 있어도 마크업은 HTML 에 그대로 남아 크롤러가
  // 읽고 링크를 따라간다. 화면에서만 기본으로 감춘다.
  const pattern = new RegExp(`<!-- ${marker}:START -->[\\s\\S]*?<!-- ${marker}:END -->`);
  if (!pattern.test(source)) {
    console.warn(`[build-lab-pages] labs.html 에 ${marker} 마커가 없음, skip`);
    return false;
  }
  const next = source.replace(pattern, `<!-- ${marker}:START -->
  <details class="lab-index-fold">
    <summary>${esc(summary)}</summary>
    <p class="lab-index-sub">${esc(sub)}</p>
    <div class="lab-index-grid">
${html}
    </div>
  </details>
  <!-- ${marker}:END -->`);
  if (next !== source) {
    await fs.writeFile(page, next, 'utf-8');
    return true;
  }
  return false;
}

// name + region 으로 만든 슬러그. labs-page.js 의 itemSlug 와 같은 규칙이라
// ?lab=<슬러그> 로 들어가면 그 수리점 상세가 바로 열린다. 목록 페이지는 항상
// 현상소 탭으로 뜨지만, 슬러그가 수리점 쪽에서 찾아지면 탭이 따라 바뀐다.
function itemSlug(item) {
  return `${item.name}-${item.region || ''}`.toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

(async function build() {
  const raw = await fs.readFile(LABS_JSON, 'utf-8').catch(() => null);
  if (!raw) {
    console.warn('[build-lab-pages] data/labs.json 없음, skip');
    return;
  }
  // 수리점은 없어도 현상소 페이지는 만든다. 반대로 파일이 비어 있을 때
  // 마커 사이를 "0곳" 으로 덮어쓰지는 않는다 (아래 writeIndex 호출 조건).
  const repairsRaw = await fs.readFile(REPAIRS_JSON, 'utf-8').catch(() => null);
  const repairsParsed = repairsRaw ? JSON.parse(repairsRaw) : null;
  const allRepairs = (Array.isArray(repairsParsed) ? repairsParsed : repairsParsed?.repairs || [])
    .filter((shop) => shop?.name);
  if (!allRepairs.length) {
    console.warn('[build-lab-pages] data/repairs.json 이 비어 있음, 수리점 목록은 건드리지 않는다');
  }
  const referenceHtml = await fs.readFile(REFERENCE_PAGE, 'utf-8');
  const versioned = assetVersionReader(referenceHtml, {
    'css/lab-region.css': await contentHash('css/lab-region.css'),
  });

  const parsed = JSON.parse(raw);
  const labs = (Array.isArray(parsed) ? parsed : parsed.labs || [])
    .filter((lab) => lab?.name && SLUG_BY_REGION.has(lab.region));

  const byName = (a, b) => a.name.localeCompare(b.name, 'ko');
  const byRegion = new Map();
  const repairsByRegion = new Map();
  for (const [region] of REGIONS) {
    const inRegion = labs.filter((lab) => lab.region === region).sort(byName);
    if (inRegion.length) byRegion.set(region, inRegion);
    const shops = allRepairs.filter((shop) => shop.region === region).sort(byName);
    if (shops.length) repairsByRegion.set(region, shops);
  }
  // 지역이 비어 있는 수리점이 있다. 시드에 주소를 넣지 않은 네 곳이 그렇다.
  // 지역 페이지에는 실을 자리가 없으므로 labs.html 목록에서만 따로 묶는다.
  // 빠뜨리면 목록에서 통째로 사라진다.
  const noRegion = allRepairs.filter((shop) => !SLUG_BY_REGION.has(shop.region)).sort(byName);

  await fs.mkdir(OUT_DIR, { recursive: true });

  // 수리점만 있고 현상소가 없는 지역도 페이지를 만든다.
  const pageRegions = REGIONS.map(([region]) => region)
    .filter((region) => byRegion.has(region) || repairsByRegion.has(region));

  for (const region of pageRegions) {
    const others = [...byRegion.entries()]
      .filter(([name]) => name !== region)
      .map(([name, list]) => [name, SLUG_BY_REGION.get(name), list.length]);
    const outFile = path.join(OUT_DIR, `${SLUG_BY_REGION.get(region)}.html`);
    const page = render(region, byRegion.get(region) || [], repairsByRegion.get(region) || [],
      others, versioned, outFile);
    await fs.writeFile(outFile, page, 'utf-8');
  }

  const labTotal = [...byRegion.values()].reduce((sum, list) => sum + list.length, 0);
  const labIndexUpdated = await writeIndex(
    'LAB-INDEX',
    `지역별 현상소 ${labTotal}곳`,
    '지역 이름을 누르면 그 지역 현상소의 주소와 현상 가격을 한 번에 볼 수 있어요.',
    [...byRegion.entries()].map(([region, list]) =>
      [region, `./labs.html?region=${encodeURIComponent(region)}`, list]),
  );

  // 수리점은 가게마다 ?lab=<슬러그> 링크를 단다. 현상소와 달리 지역이 비어
  // 있는 곳이 있어서 지역 링크만으로는 닿지 않는 가게가 생기기 때문이다.
  let repairIndexUpdated = false;
  if (allRepairs.length) {
    const groups = [...repairsByRegion.entries()].map(([region, list]) =>
      [region, `./labs.html?region=${encodeURIComponent(region)}`, list]);
    if (noRegion.length) groups.push(['지역 등록 전', './labs.html', noRegion]);
    repairIndexUpdated = await writeIndex(
      'REPAIR-INDEX',
      `지역별 카메라 수리점 ${allRepairs.length}곳`,
      '필름카메라를 맡길 수 있는 곳이에요. 이름을 누르면 전문 분야와 연락처가 열려요.',
      groups,
      (shop) => `./labs.html?lab=${encodeURIComponent(itemSlug(shop))}`,
    );
  }

  const skipped = labs.length - labTotal;
  console.log(`[build-lab-pages] ${pageRegions.length}개 지역 페이지 생성 (현상소 ${labs.length}곳${skipped ? `, 지역 미분류 ${skipped}곳 제외` : ''}, 수리점 ${allRepairs.length}곳): ${path.relative(ROOT, OUT_DIR)}/`);
  console.log(`[build-lab-pages] labs.html 현상소 목록 ${labIndexUpdated ? '갱신' : '변경 없음'} · 수리점 목록 ${repairIndexUpdated ? '갱신' : '변경 없음'}`);
})();
