#!/usr/bin/env node
/**
 * 정적 페이지, published stories, authors, 필름 상세, 지역별 현상소 페이지를 묶는다.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPublishedContent, withDbVisibility } from './story-visibility.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');
const SITE_URL = 'https://www.5ftmag.com';

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

// 고정 페이지의 lastmod 는 그 파일의 마지막 커밋 시각. 빌드할 때마다 날짜가 바뀌지
// 않게 빌드일은 쓰지 않는다. 기록이 없으면(새 파일, git 없음) lastmod 를 생략한다.
function gitLastmod(file) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cI', '--', file], { cwd: ROOT, encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function pageFile(path) {
  return path === '/' ? 'index.html' : path.slice(1);
}

// options.lastmod: 날짜를 아는 항목(기사 등). options.fromGit: 파일 커밋 시각을 쓴다.
// 둘 다 없으면 lastmod 를 비운다(사이트맵 규격상 선택 항목).
function addUrl(urls, path, options = {}) {
  urls.push({
    loc: `${SITE_URL}${path}`,
    lastmod: options.lastmod || (options.fromGit ? gitLastmod(pageFile(path)) : undefined),
    fromGit: !options.lastmod && options.fromGit,
    changefreq: options.changefreq || 'monthly',
    priority: options.priority || '0.7',
  });
}

const urls = [];
addUrl(urls, '/', { changefreq: 'weekly', priority: '1.0', fromGit: true });
addUrl(urls, '/stories.html', { changefreq: 'weekly', priority: '0.9', fromGit: true });
addUrl(urls, '/films.html', { changefreq: 'monthly', priority: '0.8', fromGit: true });
addUrl(urls, '/books.html', { changefreq: 'monthly', priority: '0.7', fromGit: true });
addUrl(urls, '/labs.html', { changefreq: 'monthly', priority: '0.7', fromGit: true });
addUrl(urls, '/market.html', { changefreq: 'weekly', priority: '0.7', fromGit: true });
addUrl(urls, '/shop.html', { changefreq: 'weekly', priority: '0.8', fromGit: true });
addUrl(urls, '/search.html', { changefreq: 'monthly', priority: '0.6', fromGit: true });
addUrl(urls, '/authors.html', { changefreq: 'monthly', priority: '0.7', fromGit: true });
addUrl(urls, '/about.html', { changefreq: 'monthly', priority: '0.6', fromGit: true });
addUrl(urls, '/legal/terms.html', { changefreq: 'yearly', priority: '0.3', fromGit: true });
addUrl(urls, '/legal/privacy.html', { changefreq: 'yearly', priority: '0.3', fromGit: true });
addUrl(urls, '/legal/copyright.html', { changefreq: 'yearly', priority: '0.3', fromGit: true });
addUrl(urls, '/legal/refund.html', { changefreq: 'yearly', priority: '0.3', fromGit: true });

// 관리 화면에서 비공개로 돌린 글(story_visibility)은 뺀다. 외국어판 주소도 이 목록에서
// 짝지어 만들므로 세 언어 모두에서 빠진다.
const stories = await withDbVisibility(JSON.parse(readFileSync(join(ROOT, 'data/stories.json'), 'utf8')), { label: 'sitemap' });
for (const story of stories) {
  if (!isPublishedContent(story) || !story.page) continue;
  addUrl(urls, `/${story.page}`, {
    lastmod: story.updatedAt || story.date || undefined,
    changefreq: 'yearly',
    priority: '0.8',
  });
}

const authorsPath = join(ROOT, 'data/authors.json');
if (existsSync(authorsPath)) {
  const authors = JSON.parse(readFileSync(authorsPath, 'utf8'));
  for (const author of authors) {
    if (!author.page) continue;
    addUrl(urls, `/${author.page}`, {
      fromGit: true,
      changefreq: 'monthly',
      priority: '0.6',
    });
  }
}

// 필름 상세 페이지 158종. build-film-pages.mjs 가 /film/<slug>.html 로 찍어내고
// 기사·저자 페이지와 같이 확장자를 붙인 주소를 정식 주소로 싣는다.
const filmsPath = join(ROOT, 'data/films.json');
if (existsSync(filmsPath)) {
  const films = JSON.parse(readFileSync(filmsPath, 'utf8'));
  const entries = Array.isArray(films)
    ? films
    : Object.entries(films).map(([slug, film]) => ({ ...film, slug: film.slug || slug }));
  for (const film of entries) {
    if (!film.slug || !/^[a-z0-9-]+$/i.test(film.slug)) continue;
    addUrl(urls, `/film/${film.slug}.html`, { lastmod: film.updatedAt, changefreq: 'monthly', priority: '0.6' });
  }
}

// 작가별 사진 페이지(/contributor/<키>.html)는 싣지 않는다. 사람이 열면
// 카탈로그로 넘어가는 페이지라 색인 대상이 아니고, noindex 도 달려 있다.
// 미리보기용 <meta> 만 크롤러가 읽는다.

// 지역별 현상소 페이지. build-lab-pages.mjs 가 /labs/<region>.html 로 찍어낸다.
const REGION_SLUGS = {
  '서울': 'seoul', '경기': 'gyeonggi', '인천': 'incheon', '강원': 'gangwon',
  '대전': 'daejeon', '충남': 'chungnam', '충북': 'chungbuk', '세종': 'sejong',
  '대구': 'daegu', '경북': 'gyeongbuk', '부산': 'busan', '울산': 'ulsan',
  '경남': 'gyeongnam', '전남광주': 'jeonnamgwangju', '전북': 'jeonbuk',
  '제주': 'jeju',
};
const labsPath = join(ROOT, 'data/labs.json');
if (existsSync(labsPath)) {
  const parsed = JSON.parse(readFileSync(labsPath, 'utf8'));
  const labs = Array.isArray(parsed) ? parsed : parsed.labs || [];
  const regions = new Set(labs.map((lab) => lab?.region).filter((region) => REGION_SLUGS[region]));
  for (const region of regions) {
    // 그 지역 현상소 중 가장 늦은 updatedAt. 없으면 생략.
    const lastmod = labs.filter((lab) => lab?.region === region).map((lab) => lab.updatedAt).filter(Boolean).sort().pop();
    addUrl(urls, `/labs/${REGION_SLUGS[region]}.html`, { lastmod, changefreq: 'monthly', priority: '0.7' });
  }
}

// 외국어판(/en/·/ja/). 공개(data/site-shell.json <lang>.publish) 뒤에만 싣는다. 그 언어 파일이 있는 주소만 짝지어 넣는다.
const shell = JSON.parse(readFileSync(join(ROOT, 'data/site-shell.json'), 'utf8'));
const koUrls = [...urls];
for (const lang of ['en', 'ja']) {
  if (!shell[lang]?.publish) continue;
  for (const url of koUrls) {
    const path = url.loc.slice(SITE_URL.length);
    const file = path === '/' ? `${lang}/index.html` : `${lang}${path}`;
    if (!existsSync(join(ROOT, file))) continue;
    // 고정 페이지는 그 언어 파일의 커밋 시각을 따로 본다.
    const lastmod = url.fromGit ? gitLastmod(file) : url.lastmod;
    urls.push({ ...url, lastmod, loc: `${SITE_URL}/${lang}${path}` });
  }
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url>
    <loc>${escapeXml(url.loc)}</loc>
${url.lastmod ? `    <lastmod>${escapeXml(url.lastmod)}</lastmod>\n` : ''}    <changefreq>${escapeXml(url.changefreq)}</changefreq>
    <priority>${escapeXml(url.priority)}</priority>
  </url>`).join('\n')}
</urlset>
`;

writeFileSync(join(ROOT, 'sitemap.xml'), xml);
console.log(`Sitemap generated: ${urls.length} URLs`);
