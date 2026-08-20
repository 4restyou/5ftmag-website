#!/usr/bin/env node
/**
 * 정적 페이지, published stories, authors, 필름 상세, 지역별 현상소 페이지를 묶는다.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPublishedContent } from './story-visibility.mjs';

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

function addUrl(urls, path, options = {}) {
  urls.push({
    loc: `${SITE_URL}${path}`,
    lastmod: options.lastmod || new Date().toISOString().slice(0, 10),
    changefreq: options.changefreq || 'monthly',
    priority: options.priority || '0.7',
  });
}

const urls = [];
addUrl(urls, '/', { changefreq: 'weekly', priority: '1.0' });
addUrl(urls, '/stories.html', { changefreq: 'weekly', priority: '0.9' });
addUrl(urls, '/films.html', { changefreq: 'monthly', priority: '0.8' });
addUrl(urls, '/books.html', { changefreq: 'monthly', priority: '0.7' });
addUrl(urls, '/labs.html', { changefreq: 'monthly', priority: '0.7' });
addUrl(urls, '/market.html', { changefreq: 'weekly', priority: '0.7' });
addUrl(urls, '/shop.html', { changefreq: 'weekly', priority: '0.8' });
addUrl(urls, '/search.html', { changefreq: 'monthly', priority: '0.6' });
addUrl(urls, '/authors.html', { changefreq: 'monthly', priority: '0.7' });
addUrl(urls, '/about.html', { changefreq: 'monthly', priority: '0.6' });
addUrl(urls, '/legal/terms.html', { changefreq: 'yearly', priority: '0.3' });
addUrl(urls, '/legal/privacy.html', { changefreq: 'yearly', priority: '0.3' });
addUrl(urls, '/legal/copyright.html', { changefreq: 'yearly', priority: '0.3' });
addUrl(urls, '/legal/refund.html', { changefreq: 'yearly', priority: '0.3' });

const stories = JSON.parse(readFileSync(join(ROOT, 'data/stories.json'), 'utf8'));
for (const story of stories) {
  if (!isPublishedContent(story) || !story.page) continue;
  addUrl(urls, `/${story.page}`, {
    lastmod: story.date || undefined,
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
    addUrl(urls, `/film/${film.slug}.html`, { changefreq: 'monthly', priority: '0.6' });
  }
}

// 지역별 현상소 페이지. build-lab-pages.mjs 가 /labs/<region>.html 로 찍어낸다.
const REGION_SLUGS = {
  '서울': 'seoul', '경기': 'gyeonggi', '인천': 'incheon', '강원': 'gangwon',
  '대전': 'daejeon', '충남': 'chungnam', '충북': 'chungbuk', '세종': 'sejong',
  '대구': 'daegu', '경북': 'gyeongbuk', '부산': 'busan', '울산': 'ulsan',
  '경남': 'gyeongnam', '광주': 'gwangju', '전북': 'jeonbuk', '전남': 'jeonnam',
  '제주': 'jeju',
};
const labsPath = join(ROOT, 'data/labs.json');
if (existsSync(labsPath)) {
  const parsed = JSON.parse(readFileSync(labsPath, 'utf8'));
  const labs = Array.isArray(parsed) ? parsed : parsed.labs || [];
  const regions = new Set(labs.map((lab) => lab?.region).filter((region) => REGION_SLUGS[region]));
  for (const region of regions) {
    addUrl(urls, `/labs/${REGION_SLUGS[region]}.html`, { changefreq: 'monthly', priority: '0.7' });
  }
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url>
    <loc>${escapeXml(url.loc)}</loc>
    <lastmod>${escapeXml(url.lastmod)}</lastmod>
    <changefreq>${escapeXml(url.changefreq)}</changefreq>
    <priority>${escapeXml(url.priority)}</priority>
  </url>`).join('\n')}
</urlset>
`;

writeFileSync(join(ROOT, 'sitemap.xml'), xml);
console.log(`Sitemap generated: ${urls.length} URLs`);
