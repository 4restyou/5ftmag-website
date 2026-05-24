// data/labs.json 의 lat/lng 가 비어 있는 항목을 네이버 지오코딩으로 채운다.
//   로컬에서 실행: NAVER_MAP_CLIENT_ID, NAVER_MAP_CLIENT_SECRET 환경변수 필요.
//   (네이버 클라우드 플랫폼 Maps > Geocoding API 키)
//
//   node scripts/geocode-labs.mjs
//
// - 이미 lat/lng 가 있으면 건너뜀(재실행 안전).
// - 다지점(multiLocation) 항목은 단일 좌표가 불가하므로 건너뛰고 경고만 출력.
// - 주소 검색 실패 항목은 그대로 두고 목록으로 보고 → 수동 보정.

import fs from 'fs';

const ID = process.env.NAVER_MAP_CLIENT_ID;
const SECRET = process.env.NAVER_MAP_CLIENT_SECRET;
if (!ID || !SECRET) {
  console.error('환경변수 NAVER_MAP_CLIENT_ID / NAVER_MAP_CLIENT_SECRET 가 필요합니다.');
  process.exit(1);
}

const PATH = new URL('../data/labs.json', import.meta.url);
const data = JSON.parse(fs.readFileSync(PATH, 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 2025년 네이버 지도 API 개편으로 엔드포인트가 바뀌었을 수 있어 env 로 override 가능.
const GEOCODE_URL = process.env.NAVER_GEOCODE_URL
  || 'https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode';

async function geocode(address) {
  const url = `${GEOCODE_URL}?query=${encodeURIComponent(address)}`;
  const res = await fetch(url, {
    headers: { 'X-NCP-APIGW-API-KEY-ID': ID, 'X-NCP-APIGW-API-KEY': SECRET },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${(await res.text()).slice(0, 120)}`);
  const json = await res.json();
  const hit = json.addresses && json.addresses[0];
  if (!hit) return null;
  return { lat: Number(hit.y), lng: Number(hit.x) };
}

const failed = [];
let filled = 0;
for (const lab of data.labs) {
  if (lab.lat != null && lab.lng != null) continue;
  if (lab.multiLocation || !lab.address) { failed.push(`${lab.name} (다지점/주소없음)`); continue; }
  try {
    const c = await geocode(lab.address);
    if (c) { lab.lat = c.lat; lab.lng = c.lng; filled++; }
    else failed.push(`${lab.name} (${lab.address})`);
  } catch (e) {
    failed.push(`${lab.name} — ${e.message}`);
  }
  await sleep(120); // rate limit 여유
}

fs.writeFileSync(PATH, JSON.stringify(data, null, 2) + '\n');
console.log(`좌표 채움: ${filled}곳`);
if (failed.length) {
  console.log(`수동 보정 필요 ${failed.length}곳:`);
  failed.forEach((f) => console.log('  -', f));
}
