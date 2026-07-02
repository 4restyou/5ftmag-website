#!/usr/bin/env node
/**
 * 정적 페이지, published stories, authors 페이지를 sitemap.xml 로 묶는다.
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
addUrl(urls, '/terms.html', { changefreq: 'yearly', priority: '0.3' });
addUrl(urls, '/privacy.html', { changefreq: 'yearly', priority: '0.3' });
addUrl(urls, '/refund.html', { changefreq: 'yearly', priority: '0.3' });

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
