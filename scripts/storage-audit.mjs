#!/usr/bin/env node
/**
 * Storage 사용량 감사 (읽기 전용)
 *
 * Supabase 의 모든 storage bucket 을 훑어서 사용량·큰 파일 목록을 출력.
 * 무료 플랜 (1 GB) 다운그레이드 검토 전 어디서 용량을 차지하는지 파악.
 *
 * 사용:
 *   SUPABASE_SERVICE_KEY=eyJ... node scripts/storage-audit.mjs
 *
 * service_role key 필요 (Project Settings > API > service_role secret).
 * 절대 client 코드나 git 에 커밋하지 말 것 — 모든 RLS 우회 권한 있음.
 *
 * 출력:
 *   1. 버킷별 총 사용량 + 파일 수
 *   2. 버킷별 상위 20개 큰 파일
 *   3. 1 MB 이상 파일 비율 (압축 후보 추정)
 *
 * 삭제·이동은 하지 않음. 결과 보고 직접 정리.
 */

import process from 'node:process';

const SUPABASE_URL = process.env.SUPABASE_URL
  || 'https://pucpqsfwqouqohwsvmnd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SERVICE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_KEY 환경변수 필요');
  console.error('  Project Settings > API > service_role secret 복사');
  console.error('  SUPABASE_SERVICE_KEY=eyJ... node scripts/storage-audit.mjs');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  'Content-Type': 'application/json',
};

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(3)} GB`;
}

async function listBuckets() {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { headers });
  if (!res.ok) throw new Error(`bucket list 실패: ${res.status} ${await res.text()}`);
  return res.json();
}

// Storage REST: POST /object/list/:bucket — pagination 으로 모든 파일 가져옴
async function listAllFiles(bucket, prefix = '') {
  const all = [];
  const limit = 1000;
  let offset = 0;
  // 재귀 — 디렉터리 만나면 그 안도 listing
  // (Supabase Storage 는 평면 키지만 list 는 prefix 디렉터리 단위)
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prefix, limit, offset,
        sortBy: { column: 'name', order: 'asc' },
      }),
    });
    if (!res.ok) {
      console.warn(`  [${bucket}/${prefix}] list 실패: ${res.status}`);
      break;
    }
    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    for (const item of page) {
      // metadata 가 있으면 파일, 없으면 디렉터리
      if (item.metadata && item.metadata.size != null) {
        all.push({
          path: prefix ? `${prefix}/${item.name}` : item.name,
          size: item.metadata.size,
          mimetype: item.metadata.mimetype,
          updated: item.updated_at,
        });
      } else if (item.id === null) {
        // 디렉터리 — 재귀
        const subPrefix = prefix ? `${prefix}/${item.name}` : item.name;
        const sub = await listAllFiles(bucket, subPrefix);
        all.push(...sub);
      }
    }
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}

async function auditBucket(bucket) {
  process.stdout.write(`\n── ${bucket} ──\n`);
  const files = await listAllFiles(bucket);
  if (files.length === 0) {
    console.log('  (비어있음)');
    return { bucket, count: 0, total: 0, big: 0 };
  }
  const total = files.reduce((s, f) => s + f.size, 0);
  const big = files.filter(f => f.size >= 1024 * 1024).length;  // 1 MB+
  console.log(`  파일 수: ${files.length}`);
  console.log(`  총 크기: ${fmt(total)}`);
  console.log(`  1 MB+ 파일: ${big} (${((big / files.length) * 100).toFixed(1)}%)`);

  // 상위 20 큰 파일
  files.sort((a, b) => b.size - a.size);
  console.log(`\n  상위 20 큰 파일:`);
  for (const f of files.slice(0, 20)) {
    console.log(`    ${fmt(f.size).padStart(10)}  ${f.path}`);
  }

  // 확장자별 집계
  const byExt = {};
  for (const f of files) {
    const ext = (f.path.match(/\.([a-z0-9]+)$/i) || ['', '?'])[1].toLowerCase();
    byExt[ext] = byExt[ext] || { count: 0, size: 0 };
    byExt[ext].count++;
    byExt[ext].size += f.size;
  }
  console.log(`\n  확장자별:`);
  for (const [ext, v] of Object.entries(byExt).sort((a, b) => b[1].size - a[1].size)) {
    console.log(`    .${ext.padEnd(6)} ${String(v.count).padStart(5)} 개  ${fmt(v.size)}`);
  }

  return { bucket, count: files.length, total, big };
}

async function main() {
  console.log(`Supabase Storage 감사`);
  console.log(`URL: ${SUPABASE_URL}\n`);

  const buckets = await listBuckets();
  console.log(`발견된 bucket: ${buckets.map(b => b.id).join(', ')}`);

  const summary = [];
  for (const b of buckets) {
    try {
      summary.push(await auditBucket(b.id));
    } catch (e) {
      console.error(`  [${b.id}] 실패: ${e.message}`);
    }
  }

  console.log(`\n\n=== 종합 ===`);
  let grandTotal = 0;
  for (const s of summary) {
    console.log(`  ${s.bucket.padEnd(20)} ${String(s.count).padStart(5)} 파일  ${fmt(s.total)}`);
    grandTotal += s.total;
  }
  console.log(`  ${'전체'.padEnd(20)} ${''.padStart(5)}        ${fmt(grandTotal)}`);
  console.log(`\n  무료 플랜 한도: 1 GB`);
  console.log(`  현재 사용:      ${fmt(grandTotal)}  (${((grandTotal / (1024 ** 3)) * 100).toFixed(1)}%)`);
  if (grandTotal > 1024 ** 3) {
    console.log(`  >> ${fmt(grandTotal - 1024 ** 3)} 초과. 정리 필요.\n`);
  } else {
    console.log(`  >> 무료 한도 안. 다운그레이드 가능.\n`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
