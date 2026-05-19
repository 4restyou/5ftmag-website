#!/usr/bin/env node
/**
 * 5ft.mag 자산 검증
 * - HTML 파일의 로컬 src/href 참조 → 실제 파일 존재 여부
 * - JSON 데이터 파일의 내부 page/link/image/thumbnail/photo 참조 → 실제 파일 존재 여부
 * - CSS 중괄호 균형 검사
 * - 병합 충돌 마커와 오래된 stories/12 이미지명 회귀 여부
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
const warnings = [];
let refCount = 0;

function isLocalRef(ref) {
  if (!ref || ref.startsWith('#') || ref.startsWith('mailto:') || ref.startsWith('tel:')) return false;
  if (ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('//')) return false;
  if (ref.startsWith('data:') || ref.startsWith('javascript:')) return false;
  if (ref.includes('${')) return false;
  return true;
}

function stripRef(ref) {
  return ref.split('#')[0].split('?')[0];
}

function checkRef(file, ref, baseDir, label = ref) {
  const clean = stripRef(ref);
  if (!clean) return;
  const target = ref.startsWith('/')
    ? resolve(ROOT, `.${clean}`)
    : resolve(baseDir, clean);
  refCount++;
  if (!existsSync(target)) {
    broken.push({ file, ref: label, expected: relative(ROOT, target) });
  }
}

function stripCssNoise(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

function checkCssBraces(file, text) {
  const clean = stripCssNoise(text);
  let depth = 0;
  let line = 1;
  const stack = [];
  for (const ch of clean) {
    if (ch === '\n') line++;
    if (ch === '{') {
      depth++;
      stack.push(line);
    } else if (ch === '}') {
      depth--;
      stack.pop();
      if (depth < 0) {
        broken.push({ file, ref: `CSS extra closing brace at line ${line}`, expected: 'balanced CSS blocks' });
        return;
      }
    }
  }
  if (depth > 0) {
    broken.push({ file, ref: `CSS missing closing brace opened near line ${stack.at(-1) || '?'}`, expected: 'balanced CSS blocks' });
  }
}

// 1) HTML에서 src/href로 참조하는 로컬 자산/페이지
const htmlRe = /(?:src|href)=["']([^"']+)["']/gi;
const htmlFiles = walk(ROOT, /\.html$/).filter(p => {
  const rel = relative(ROOT, p);
  // 빌드 워크트리 / node_modules / 템플릿 (path resolution 이 빌드 후에 일어남) 제외
  return !rel.startsWith('.claude/')
      && !rel.startsWith('node_modules/')
      && !rel.startsWith('scripts/templates/');
});

for (const html of htmlFiles) {
  const text = readFileSync(html, 'utf8');
  if (/<<<<<<<|=======|>>>>>>>/.test(text)) {
    broken.push({ file: relative(ROOT, html), ref: 'MERGE CONFLICT MARKER', expected: 'resolve conflict markers before deploy' });
  }
  let m;
  while ((m = htmlRe.exec(text))) {
    const ref = m[1];
    if (!isLocalRef(ref)) continue;
    checkRef(relative(ROOT, html), ref, dirname(html));
  }
}

// 2) JSON 데이터 파일의 내부 page/link/image/thumbnail/photos[].src 참조
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
  function scan(value, trail = []) {
    if (Array.isArray(value)) {
      value.forEach((item, i) => scan(item, trail.concat(i)));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, v] of Object.entries(value)) {
      const nextTrail = trail.concat(key);
      if (typeof v === 'string' && isLocalRef(v)) {
        const shouldCheck =
          ['image', 'thumbnail', 'src', 'page', 'link'].includes(key)
          || /\.(?:html|xml|css|js|jpg|jpeg|png|webp|svg|ico|woff2?|ttf|otf)$/i.test(stripRef(v));
        if (shouldCheck) {
          checkRef(jf, v, ROOT, `${nextTrail.join('.')}: ${v}`);
        }
      }
      scan(v, nextTrail);
    }
  }
  scan(data);
}

// 3) 오래된 stories/12 파일명으로 회귀했는지 검사
const legacyStory12 = /\bimg\/stories\/12\/(?:hero|side|angles-\d|sample-\d-\d)\.jpe?g\b/;
for (const file of [...htmlFiles, ...dataFiles.map(f => join(ROOT, f)).filter(existsSync)]) {
  const text = readFileSync(file, 'utf8');
  if (legacyStory12.test(text)) {
    broken.push({
      file: relative(ROOT, file),
      ref: 'legacy stories/12 image name',
      expected: 'use img/stories/12/3.jpg, 4.jpg, 7.jpg, sample1.jpeg, sample2.jpeg',
    });
  }
}

// 4) WebP 페어 누락 (참조는 아니지만 권장)
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
if (webpMissing.length) warnings.push(`${webpMissing.length} WebP pair(s) missing`);

// 5) CSS 기본 구조 검사
const cssFiles = walk(join(ROOT, 'css'), /\.css$/).filter(p => !relative(ROOT, p).startsWith('node_modules/'));
for (const css of cssFiles) {
  checkCssBraces(relative(ROOT, css), readFileSync(css, 'utf8'));
}

// 결과 출력
console.log(`\n자산 검증: ${htmlFiles.length} HTML / ${dataFiles.length} JSON / ${cssFiles.length} CSS 검사`);
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

if (warnings.length && !broken.length) {
  console.warn(`\n  경고: ${warnings.join(', ')}`);
}

if (!broken.length && !webpMissing.length) {
  console.log('  ✓ 모든 자산 참조 정상\n');
}

process.exit(broken.length ? 1 : 0);
