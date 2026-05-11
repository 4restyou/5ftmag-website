#!/usr/bin/env node
/**
 * 5ft.mag 배포 전 스모크 QA
 * - 주요 JS/MJS 문법 검사
 * - data/*.json 파싱 검사
 * - 공개 대상 핵심 파일 존재 검사
 * - published stories 의 page/thumbnail 기본 계약 검사
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');
const failures = [];

function walk(dir, test, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const file = join(dir, name);
    const stat = statSync(file);
    if (stat.isDirectory()) walk(file, test, out);
    else if (test.test(name)) out.push(file);
  }
  return out;
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

console.log('\n스모크 QA 시작');

// 1) JS/MJS syntax
const jsFiles = [
  ...walk(join(ROOT, 'scripts'), /\.(?:mjs|js)$/),
  ...walk(join(ROOT, 'js'), /\.js$/),
];

for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failures.push(`JS syntax failed: ${relative(ROOT, file)}\n${String(error.stderr || error.message)}`);
  }
}
console.log(`  JS syntax: ${jsFiles.length} files`);

// 2) JSON parse
const dataFiles = walk(join(ROOT, 'data'), /\.json$/);
for (const file of dataFiles) {
  try {
    JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    failures.push(`JSON parse failed: ${relative(ROOT, file)}: ${error.message}`);
  }
}
console.log(`  JSON parse: ${dataFiles.length} files`);

// 3) Core publish files
for (const file of [
  'index.html',
  'stories.html',
  'films.html',
  'about.html',
  'authors.html',
  'rss.xml',
  'sitemap.xml',
  'robots.txt',
  'css/common.css',
  'css/tokens.css',
  'css/about.css',
  'css/article.css',
  'css/authors.css',
  'css/films.css',
  'css/home.css',
  'css/stories.css',
  'js/site-common.js',
]) {
  check(existsSync(join(ROOT, file)), `Missing core file: ${file}`);
}

// 4) Published stories contract
const stories = JSON.parse(readFileSync(join(ROOT, 'data/stories.json'), 'utf8'));
const seenIds = new Set();
for (const story of stories) {
  if (!story || story.published === false) continue;
  check(story.id, `Published story missing id: ${story.title || '(untitled)'}`);
  if (story.id) {
    check(!seenIds.has(story.id), `Duplicate story id: ${story.id}`);
    seenIds.add(story.id);
  }
  check(story.page && existsSync(join(ROOT, story.page)), `Published story page missing: ${story.id || story.title} -> ${story.page}`);
  if (story.thumbnail) {
    check(existsSync(join(ROOT, story.thumbnail)), `Published story thumbnail missing: ${story.id} -> ${story.thumbnail}`);
  }
}
console.log(`  Published stories: ${seenIds.size}`);

// 5) Author archive contract
const authors = JSON.parse(readFileSync(join(ROOT, 'data/authors.json'), 'utf8'));
for (const author of authors) {
  check(author.name, 'Author missing name');
  check(author.slug, `Author missing slug: ${author.name || '(unknown)'}`);
  check(author.page && existsSync(join(ROOT, author.page)), `Author page missing: ${author.name || author.slug} -> ${author.page}`);
}
console.log(`  Author archives: ${authors.length}`);

if (failures.length) {
  console.error('\n  QA 실패:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('  ✓ 스모크 QA 통과\n');
