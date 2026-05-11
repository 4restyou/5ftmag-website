#!/usr/bin/env node
/**
 * 5ft.mag 자산 검증
 * - HTML 파일의 src/href 이미지 참조 → 실제 파일 존재 여부
 * - JSON 데이터 파일의 image/thumbnail 필드 → 실제 파일 존재 여부
 * - 누락 발견 시 exit 1 (빌드 실패)
 *
 * 사용:
 *   node scripts/validate-assets.mjs
 *   npm run validate
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, normalize, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');

function walk(dir, ext, out = []) {
  for (const f of readdirSync(dir)) {
    if (f.startsWith('.') || f === 'node_modules') continue;
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, ext, out);
    else if (ext.test(f)) out.push(p);
  }
  return out;
}

const broken = [];
let refCount = 0;

// 1) HTML에서 src/href로 참조하는 이미지 경로
const htmlRe = /(?:src|href)=["'](\.{0,2}\/?img\/[^"']+\.(?:jpg|jpeg|png|webp|svg))["']/gi;
const htmlFiles = walk(ROOT, /\.html$/).filter(p => {
  const rel = relative(ROOT, p);
  // 빌드 워크트리 / node_modules / 템플릿 (path resolution 이 빌드 후에 일어남) 제외
  return !rel.startsWith('.claude/')
      && !rel.startsWith('node_modules/')
      && !rel.startsWith('scripts/templates/');
});

for (const html of htmlFiles) {
  const text = readFileSync(html, 'utf8');
  let m;
  while ((m = htmlRe.exec(text))) {
    const ref = m[1];
    let target;
    if (ref.startsWith('../')) target = resolve(dirname(html), ref);
    else if (ref.startsWith('./')) target = resolve(dirname(html), ref.slice(2));
    else target = resolve(ROOT, ref);
    refCount++;
    if (!existsSync(target)) {
      broken.push({ file: relative(ROOT, html), ref, expected: relative(ROOT, target) });
    }
  }
}

// 2) JSON 데이터 파일의 image/thumbnail 필드
const dataFiles = ['data/readers.json', 'data/stories.json', 'data/films.json', 'data/news.json'];
for (const jf of dataFiles) {
  const p = join(ROOT, jf);
  if (!existsSync(p)) continue;
  let data;
  try { data = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) {
    broken.push({ file: jf, ref: 'INVALID JSON', expected: e.message });
    continue;
  }
  const items = Array.isArray(data) ? data : Object.values(data);
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue;
    for (const key of ['image', 'thumbnail']) {
      const v = entry[key];
      if (v && typeof v === 'string' && v.trim() && !v.startsWith('http')) {
        const target = resolve(ROOT, v);
        refCount++;
        if (!existsSync(target)) {
          broken.push({ file: jf, ref: v, expected: `${key} of id=${entry.id || '(no id)'}` });
        }
      }
    }
    // films.json 의 photos 배열
    if (Array.isArray(entry.photos)) {
      for (const ph of entry.photos) {
        if (ph?.src && !ph.src.startsWith('http')) {
          const target = resolve(ROOT, ph.src);
          refCount++;
          if (!existsSync(target)) {
            broken.push({ file: jf, ref: ph.src, expected: `photos[].src` });
          }
        }
      }
    }
  }
}

// 3) WebP 페어 누락 (참조는 아니지만 권장)
const webpMissing = [];
const imgDir = join(ROOT, 'img');
if (existsSync(imgDir)) {
  const imgs = walk(imgDir, /\.(jpg|jpeg|png)$/i);
  for (const img of imgs) {
    const rel = relative(ROOT, img);
    if (rel.includes('/favicon/') || rel.includes('/og/')) continue;
    const webp = img.replace(/\.(jpg|jpeg|png)$/i, '.webp');
    if (!existsSync(webp)) webpMissing.push(rel);
  }
}

// 결과 출력
console.log(`\n자산 검증: ${htmlFiles.length} HTML / ${dataFiles.length} JSON 검사`);
console.log(`  총 참조 ${refCount}개`);

if (broken.length) {
  console.error(`\n  ❌ 깨진 참조 ${broken.length}개:`);
  for (const b of broken.slice(0, 20)) {
    console.error(`     ${b.file}: "${b.ref}"  (${b.expected})`);
  }
  if (broken.length > 20) console.error(`     ... ${broken.length - 20}개 더`);
}

if (webpMissing.length) {
  console.warn(`\n  ⚠️  WebP 페어 누락 ${webpMissing.length}개 (성능 저하 가능):`);
  for (const m of webpMissing.slice(0, 10)) console.warn(`     ${m}`);
  if (webpMissing.length > 10) console.warn(`     ... ${webpMissing.length - 10}개 더`);
}

if (!broken.length && !webpMissing.length) {
  console.log('  ✓ 모든 자산 참조 정상\n');
}

process.exit(broken.length ? 1 : 0);
