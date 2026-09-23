// Supabase public.repair_shops → data/repairs.json 생성
//
// admin/repairs 페이지에서 추가·수정·삭제한 결과가 Netlify 빌드 시점에 정적
// data/repairs.json 에 반영된다. labs-page.js 는 이 파일을 먼저 읽고 DB 로 보강한다.
//
// 왜 만들었나:
// 수리점은 원래 DB 만 읽는 구조였다(정적 폴백 없음). 그래서 두 가지를 잃고
// 있었다. 첫째, 자바스크립트로만 그려서 검색 엔진에는 빈 화면이었다. 둘째,
// DB 가 안 열리면 수리실 탭이 통째로 비었다. 현상소(build-labs.mjs)와 같은
// 구조로 맞춰 둘 다 해결한다.
//
// 환경:
//   SUPABASE_URL        (선택, 기본값: 운영 프로젝트)
//   SUPABASE_ANON_KEY   (선택, 기본값: 운영 anon — db-client.js 와 동일)
//
// fetch 실패/빈 테이블이면 기존 data/repairs.json 유지 + warn (빌드 통과).
// labs 와 같은 규칙이다. 한 번의 네트워크 실패로 목록이 사라지면 안 된다.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'data/repairs.json');

const SUPABASE_URL = process.env.SUPABASE_URL
  || 'https://pucpqsfwqouqohwsvmnd.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1Y3Bxc2Z3cW91cW9od3N2bW5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjYyMDUsImV4cCI6MjA5Mzc0MjIwNX0.adLzT0UrX3e1IbkQ70G6LeFWeKbuGaa0PTL6AmrSBD8';

// 테이블 row → data/repairs.json 항목.
// labs-page.js 의 repairCard() 가 쓰는 필드와 이름을 맞춘다. 그쪽은 DB row 를
// 그대로 받아 s.specialty · s.description 처럼 스네이크 케이스로 읽으므로,
// 여기서도 컬럼명을 바꾸지 않는다. labs 는 scan_res → scanRes 로 바꾸지만
// 수리점은 클라이언트가 원본 row 를 기대하고 있어 그 차이를 그대로 둔다.
export function rowToJson(r) {
  return {
    name: r.name || '',
    region: r.region ?? null,
    address: r.address ?? null,
    specialty: r.specialty ?? null,
    description: r.description ?? null,
    contact: r.contact ?? null,
    url: r.url ?? null,
  };
}

async function main() {
  const url = new URL('/rest/v1/repair_shops', SUPABASE_URL);
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
    console.warn('⚠ Supabase repair_shops fetch 실패. data/repairs.json 유지:', err.message);
    process.exit(0);
  }

  if (rows.length === 0) {
    console.warn('⚠ Supabase repair_shops 가 비어 있음. data/repairs.json 유지.');
    process.exit(0);
  }

  const repairs = rows.map(rowToJson);
  const out = { source: 'supabase:public.repair_shops', type: 'camera-repair', count: repairs.length, repairs };
  await fs.writeFile(TARGET, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`🔧 Repairs: ${repairs.length} entry → data/repairs.json`);
}

// 직접 실행될 때만 동작 (import 시엔 rowToJson 만 노출 — 테스트용)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.warn('⚠ build-repairs 예외, data/repairs.json 유지:', err?.message || err);
    process.exit(0);
  });
}
