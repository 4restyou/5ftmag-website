#!/usr/bin/env node
// 외국어 페이지(en/, --lang ja 면 ja/)에 번역되지 않은 한국어가 남았는지 센다.
//
// 무엇을 세지 않는지는 scripts/lib/en-text.mjs 참고.
// 남은 줄을 보여 주므로 번역을 끝낸 뒤 0 이 되는지 확인한다.
//
// 사용: node scripts/en-check.mjs                 (en/ 전체)
//       node scripts/en-check.mjs lee-gapchul 15  (en/stories/<id>.html 만)
//       node scripts/en-check.mjs --lang ja [<id> ...]  (일본어판)

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/site-shell.mjs';
import { leftoverKorean } from './lib/en-text.mjs';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const args = process.argv.slice(2);
const langIdx = args.indexOf('--lang');
const LANG = langIdx >= 0 ? args.splice(langIdx, 2)[1] : 'en';
const ids = args;
const files = ids.length
  ? ids.map((id) => path.join(ROOT, LANG, 'stories', `${id}.html`))
  : (fs.existsSync(path.join(ROOT, LANG)) ? walk(path.join(ROOT, LANG)) : []);

let total = 0;
for (const file of files) {
  const left = leftoverKorean(fs.readFileSync(file, 'utf8'));
  if (!left.length) continue;
  total += left.length;
  console.log(`${path.relative(ROOT, file)}: ${left.length}줄`);
  for (const l of left.slice(0, 8)) console.log(`  ${l.line}: ${l.text.slice(0, 120)}`);
}
console.log(total ? `한국어가 남은 줄 ${total}개` : `✓ 남은 한국어 없음 (${files.length}개 파일)`);

// 외국어판이 아직 없는 기사(새 기사를 올린 뒤 번역 전). 그 언어 목록에선 한국어판으로 이어진다.
if (!ids.length) {
  const stories = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/stories.json'), 'utf8'));
  const key = LANG === 'ja' ? 'titleJa' : 'titleEn';
  const missing = stories.filter((s) => s.page && (!s[key] || !fs.existsSync(path.join(ROOT, LANG, s.page))));
  if (missing.length) console.log(`${LANG === 'ja' ? '일문' : '영문'}판이 없는 기사 ${missing.length}편: ${missing.map((s) => s.id).join(', ')}`);
}
