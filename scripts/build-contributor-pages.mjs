/**
 * 작가별 사진 페이지 생성 — /contributor/<키>.html
 *
 * 카탈로그에는 이미 작가별 모아보기가 있고 /contributor/<키> 주소도 동작했다.
 * 다만 그 주소는 films.html 을 그대로 내려주는 SPA 경로라, 링크를 공유하면
 * 미리보기에 필름 카탈로그의 기본 제목과 이미지가 떴다. 누구의 사진인지
 * 알 수 없었다.
 *
 * 그래서 작가마다 정적 페이지를 만들어 제목·설명·대표 이미지를 박는다.
 * 메신저 미리보기는 <meta> 만 읽으므로 이 정적 내용을 그대로 가져간다.
 * 사람이 열면 곧바로 카탈로그의 작가 뷰로 넘어간다(#675 의 독자 동선 규칙).
 *
 * 자동 이동을 넣으면 검색 색인은 포기하게 된다. 구글은 자바스크립트를
 * 실행하므로 이 페이지를 "다른 데로 보내는 주소" 로 보고 색인에서 뺀다.
 * 대신 잃는 것이 작다고 판단했다. 독자 아이디로 검색하는 사람은 거의 없고,
 * 이 페이지의 값어치는 검색이 아니라 미리보기에 있다. 미리보기는 메신저가
 * <meta> 만 읽으므로 자동 이동과 무관하게 유지된다.
 * 같은 이유로 사이트맵에도 싣지 않는다.
 *
 * 대표 이미지는 그 작가의 가장 최근 사진으로 고정한다. 무작위로 뽑으면
 * 빌드할 때마다 바뀌어서, 이미 공유된 링크의 미리보기와 어긋난다. 메신저는
 * 미리보기를 한 번 읽어 캐시하므로 어차피 매번 다르게 보일 수도 없다.
 *
 * 환경변수 (선택):
 *   SUPABASE_URL / SUPABASE_ANON_KEY — 기본값은 운영 프로젝트의 공개 키
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, navHtml, mobileNavHtml, footerHtml } from './lib/site-shell.mjs';

const OUT_DIR = path.join(ROOT, 'contributor');
const FILMS_JSON = path.join(ROOT, 'data/films.json');
const REFERENCE_PAGE = path.join(ROOT, 'films.html');

const ORIGIN = 'https://www.5ftmag.com';
const SITE_NAME = '5ft magazine';
const FALLBACK_OG = `${ORIGIN}/img/og/5ft-link1.webp`;

// 한 사람이 아주 많이 올려도 페이지가 무거워지지 않게 자른다.
// 실제 열람은 카탈로그가 하고, 이 페이지는 색인과 미리보기가 목적이다.
const PHOTO_LIMIT = 24;
// 사진이 이보다 적으면 페이지를 만들지 않는다. 한두 장짜리 페이지가 수백 개
// 생기면 색인에 도움이 안 되고 관리만 늘어난다.
const MIN_PHOTOS = 3;

const SUPABASE_URL = process.env.SUPABASE_URL
  || 'https://pucpqsfwqouqohwsvmnd.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1Y3Bxc2Z3cW91cW9od3N2bW5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjYyMDUsImV4cCI6MjA5Mzc0MjIwNX0.adLzT0UrX3e1IbkQ70G6LeFWeKbuGaa0PTL6AmrSBD8';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// js/films-utils.js 의 normalizeContributorKey 와 같은 규칙이어야 한다.
// 다르면 정적 페이지의 주소와 카탈로그 딥링크가 어긋나 빈 화면이 뜬다.
function normalizeContributorKey(value) {
  return String(value ?? '').trim().replace(/^@/, '').toLowerCase();
}

// 주소에 쓸 수 있는 키만 페이지로 만든다. 한글 이름 등은 카탈로그 SPA 경로로
// 그대로 두는 편이 안전하다(인코딩된 파일명은 서버·CDN 마다 다르게 다뤄진다).
function isSafeKey(key) {
  return /^[a-z0-9._-]{2,64}$/.test(key);
}

// js/util.js 의 normalizeFilmLabel 과 같은 규칙.
function normalizeFilmLabel(s) {
  return String(s ?? '').toLowerCase().replace(/[\s\-_+()/.]+/g, '');
}

// 필름 이름 → 카탈로그 슬러그. 카탈로그의 resolveFilmKey 와 같은 순서로 찾는다.
function filmSlugResolver(filmsData) {
  const byLabel = new Map();
  for (const [slug, film] of Object.entries(filmsData || {})) {
    const names = [film.displayName, film.name, ...(film.aliases || [])].filter(Boolean);
    for (const n of names) {
      const k = normalizeFilmLabel(n);
      if (k && !byLabel.has(k)) byLabel.set(k, slug);
    }
  }
  return function resolve(name) {
    const raw = String(name || '').trim();
    if (!raw) return '';
    if (filmsData[raw]) return raw;
    return byLabel.get(normalizeFilmLabel(raw)) || '';
  };
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

async function fetchApproved() {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; from < 20000; from += pageSize) {
    const url = new URL('/rest/v1/reader_submissions_approved', SUPABASE_URL);
    url.searchParams.set('select', 'id,storage_path,submitter_name,instagram,film,camera,caption,created_at');
    url.searchParams.set('order', 'created_at.desc');
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: 'Bearer ' + SUPABASE_ANON,
        Range: `${from}-${from + pageSize - 1}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function labelOf(row) {
  return row.submitter_name || (row.instagram ? '@' + row.instagram.replace(/^@/, '') : '') || '이름 없음';
}

function imageOf(row) {
  return `/i/reader/${String(row.storage_path).replace(/^\/+/, '')}`;
}

function jsonLd(label, key, photos) {
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${ORIGIN}/contributor/${key}`,
        name: `${label} 의 필름 사진`,
        url: `${ORIGIN}/contributor/${key}`,
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: ORIGIN },
      },
      {
        '@type': 'ImageGallery',
        name: `${label} 의 필름 사진`,
        image: photos.slice(0, 12).map((p) => ORIGIN + imageOf(p)),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '홈', item: ORIGIN },
          { '@type': 'ListItem', position: 2, name: '필름', item: `${ORIGIN}/films.html` },
          { '@type': 'ListItem', position: 3, name: label, item: `${ORIGIN}/contributor/${key}` },
        ],
      },
    ],
  };
  return `  <script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

function render(key, label, photos, films, firstFilmSlug, versioned, outFile) {
  const url = `${ORIGIN}/contributor/${key}`;
  // 카탈로그 목적지. 필름 슬러그를 함께 실어야 카탈로그가 승인 사진 전체를
  // 기다리지 않고 곧바로 모달을 연다.
  const catalogHref = `/films.html?${firstFilmSlug ? `film=${firstFilmSlug}&contributor=${key}` : `contributor=${key}`}`;
  const latest = photos[0];
  const ogImage = latest ? ORIGIN + imageOf(latest) : FALLBACK_OG;
  const title = `${label} 의 필름 사진 · ${SITE_NAME}`;
  const filmList = films.slice(0, 6).join(', ');
  const description = `${label} 님이 5ft.mag 에 올린 필름 사진 ${photos.length}장`
    + (filmList ? `. ${filmList} 으로 찍었습니다.` : '.');

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
  <!-- 사람이 열면 카탈로그로 넘어가므로 색인 대상이 아니다. 자동 이동을 넣은
       이상 구글은 어차피 색인하지 않는데, 명시해 두면 검색 콘솔에 "리다이렉트가
       있는 페이지" 경고가 쌓이지 않는다. 미리보기용 <meta> 는 그대로 읽힌다. -->
  <meta name="robots" content="noindex, follow">

  <meta property="og:type" content="profile">
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
  <link rel="stylesheet" href="${versioned('css/contributor.css')}">
${jsonLd(label, key, photos)}
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#111111">
  <script>
    // 카탈로그로 넘긴다. 이 페이지는 미리보기(<meta>)용이고 독자가 읽을 곳은
    // 카탈로그의 작가 뷰다 (#675 의 독자 동선 규칙).
    //
    // replace 로 넘겨 방문 기록에 남기지 않는다. push 로 넘기면 뒤로 가기를
    // 눌렀을 때 이 페이지로 돌아왔다가 다시 튕겨 나가 빠져나갈 수 없다.
    //
    // <head> 안에서 바로 실행해 본문이 그려지기 전에 넘긴다. 화면이 한 번
    // 번쩍이지 않는다. 자바스크립트가 꺼져 있으면 아래 본문이 그대로 보이고
    // 「카탈로그에서 크게 보기」 버튼으로 갈 수 있다.
    (function () {
      try {
        // 크롤러가 <meta> 를 읽는 것은 막지 않는다. 스크립트를 실행하지 않기 때문.
        location.replace(${JSON.stringify(catalogHref)});
      } catch (e) { /* 실패하면 본문이 그대로 보인다 */ }
    })();
  </script>
</head>
<body>
${navHtml(outFile)}
${mobileNavHtml(outFile)}

<main class="contributor-page">
  <header class="contributor-head">
    <p class="contributor-eyebrow">READER</p>
    <h1>${esc(label)}</h1>
    <p class="contributor-count">5ft.mag 에 올린 필름 사진 ${photos.length}장</p>
    ${films.length ? `<p class="contributor-films">${films.slice(0, 8).map((f) => esc(f)).join(' · ')}</p>` : ''}
    <a class="contributor-cta" href="${esc(catalogHref)}">카탈로그에서 크게 보기 →</a>
  </header>

  <div class="contributor-grid">
${photos.map((p) => `    <figure>
      <img src="${esc(imageOf(p))}" alt="${esc(labelOf(p))} 님이 ${esc(p.film || '필름')} 으로 찍은 사진" loading="lazy" decoding="async" />
${p.film || p.camera ? `      <figcaption>${esc([p.film, p.camera].filter(Boolean).join(' · '))}</figcaption>` : ''}
    </figure>`).join('\n')}
  </div>

  <p class="contributor-foot">
    <a href="/films.html">필름 카탈로그 전체 보기 →</a>
  </p>
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
</body>
</html>
`;
}

(async function build() {
  let rows;
  try {
    rows = await fetchApproved();
  } catch (err) {
    console.warn(`[build-contributor-pages] Supabase 조회 실패, skip: ${err.message}`);
    return;
  }

  // 작가별로 묶는다. created_at 내림차순으로 받았으므로 각 묶음의 첫 장이 최신이다.
  const byKey = new Map();
  for (const r of rows) {
    if (!r.storage_path) continue;
    const key = normalizeContributorKey(r.instagram || r.submitter_name || '');
    if (!isSafeKey(key)) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }

  // 카탈로그 슬러그를 붙이기 위해 필름 목록을 읽는다. 링크에 필름이 없으면
  // 카탈로그가 승인 사진 전체를 받아 그 사람의 첫 사진이 어느 필름인지 알아낸
  // 뒤에야 모달을 연다. 사진이 수천 장이면 그동안 아무 일도 일어나지 않아
  // 버튼이 고장 난 것처럼 보인다.
  let resolveFilmSlug = () => '';
  try {
    const filmsData = JSON.parse(await fs.readFile(FILMS_JSON, 'utf-8'));
    resolveFilmSlug = filmSlugResolver(filmsData);
  } catch (_) { /* 없으면 슬러그 없이 만든다. 느릴 뿐 동작은 한다 */ }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const referenceHtml = await fs.readFile(REFERENCE_PAGE, 'utf-8');
  const versioned = assetVersionReader(referenceHtml, {
    'css/contributor.css': await contentHash('css/contributor.css'),
  });

  const made = [];
  for (const [key, all] of byKey) {
    if (all.length < MIN_PHOTOS) continue;
    const photos = all.slice(0, PHOTO_LIMIT);
    const label = labelOf(all[0]);
    const films = [...new Set(all.map((p) => p.film).filter(Boolean))];
    // 카탈로그가 바로 열 수 있는 필름 하나. 최신 사진의 필름부터 찾는다.
    const firstFilmSlug = all.map((p) => resolveFilmSlug(p.film)).find(Boolean) || '';
    const outFile = path.join(OUT_DIR, `${key}.html`);
    await fs.writeFile(outFile, render(key, label, photos, films, firstFilmSlug, versioned, outFile), 'utf-8');
    made.push({ key, count: all.length });
  }

  // 사이트맵이 읽을 목록. 사진이 지워져 기준 미만이 된 작가는 다음 빌드에서
  // 빠지므로, 이 파일이 그때그때의 실제 목록이다.
  await fs.writeFile(
    path.join(ROOT, 'data/contributors.json'),
    JSON.stringify(made.sort((a, b) => b.count - a.count), null, 2) + '\n',
    'utf-8',
  );

  const skipped = byKey.size - made.length;
  console.log(`[build-contributor-pages] ${made.length}명 페이지 생성: contributor/`);
  console.log(`[build-contributor-pages] 사진 ${MIN_PHOTOS}장 미만이라 건너뜀: ${skipped}명`);
})();
