#!/usr/bin/env node
/**
 * DB 계약 감사 (정적)
 *
 * 클라이언트 JS 가 .from('X') / .rpc('Y') 로 참조하는 모든 Supabase 객체를
 * supabase/migrations/*.sql 의 create 문과 대조한다.
 *
 * 목적: 레포(마이그레이션)만으로 DB 를 재현할 수 있는지 확인.
 *   - 클라가 쓰는데 마이그레이션에 정의가 없는 객체 = drift 후보
 *     (DB Studio 에서 손으로 만든 객체, 추적 안 된 초기 스키마 등).
 *   - 2026-06 의 profiles_public / messages 사고가 정확히 이 범주였다.
 *
 * CLI 는 경고만 출력하고 exit 0 (CI 를 깨지 않음).
 * 단, audit() 함수는 신규 drift 목록을 반환하므로 단위 테스트가 0 인지 검사한다.
 * 실제 prod 스키마와의 대조는 service key 가 필요하므로 별도 (수동) 작업.
 *
 * 사용:
 *   node scripts/db-audit.mjs
 *   node scripts/db-audit.mjs --md   # 마크다운 표로 출력
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 마이그레이션에 정의가 없어도 prod 에 존재하는 게 확인된 객체 (추적 안 된 초기 스키마).
// drift 보고에서 "확인됨" 으로 분류해 노이즈를 줄인다. 새로 추가되는 미정의 객체만 부각.
// 새 known 객체를 추가하기 전에 정말 prod 에 있는지 확인할 것 (docs/maintenance.md).
export const KNOWN_BASE_OBJECTS = new Set([
  'comments',
  'comments_with_meta',
  'likes',
  'market_listings',
  'market_reports',
  'reader_submissions',
  'reader_submissions_approved',
  'webzine_issues',
  'profiles_public', // prod/workroom 스키마 불일치 진행 중 — docs/maintenance.md 참고
]);

function listJsFiles(root) {
  return readdirSync(join(root, 'js'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => join(root, 'js', f));
}

export function collectRefs(root = ROOT) {
  const tables = new Map();
  const rpcs = new Map();
  for (const file of listJsFiles(root)) {
    const src = readFileSync(file, 'utf8');
    const short = file.replace(root + '/', '');
    for (const m of src.matchAll(/\.from\(\s*'([a-z0-9_]+)'/g)) {
      if (!tables.has(m[1])) tables.set(m[1], new Set());
      tables.get(m[1]).add(short);
    }
    for (const m of src.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'/g)) {
      if (!rpcs.has(m[1])) rpcs.set(m[1], new Set());
      rpcs.get(m[1]).add(short);
    }
  }
  return { tables, rpcs };
}

export function collectDefs(root = ROOT) {
  const defs = new Set();
  const dir = join(root, 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    const re = /create\s+(?:or\s+replace\s+)?(?:table|view|materialized\s+view|function)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi;
    for (const m of src.matchAll(re)) defs.add(m[1].toLowerCase());
  }
  return defs;
}

/** 클라이언트 참조 ⋂ 마이그레이션 정의 대조. { missing, newDrift, counts } 반환. */
export function audit(root = ROOT) {
  const { tables, rpcs } = collectRefs(root);
  const defs = collectDefs(root);
  const missing = [];
  for (const [name, files] of [...tables, ...rpcs]) {
    if (!defs.has(name)) {
      missing.push({ name, files: [...files], known: KNOWN_BASE_OBJECTS.has(name) });
    }
  }
  missing.sort((a, b) => (a.known === b.known ? a.name.localeCompare(b.name) : a.known ? 1 : -1));
  return {
    missing,
    newDrift: missing.filter((m) => !m.known),
    counts: { tables: tables.size, rpcs: rpcs.size, defs: defs.size },
  };
}

// CLI 실행 시에만 출력.
if (import.meta.url === `file://${process.argv[1]}`) {
  const asMarkdown = process.argv.includes('--md');
  const { missing, newDrift, counts } = audit();
  if (asMarkdown) {
    console.log('# DB 계약 감사\n');
    console.log(`생성: ${new Date().toISOString().slice(0, 10)} · \`node scripts/db-audit.mjs --md\`\n`);
    console.log(`클라이언트 참조: 테이블/뷰 ${counts.tables}, RPC ${counts.rpcs}. 마이그레이션 정의 ${counts.defs}.\n`);
    console.log('## 마이그레이션에 정의 없는 클라이언트 참조\n');
    console.log('| 객체 | 상태 | 참조 위치 |');
    console.log('|---|---|---|');
    for (const m of missing) {
      const status = m.known ? '추적 안 됨 (prod 존재 확인)' : '⚠ 신규 drift';
      console.log(`| \`${m.name}\` | ${status} | ${m.files.join(', ')} |`);
    }
    console.log('');
  } else {
    console.log(`DB 계약 감사: 테이블/뷰 ${counts.tables}, RPC ${counts.rpcs} 참조 / 마이그레이션 정의 ${counts.defs}`);
    if (!missing.length) {
      console.log('  ✓ 모든 클라이언트 참조가 마이그레이션에 정의됨');
    } else {
      for (const m of missing) {
        console.log(`${m.known ? '  · 추적 안 됨' : '  ⚠ 신규 drift'}: ${m.name}  (${m.files.join(', ')})`);
      }
    }
    if (newDrift.length) {
      console.log(`\n신규 drift ${newDrift.length}건 — 마이그레이션에 정의를 추가하거나 KNOWN_BASE_OBJECTS 에 등재(prod 존재 확인 후)하세요.`);
    }
  }
  process.exit(0);
}
