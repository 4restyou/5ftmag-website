#!/usr/bin/env node
// 기사 문장에서 AI 글쓰기 흔적을 찾는다.
//
//   node scripts/writing-check.mjs stories/foo.html [...]
//   node scripts/writing-check.mjs --all
//
// 분류 체계는 epoko77-ai/im-not-ai (MIT) 의 ai-tell-taxonomy 를 우리 기사
// 형식에 맞춰 옮긴 것이다. 여기에 우리가 따로 겪은 항목을 더했다.
//   K-1  "A 가 아니라 B" 대조 구문 과다
//   K-2  캡션이 본문 문장을 그대로 되풀이
//   K-3  의문문 없이 평서문만 이어짐
//
// CI 게이트가 아니다. 문체는 사람이 판단할 몫이라 수치는 참고만 한다.
// 다만 S1 은 대체로 고치는 게 맞다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 검사 항목 ────────────────────────────────────────────
const S1 = [
  ['A-1  ~에 대해/대한',      /에\s*대(해서|하여|해|한)(?![가-힣])/g,  '목적격 조사로 바로 잇는다'],
  ['A-3  ~에 있어(서)',       /에\s*있어(서)?(?![가-힣])/g,            '"~에서" 또는 "~을 볼 때"'],
  ['A-7  가지고 있다',        /(가지|갖)고\s*있/g,                     '동사를 되살린다'],
  ['A-8  이중 피동',          /되어지|되어졌|여졌|지어졌/g,             '능동 또는 단일 피동으로'],
  ['A-16 그녀/그것/그들',      /(?<![가-힣])(그녀|그것|그들)(?![가-힣])/g, '생략하거나 이름으로'],
  ['C-5  이모지',             /[\u{1F300}-\u{1FAFF}]/gu,               '전부 뺀다'],
  ['D-1  상투 종결구',        /결론적으로|시사하는 바|주목할 만하다|의미가 크다/g, '구체적인 결론으로'],
];

const S2 = [
  ['A-2  ~를 통해',           /(을|를)?\s*통(해서|하여|해)(?![가-힣])/g, '문단에 3회 넘으면 흩는다'],
  ['A-10 ~할 수 있다',        /할\s*수\s*있/g,                          '단언할 곳은 단언한다'],
  ['A-11 ~을 위해',           /(을|를)\s*위(해서|하여|해)(?![가-힣])/g,  '"~려고", "~도록"'],
  ['A-19 이중 조사',          /에서의|에의(?![가-힣])|으로의|로의\s/g,   '절이나 구로 푼다'],
  ['D-4  hype 어휘',          /혁신적|압도적|파격적|획기적/g,            '구체적인 수치나 사실로'],
  ['E-2  ~고 있다',           /고\s*있(다|었다|는)(?![가-힣])/g,        '정말 진행 중일 때만 남긴다'],
  ['F-1  정도부사',           /(?<![가-힣])(매우|정말|상당히|굉장히|무척)(?![가-힣])/g, '대개 뺀다'],
  ['G-1  추측형 종결',        /로\s*보인다|것으로\s*보|듯하다|인\s*셈이다/g, '단언할 곳은 단언한다'],
  ['H-3  이는 ~ / 이 점에서',  /(^|\.\s)이는\s|이\s*점에서/g,            '본문에 녹이거나 뺀다'],
  ['I-1  ~것이다',            /것이다\./g,                              '3회 넘으면 "~다" 로'],
  ['I-3  ~다는 것이다',       /다는\s*(것이다|뜻이다|의미다)/g,          '"~다" 로 바로 맺는다'],
  ['J-3  대시',               /—/g,                                     '쉼표·괄호·마침표로'],
  ['K-1  A 가 아니라 B',      /(아니라|아니다|아니었다|뿐만\s*아니라|그치지\s*않)/g, '스무 문장당 1회를 넘기지 않는다'],
];

// ── 본문 뽑아내기 ─────────────────────────────────────────
function extract(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/<div class="article-body">([\s\S]*?)<div class="article-end"/);
  const inner = m ? m[1] : raw;
  const clean = (t) => t
    .replace(/<span class="photo-credit">[\s\S]*?<\/span>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
  const captions = [...inner.matchAll(/<figcaption>([\s\S]*?)<\/figcaption>/g)].map((c) => clean(c[1]));
  // 문장 단위 지표는 사진 블록과 목록을 뺀 산문에서만 잰다
  const prose = clean(inner
    .replace(/<figure[\s\S]*?<\/figure>/g, ' ')
    .replace(/<div class="spec-note">[\s\S]*?<\/div>/g, ' '));
  const bolds = (inner.replace(/<figure[\s\S]*?<\/figure>/g, ' ')
    .match(/<strong>[\s\S]*?<\/strong>/g) || []);
  return { prose, captions, bolds, all: prose + ' ' + captions.join(' ') };
}

const sentences = (t) => t.split(/(?<=[.?!])\s+/).map((x) => x.trim()).filter((x) => x.length > 4);

// C-11 은 문장 단위로 본다. 세 마디 이상을 잇는 열거의 쉼표는 제 역할을 하므로
// 넘기고, 두 마디만 잇는데 쉼표를 찍은 경우만 잡는다.
const connComma = (sents) => sents.filter((x) => (x.match(/(하고|이고|으며|하며|되고|지고),/g) || []).length === 1);

// ── 검사 ─────────────────────────────────────────────────
function check(file) {
  const { prose, captions, bolds, all } = extract(file);
  const sents = sentences(prose);
  if (!sents.length) { console.log(`${file}: 본문을 찾지 못했습니다.`); return 0; }

  const len = sents.map((x) => x.length);
  const mean = len.reduce((a, b) => a + b, 0) / len.length;
  const sd = Math.sqrt(len.reduce((a, b) => a + (b - mean) ** 2, 0) / len.length);

  console.log(`\n${'='.repeat(64)}`);
  console.log(path.relative(ROOT, file));
  console.log(`본문 ${sents.length}문장 · 평균 ${mean.toFixed(0)}자 · 표준편차 ${sd.toFixed(0)}`);
  console.log('='.repeat(64));

  let s1 = 0;
  for (const [group, list] of [['S1 (대체로 고친다)', S1], ['S2 (살펴본다)', S2]]) {
    const hits = [];
    for (const [name, re, fix] of list) {
      const found = all.match(re);
      if (!found) continue;
      // K-1 은 개수가 아니라 밀도로 본다
      if (name.startsWith('K-1') && found.length <= Math.ceil(sents.length / 20)) continue;
      hits.push([name, found.length, fix, [...new Set(found)].slice(0, 3)]);
      if (group.startsWith('S1')) s1 += found.length;
    }
    console.log(`\n[${group}]`);
    if (!hits.length) { console.log('  해당 없음'); continue; }
    for (const [name, n, fix, ex] of hits) {
      console.log(`  ${name.padEnd(22)} ${String(n).padStart(2)}회  ${ex.join(' · ')}`);
      console.log(`  ${' '.repeat(22)}      → ${fix}`);
    }
  }

  // 우리가 따로 겪은 것들
  const capSents = new Set(captions.flatMap(sentences));
  const proseSet = new Set(sents);
  const dup = [...capSents].filter((c) => proseSet.has(c));
  const q = sents.filter((x) => x.endsWith('?') || x.endsWith('까.')).length;

  console.log('\n[리듬 · 장식]');
  console.log(`  E-1 60자 넘는 문장 ${len.filter((x) => x > 60).length}개 · 가장 긴 문장 ${Math.max(...len)}자`);
  const tail = {};
  for (const x of sents) { const k = x.slice(-3); tail[k] = (tail[k] || 0) + 1; }
  const [tk, tv] = Object.entries(tail).sort((a, b) => b[1] - a[1])[0];
  console.log(`  E-2 최다 종결 "${tk}" ${tv}회 (${(tv / sents.length * 100).toFixed(0)}%)`);
  const conj = sents.filter((x) => /^(그리고|그러나|하지만|따라서|또한|게다가|즉|한편)/.test(x)).length;
  console.log(`  H-1 문두 접속사 ${conj}개 (${(conj / sents.length * 100).toFixed(0)}%)`);
  console.log(`  C-12 쉼표 든 문장 ${(sents.filter((x) => x.includes(',')).length / sents.length * 100).toFixed(0)}%`);
  const cc = connComma([...sents, ...captions.flatMap(sentences)]);
  console.log(`  C-11 두 마디만 잇는데 찍은 쉼표 ${cc.length}개${cc.length ? ' ← ' + cc[0].slice(0, 46) : ''}`);
  const wide = bolds.filter((b) => b.replace(/<[^>]+>/g, '').length > 25).length;
  console.log(`  J-1 본문 볼드 ${bolds.length}개 (그중 문장 통째 ${wide}개)`);
  console.log(`  K-2 캡션이 본문과 겹친 문장 ${dup.length}개${dup.length ? ' ← ' + dup[0].slice(0, 40) : ''}`);
  console.log(`  K-3 의문문 ${q}개${q === 0 && sents.length > 40 ? '  ← 평서문만 이어집니다' : ''}`);

  return s1;
}

// ── 실행 ─────────────────────────────────────────────────
let files = process.argv.slice(2);
if (files.includes('--all')) {
  files = fs.readdirSync(path.join(ROOT, 'stories'))
    .filter((f) => f.endsWith('.html')).map((f) => path.join(ROOT, 'stories', f));
}
if (!files.length) {
  console.log('사용법: node scripts/writing-check.mjs <기사 경로> [...]  |  --all');
  process.exit(0);
}

let total = 0;
for (const f of files) total += check(path.resolve(ROOT, f));
console.log(`\n${'='.repeat(64)}`);
console.log(total ? `S1 합계 ${total}건. 고칠지 판단하세요.` : 'S1 없음.');
process.exit(0);   // 문체는 사람이 판단한다. 종료 코드로 막지 않는다.
