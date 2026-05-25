// Supabase public.labs → data/labs.json 생성
// admin/labs 페이지에서 추가·수정·삭제한 결과가 Netlify 빌드 시점에 정적
// data/labs.json 에 반영된다. labs-page.js 는 여전히 data/labs.json 을 fetch.
//
// 환경:
//   SUPABASE_URL        (선택, 기본값: 운영 프로젝트)
//   SUPABASE_ANON_KEY   (선택, 기본값: 운영 anon — db-client.js 와 동일)
//
// fetch 실패/빈 테이블이면 기존 data/labs.json 유지 + warn (빌드 통과).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'data/labs.json');

const SUPABASE_URL = process.env.SUPABASE_URL
  || 'https://pucpqsfwqouqohwsvmnd.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1Y3Bxc2Z3cW91cW9od3N2bW5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjYyMDUsImV4cCI6MjA5Mzc0MjIwNX0.adLzT0UrX3e1IbkQ70G6LeFWeKbuGaa0PTL6AmrSBD8';

// 테이블 row → data/labs.json 항목 (필드 순서·shape 동일 유지)
export function rowToJson(r) {
  return {
    name: r.name || '',
    region: r.region ?? null,
    address: r.address ?? null,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    scanRes: r.scan_res ?? null,
    features: r.features ?? null,
    url: r.url ?? null,
    prices: r.prices || {},
  };
}

async function main() {
  const url = new URL('/rest/v1/labs', SUPABASE_URL);
  url.searchParams.set('select', '*');
  url.searchParams.set('is_hidden', 'eq.false');
  url.searchParams.set('order', 'sort_order.asc,name.asc');

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
    console.warn('⚠ Supabase labs fetch 실패. data/labs.json 유지:', err.message);
    process.exit(0);
  }

  if (rows.length === 0) {
    console.warn('⚠ Supabase labs 가 비어 있음. data/labs.json 유지.');
    process.exit(0);
  }

  const labs = rows.map(rowToJson);
  const out = { source: 'supabase:public.labs', type: 'film-lab', count: labs.length, labs };
  await fs.writeFile(TARGET, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`🧪 Labs: ${labs.length} entry → data/labs.json`);
}

// 직접 실행될 때만 동작 (import 시엔 rowToJson 만 노출 — 테스트용)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.warn('⚠ build-labs 예외, data/labs.json 유지:', err?.message || err);
    process.exit(0);
  });
}
