#!/usr/bin/env node
/**
 * 캐시버스트 일괄 갱신 — 자산 하나의 ?v= 를 참조하는 모든 HTML 에서 통일.
 *
 * 사용:
 *   node scripts/bump-version.mjs css/tokens.css 20260702-unify
 *   node scripts/bump-version.mjs js/db-client.js 20260702-feature
 *
 * - scripts/templates/ 안의 템플릿도 포함해 갱신한다 (템플릿이 옛 버전을
 *   물고 있으면 새 페이지마다 stale 버전이 전파되는 사고 방지).
 * - 갱신 후 validate 의 단일 버전 가드가 통과하는지 확인할 것.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const [asset, tag] = process.argv.slice(2);
if (!asset || !tag || !/^(css|js)\/[a-z0-9._-]+\.(css|js)$/.test(asset) || !/^[0-9A-Za-z-]+$/.test(tag)) {
  console.error('사용법: node scripts/bump-version.mjs <css/x.css|js/x.js> <YYYYMMDD-feature>');
  process.exit(1);
}

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (f.startsWith('.') || f === 'node_modules') continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.html')) out.push(p);
  }
  return out;
}

const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const re = new RegExp(`(${escaped})\\?v=[0-9A-Za-z-]+`, 'g');

let files = 0, refs = 0;
for (const p of walk(ROOT)) {
  const before = readFileSync(p, 'utf8');
  const after = before.replace(re, (_, a) => { refs++; return `${a}?v=${tag}`; });
  if (after !== before) {
    writeFileSync(p, after);
    files++;
    console.log(`  ${relative(ROOT, p)}`);
  }
}

if (!refs) {
  console.error(`참조 0개 — 자산 경로를 확인하세요: ${asset}`);
  process.exit(1);
}
console.log(`\n${asset} → ?v=${tag}  (${files}개 파일, ${refs}개 참조)`);
