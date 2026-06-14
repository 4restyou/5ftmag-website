// /film/<slug>.html OG stub 생성 — 소셜 미리보기 (카카오/트위터/페이스북) 개선.
// data/films.json 을 읽어 각 필름별 정적 stub 을 만든다. stub 은:
//  - 필름별 og:image / og:title / og:description
//  - meta refresh + JS 로 즉시 films.html?film=<slug> 으로 이동
// netlify.toml 의 /film/:slug 리다이렉트가 /film/:slug.html 을 가리키면 끝.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FILMS_JSON = path.join(ROOT, 'data/films.json');
const OUT_DIR = path.join(ROOT, 'film');

const ORIGIN = 'https://www.5ftmag.com';
const SITE_NAME = '5ft magazine';
const FALLBACK_OG = `${ORIGIN}/img/og/5ft-link1.webp`;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function ogImageOf(f) {
  const candidate = f.canThumbnail || f.boxThumbnail
    || (Array.isArray(f.photos) && f.photos[0]?.src) || '';
  if (!candidate) return FALLBACK_OG;
  if (/^https?:\/\//.test(candidate)) return candidate;
  return ORIGIN + '/' + String(candidate).replace(/^\.?\//, '');
}

function titleOf(f) {
  const name = f.displayName || f.name || f.slug;
  return `${name} · ${SITE_NAME}`;
}

function descOf(f) {
  const desc = (f.desc || '').trim();
  if (desc) return desc.slice(0, 180);
  const brand = f.brand ? `${f.brand} · ` : '';
  const iso = f.iso ? `ISO ${f.iso} · ` : '';
  return `${brand}${iso}${f.type || ''} 필름. 5ft.mag 에서 톤과 사용 후기를 확인하세요.`;
}

function render(f) {
  const slug = f.slug || f.id;
  const target = `/films.html?film=${encodeURIComponent(slug)}`;
  const canon = `${ORIGIN}${target}`;
  const title = titleOf(f);
  const desc = descOf(f);
  const og = ogImageOf(f);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canon)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(og)}">
<meta property="og:url" content="${esc(canon)}">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(og)}">
<meta name="robots" content="noindex, follow">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)});</script>
</head>
<body><a href="${esc(target)}">${esc(title)}</a></body>
</html>
`;
}

(async function build() {
  const raw = await fs.readFile(FILMS_JSON, 'utf-8').catch(() => null);
  if (!raw) {
    console.warn('[build-film-og] data/films.json 없음, skip');
    return;
  }
  const data = JSON.parse(raw);
  const films = Array.isArray(data)
    ? data
    : Object.entries(data).map(([slug, f]) => ({ slug, ...f }));

  await fs.mkdir(OUT_DIR, { recursive: true });

  let count = 0;
  for (const f of films) {
    const slug = f.slug || f.id;
    if (!slug || !/^[a-z0-9-]+$/i.test(slug)) continue;
    await fs.writeFile(path.join(OUT_DIR, `${slug}.html`), render(f), 'utf-8');
    count += 1;
  }
  console.log(`[build-film-og] ${count}개 필름 OG stub 생성: ${path.relative(ROOT, OUT_DIR)}/`);
})();
