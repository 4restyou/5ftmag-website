// data/stories.json → rss.xml 자동 생성
// 빌드 시 또는 단독 실행 가능: `node scripts/build-rss.mjs`

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://www.5ftmag.com';

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rfc822(isoDate) {
  // YYYY-MM-DD → RFC822 형식 (RSS 표준)
  const d = new Date(isoDate + 'T00:00:00Z');
  return d.toUTCString();
}

async function main() {
  const storiesPath = path.join(ROOT, 'data/stories.json');
  const text = await fs.readFile(storiesPath, 'utf-8');
  const stories = JSON.parse(text);

  // 게시된 글만, 날짜 내림차순
  const items = stories
    .filter(s => s.published !== false)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const buildDate = new Date().toUTCString();
  const itemsXml = items.map(s => `    <item>
      <title>${escapeXml(s.title)}</title>
      <link>${SITE}/${s.page}</link>
      <guid isPermaLink="true">${SITE}/${s.page}</guid>
      <pubDate>${rfc822(s.date)}</pubDate>
      <description>${escapeXml(s.excerpt || '')}</description>
      <category>${escapeXml(s.categoryLabel || s.category || '').toUpperCase()}</category>
      <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">${escapeXml(s.author || '5ft.mag 편집부')}</dc:creator>
    </item>`).join('\n');

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>5ft.mag — 필름 사진 매거진</title>
    <link>${SITE}</link>
    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />
    <description>필름 한 롤의 길이, 5ft. 36컷 안에 담긴 빛과 그림자의 이야기.</description>
    <language>ko-KR</language>
    <lastBuildDate>${buildDate}</lastBuildDate>
    <generator>5ft.mag</generator>
    <image>
      <url>${SITE}/img/favicon/icon-512.png</url>
      <title>5ft.mag</title>
      <link>${SITE}</link>
    </image>
${itemsXml}
  </channel>
</rss>
`;

  const out = path.join(ROOT, 'rss.xml');
  await fs.writeFile(out, rss, 'utf-8');
  console.log(`✓ rss.xml 생성 (${items.length}개 글)`);
}

main().catch(err => {
  console.error('❌ RSS 생성 실패:', err);
  process.exit(1);
});
