// Supabase public.films → data/films.json 생성
// admin/films 페이지에서 추가·수정·삭제한 결과가 Netlify 빌드 시점에 정적
// data/films.json 파일에 반영되도록 한다. 다른 페이지(films-page.js,
// me-page.js, admin-analytics-page.js 등)는 여전히 data/films.json 을 fetch
// 하므로 빌드 후 다음 deploy 부터 카탈로그 변경이 사이트에 노출됨.
//
// 환경:
//   SUPABASE_URL        (선택, 기본값: 운영 프로젝트)
//   SUPABASE_ANON_KEY   (선택, 기본값: 운영 anon — db-client.js 와 동일)
//
// fetch 실패 시 기존 data/films.json 유지 + warn (빌드 통과).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'data/films.json');

const SUPABASE_URL = process.env.SUPABASE_URL
  || 'https://pucpqsfwqouqohwsvmnd.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1Y3Bxc2Z3cW91cW9od3N2bW5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjYyMDUsImV4cCI6MjA5Mzc0MjIwNX0.adLzT0UrX3e1IbkQ70G6LeFWeKbuGaa0PTL6AmrSBD8';

function rowToJson(r) {
  const out = {
    slug: r.slug,
    tier: r.tier || 'library',
    brand: r.brand || '',
    name: r.name || '',
    displayName: r.display_name || `${r.brand || ''} ${r.name || ''}`.trim(),
    aliases: Array.isArray(r.aliases) ? r.aliases : [],
    desc: r.description || '',
    iso: r.iso || '',
    type: r.type || '',
    format: r.format || '',
    photographers: Array.isArray(r.photographers) ? r.photographers : [],
    photos: Array.isArray(r.photos) ? r.photos : [],
  };
  // optional 필드는 값 있을 때만 포함 (기존 JSON 구조와 일관)
  if (r.issue)                    out.issue = r.issue;
  if (r.box_thumbnail)            out.boxThumbnail = r.box_thumbnail;
  if (r.box_thumbnail_status)     out.boxThumbnailStatus = r.box_thumbnail_status;
  if (r.can_thumbnail)            out.canThumbnail = r.can_thumbnail;
  if (r.can_thumbnail_status)     out.canThumbnailStatus = r.can_thumbnail_status;
  return out;
}

async function main() {
  // Supabase REST — public SELECT 라 anon 키로 충분.
  // is_hidden=true 는 정적 카탈로그에서 제외 (admin 에서만 보이게).
  const url = new URL('/rest/v1/films', SUPABASE_URL);
  url.searchParams.set('select', '*');
  url.searchParams.set('is_hidden', 'eq.false');
  url.searchParams.set('order', 'brand.asc,name.asc');

  let rows;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: 'Bearer ' + SUPABASE_ANON,
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('expected array');
  } catch (err) {
    console.warn('⚠ Supabase films fetch 실패. data/films.json 유지:', err.message);
    process.exit(0);
  }

  if (rows.length === 0) {
    console.warn('⚠ Supabase films 가 비어 있음. data/films.json 유지.');
    process.exit(0);
  }

  const films = {};
  for (const r of rows) {
    if (!r.slug) continue;
    films[r.slug] = rowToJson(r);
  }

  await fs.writeFile(TARGET, JSON.stringify(films, null, 2) + '\n', 'utf8');
  console.log(`🎞 Films: ${Object.keys(films).length} entry → data/films.json`);
}

main().catch(err => {
  console.warn('⚠ build-films 예외 발생, data/films.json 유지:', err?.message || err);
  process.exit(0);
});
