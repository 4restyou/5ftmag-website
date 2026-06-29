// 이북 페이지 이미지 일괄 업로드 + 상품 행 보장 (편집부 ops 도구).
//
// admin 에서 한 장씩(또는 한 번에) 올리는 대신, 변환된 페이지 이미지 폴더를
// 비공개 버킷 ebook-pages/<slug>/ 로 통째로 올리고 ebook_products 행을 만든다.
// 외부 npm 의존성 없음 (Node 18+ 의 fetch 사용).
//
// 준비: Supabase 대시보드 → Settings → API → service_role 키 (secret).
//   이 키는 로컬에서만 쓰고 절대 커밋·공유하지 말 것.
//
// 사용:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/ebook-upload.mjs <imagesDir> <slug> \
//     [--title="..."] [--price=5000] [--kind=spc]
//
// 예:
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/ebook-upload.mjs \
//     ~/Downloads/spc-03-pages-jpg spc-03-sundust-people \
//     --title="sun, dust, people — 홍민우 (SPC Issue 03)" --price=5000 --kind=spc
//
// 업로드 후 admin 에서: 표지·설명 보완 → 열람권 부여 → 발행/이북판매 체크.

import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const URL_ = process.env.SUPABASE_URL || 'https://pucpqsfwqouqohwsvmnd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'ebook-pages';

if (!KEY) {
  console.error('환경변수 SUPABASE_SERVICE_ROLE_KEY 가 필요해요. (Supabase → Settings → API → service_role)');
  process.exit(1);
}

const [dir, slug, ...rest] = process.argv.slice(2);
if (!dir || !slug) {
  console.error('사용: SUPABASE_SERVICE_ROLE_KEY=... node scripts/ebook-upload.mjs <imagesDir> <slug> [--title=..] [--price=..] [--kind=spc]');
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(slug)) {
  console.error(`slug "${slug}" 는 영문 소문자·숫자·하이픈만 가능해요.`);
  process.exit(1);
}
const opt = Object.fromEntries(rest.map(a => {
  const m = a.match(/^--([^=]+)=([\s\S]*)$/);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const ctypeOf = (f) => (extname(f).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg');

// 1) 이미지 수집 (자연 정렬: p1, p2 … p10)
const all = await readdir(dir);
const files = all
  .filter(f => /\.(jpe?g|png)$/i.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
if (!files.length) {
  console.error(`이미지(jpg/png)가 없어요: ${dir}`);
  process.exit(1);
}
console.log(`${files.length}장 업로드 → ${BUCKET}/${slug}/`);

// 2) 업로드 (x-upsert 로 덮어쓰기 허용)
for (const f of files) {
  const buf = await readFile(join(dir, f));
  const res = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${encodeURIComponent(slug)}/${encodeURIComponent(f)}`, {
    method: 'POST',
    headers: { ...H, 'content-type': ctypeOf(f), 'x-upsert': 'true' },
    body: buf,
  });
  if (!res.ok) {
    console.error(`\n업로드 실패: ${f} (${res.status})`, await res.text());
    process.exit(1);
  }
  process.stdout.write('.');
}
console.log(`\n업로드 완료: ${files.length}장`);

// 3) 상품 행 보장 — 있으면 page_count 만 갱신(다른 필드 보존), 없으면 draft 로 생성
const getRes = await fetch(`${URL_}/rest/v1/ebook_products?slug=eq.${encodeURIComponent(slug)}&select=id`, { headers: H });
const existing = getRes.ok ? await getRes.json() : [];

if (Array.isArray(existing) && existing.length) {
  const patch = await fetch(`${URL_}/rest/v1/ebook_products?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ page_count: files.length, pages_path: slug }),
  });
  if (!patch.ok) { console.error('상품 page_count 갱신 실패', patch.status, await patch.text()); process.exit(1); }
  console.log(`기존 상품 갱신: ${slug} (page_count=${files.length})`);
} else {
  const row = {
    slug,
    title: typeof opt.title === 'string' ? opt.title : slug,
    kind: typeof opt.kind === 'string' ? opt.kind : 'spc',
    price: Number(opt.price) || 0,
    pages_path: slug,
    page_count: files.length,
    published: false,
    ebook_on_sale: false,
  };
  const ins = await fetch(`${URL_}/rest/v1/ebook_products`, {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!ins.ok) { console.error('상품 생성 실패', ins.status, await ins.text()); process.exit(1); }
  console.log(`새 상품 생성(draft): ${slug} (page_count=${files.length})`);
}

console.log('\n다음 단계 (admin):');
console.log(`  1) admin/ebooks 에서 ${slug} 편집 → 표지·가격·설명 보완`);
console.log('  2) 열람권 부여 (본인/구매자)');
console.log('  3) 발행 + 이북 판매중 체크');
console.log(`  확인: /ebook-read.html?slug=${slug}`);
