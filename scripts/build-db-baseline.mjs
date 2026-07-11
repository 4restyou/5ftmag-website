#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = path.join(root, 'db');
const manifest = JSON.parse(fs.readFileSync(path.join(dbDir, 'baseline-manifest.json'), 'utf8'));
const header = [
  '-- 5ft.mag DB baseline',
  `-- version: ${manifest.version}`,
  '-- GENERATED FILE. db/baseline-manifest.json과 개별 스키마 파일을 수정한 뒤 npm run db:baseline을 실행하세요.',
  '-- 새 프로젝트 복구 시 이 파일을 먼저 적용하고, 이어서 supabase/migrations를 시간순으로 적용합니다.',
  '',
].join('\n');
const parts = manifest.files.map(file => {
  const full = path.join(dbDir, file);
  if (!fs.existsSync(full)) throw new Error(`baseline source missing: db/${file}`);
  return `-- ─────────────────────────────────────────────\n-- SOURCE: db/${file}\n-- ─────────────────────────────────────────────\n${fs.readFileSync(full, 'utf8').trim()}\n`;
});
const output = header + parts.join('\n');
const target = path.join(dbDir, 'baseline.sql');

if (process.argv.includes('--check')) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (current !== output) {
    console.error('db/baseline.sql이 원본 스키마와 다릅니다. npm run db:baseline을 실행하세요.');
    process.exit(1);
  }
  console.log(`✓ DB baseline 동기화 (${manifest.files.length}개 원본)`);
} else {
  fs.writeFileSync(target, output);
  console.log(`✓ db/baseline.sql 생성 (${manifest.files.length}개 원본)`);
}
