#!/usr/bin/env node
// 글에서 AI 작문 흔적을 찾는다.
//
//   node scripts/writing-check.mjs stories/foo.html [...]
//   node scripts/writing-check.mjs --all          기사 전체
//   node scripts/writing-check.mjs draft.md       기사 아닌 산문도 된다
//
// 대상은 사람이 읽는 산문이다. 기사, 초고, 공지, 소개문. 기술 문서(docs/*.md)에
// 돌리면 상태 표시 이모지와 표의 콜론까지 잡아서 수치가 의미를 잃는다.
//
// 두 곳에서 가져와 하나로 합쳤다. 둘 다 MIT 다.
//   epoko77-ai/im-not-ai            A~J 분류 (S1·S2 목록의 뼈대)
//   DaleSeo/korean-skills humanizer  H-* 로 표시한 항목, 자연도 등급
// 여기에 우리가 겪어서 따로 넣은 것을 더했다.
//   K-1  "A 가 아니라 B" 대조 구문 과다
//   K-2  캡션이 본문 문장을 그대로 되풀이
//   K-3  의문문 없이 평서문만 이어짐
//
// CI 게이트가 아니다. 문체는 사람이 판단할 몫이라 종료 코드는 늘 0 이다.
// 다만 S1 은 대체로 고치는 게 맞고, 자연도 등급은 A 를 목표로 본다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── S1: 한 번만 나와도 손보는 게 맞다 ───────────────────────
const S1 = [
  ['A-1  ~에 대해/대한',      /에\s*대(해서|하여|해|한)(?![가-힣])/g,  '목적격 조사로 바로 잇는다'],
  ['A-3  ~에 있어(서)',       /에\s*있어(서)?(?![가-힣])/g,            '"~에서" 또는 "~을 볼 때"'],
  ['A-7  가지고 있다',        /(가지|갖)고\s*있/g,                     '동사를 되살린다'],
  ['A-8  이중 피동',          /되어지|되어졌|여졌|지어졌/g,             '능동 또는 단일 피동으로'],
  ['A-16 그녀/그것/그들',      /(?<![가-힣])(그녀|그것|그들)(?![가-힣])/g, '생략하거나 이름으로'],
  ['C-5  이모지',             /[\u{1F300}-\u{1FAFF}]/gu,               '전부 뺀다'],
  ['D-1  상투 종결구',        /결론적으로|시사하는 바|주목할 만하다|의미가 크다/g, '구체적인 결론으로'],
];

// ── S2: 개수를 보고 판단한다. 넷째 칸이 임계치 ──────────────
const S2 = [
  ['A-2  ~를 통해',           /(을|를)?\s*통(해서|하여|해)(?![가-힣])/g, '문단에 3회 넘으면 흩는다', 3],
  ['A-10 ~할 수 있다',        /할\s*수\s*있/g,                          '단언할 곳은 단언한다', 3],
  ['A-11 ~을 위해',           /(을|를)\s*위(해서|하여|해)(?![가-힣])/g,  '"~려고", "~도록"', 3],
  ['A-19 이중 조사',          /에서의|에의(?![가-힣])|으로의/g,          '절이나 구로 푼다', 2],
  ['D-4  hype 어휘',          /혁신적|압도적|파격적|획기적/g,            '구체적인 수치나 사실로', 1],
  ['E-2  ~고 있다',           /고\s*있(다|었다|는)(?![가-힣])/g,        '정말 진행 중일 때만 남긴다', 4],
  ['F-1  정도부사',           /(?<![가-힣])(매우|정말|상당히|굉장히|무척)(?![가-힣])/g, '대개 뺀다', 2],
  ['G-1  추측형 종결',        /로\s*보인다|것으로\s*보|듯하다|인\s*셈이다/g, '단언할 곳은 단언한다', 2],
  ['H-3  이는 ~ / 이 점에서',  /(^|\.\s)이는\s|이\s*점에서/g,            '본문에 녹이거나 뺀다', 2],
  ['I-1  ~것이다',            /것이다\./g,                              '3회 넘으면 "~다" 로', 3],
  ['I-3  ~다는 것이다',       /다는\s*(것이다|뜻이다|의미다)/g,          '"~다" 로 바로 맺는다', 2],
  ['K-1  A 가 아니라 B',      /(아니라|아니다|아니었다|뿐만\s*아니라|그치지\s*않)/g, '스무 문장당 1회', -1],
  // ── 여기부터 humanizer 에서 가져왔다 ──
  ['H-17 수량사 + -들',       /(많은|여러|다양한|몇몇|모든|수많은|온갖|각종)\s*[가-힣]{2,}들/g, '수량사가 있으면 -들 을 뺀다', 1],
  ['H-19 격식체 지시관형사',   /(?<![가-힣])(해당\s|본\s(문서|기사|글|연구|보고서|절)|동\s(기간|사안))/g, '"이/그" 로 바꾸거나 뺀다', 2],
  ['H-28 ~와 관련하여',       /관련(하여|된|해서|해)(?![가-힣])/g,       '"~의", "~을 두고" 로', 2],
  ['H-29 ~에 기반하여',       /(기반|바탕)(하여|한|으로|해)(?![가-힣])/g, '"~을 근거로", "~을 보고"', 2],
  ['H-32 ~에 의해 (영어식 피동)', /에\s*의(해|한)(?![가-힣])/g,          '행위자를 주어로 되돌린다', 2],
  ['H-36 ~라는 점에서',       /(라|다)는\s*점에서/g,                    '이유를 그대로 적는다', 2],
];

// ── 본문 뽑아내기 ─────────────────────────────────────────
function extract(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const clean = (t) => t
    .replace(/<span class="photo-credit">[\s\S]*?<\/span>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();

  const m = raw.match(/<div class="article-body">([\s\S]*?)<div class="article-end"/);
  if (!m) {
    // 기사 페이지가 아니면 글 전체를 산문으로 본다 (초고·메모·문서)
    const prose = raw.replace(/^---[\s\S]*?\n---\n/, '')      // frontmatter
      .replace(/```[\s\S]*?```/g, ' ')                        // 코드 블록
      .replace(/^\s{4,}\S.*$/gm, ' ');                        // 들여쓴 코드
    return { prose: clean(prose), captions: [], bolds: [], all: clean(prose) };
  }
  const inner = m[1];
  const captions = [...inner.matchAll(/<figcaption>([\s\S]*?)<\/figcaption>/g)].map((c) => clean(c[1]));
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

// H-22 3박자. 쉼표로 나눈 세 토막의 끝이 똑같을 때만 잡는다.
// 그래야 "A법, B법, C법" 같은 진짜 대구만 걸리고 사실 나열은 넘어간다.
const triplet = (sents) => sents.filter((s) => {
  const parts = s.split(/,\s|·/).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 3) return false;
  const tails = parts.map((p) => p.replace(/[.?!]$/, '').slice(-2));
  return tails[0].length === 2 && new Set(tails).size === 1;
});

// J-3 대시. 콜론과 같은 이유로 〈〉《》「」 안은 원문이라 넘긴다.
const stripTitles = (t) => t.replace(/[〈《「][^〉》」]*[〉》」]/g, ' ');
const dashes = (t) => (stripTitles(t).match(/—/g) || []).length;

// H-39 ~적 N. '면적 확대' 처럼 '적' 으로 끝나는 명사가 섞이므로 걸러낸다.
const JEOK_NOUN = /^(면적|목적|실적|기적|흔적|성적|업적|유적|표적|누적|축적|금액적|체적|용적|물적|인적|적)$/;
const jeokChain = (t) => (t.match(/(?<![가-힣])[가-힣]{1,3}적\s+[가-힣]{2,}/g) || [])
  .filter((x) => !JEOK_NOUN.test(x.split(/\s+/)[0]));

// H-7 콜론. 〈〉《》「」 안은 전시명·작품명이라 넘긴다.
const colons = (t) => (stripTitles(t).match(/[가-힣A-Za-z0-9][:：](\s|$)/g) || []).length;

// 물음표뿐 아니라 물음표 없이 끝나는 의문형도 센다. '하나.' 같은 수사는 걸리지 않도록
// 종결 앞 음절까지 묶어 좁혔다.
const isQuestion = (s) => /[?？]$/.test(s)
  || /(까|는가|은가|던가|였나|었나|겠나|인가)[.]$/.test(s);

// ── 검사 ─────────────────────────────────────────────────
function check(file) {
  const { prose, captions, bolds, all } = extract(file);
  const sents = sentences(prose);
  if (!sents.length) { console.log(`${file}: 본문을 찾지 못했습니다.`); return { s1: 0, s2: 0 }; }

  const len = sents.map((x) => x.length);
  const mean = len.reduce((a, b) => a + b, 0) / len.length;
  const sd = Math.sqrt(len.reduce((a, b) => a + (b - mean) ** 2, 0) / len.length);

  console.log(`\n${'='.repeat(66)}`);
  console.log(path.relative(ROOT, file));
  console.log(`본문 ${sents.length}문장 · 평균 ${mean.toFixed(0)}자 · 표준편차 ${sd.toFixed(0)}`);
  console.log('='.repeat(66));

  let s1 = 0, s2over = 0;

  console.log('\n[S1 (대체로 고친다)]');
  const h1 = [];
  for (const [name, re, fix] of S1) {
    const found = all.match(re);
    if (!found) continue;
    h1.push([name, found.length, fix, [...new Set(found)].slice(0, 3)]);
    s1 += found.length;
  }
  if (!h1.length) console.log('  해당 없음');
  for (const [name, n, fix, ex] of h1) {
    console.log(`  ${name.padEnd(24)} ${String(n).padStart(2)}회  ${ex.join(' · ')}`);
    console.log(`  ${' '.repeat(24)}      → ${fix}`);
  }

  console.log('\n[S2 (임계치를 넘긴 것에 ← 표시)]');
  const h2 = [];
  for (const [name, re, fix, limit] of S2) {
    const found = all.match(re);
    if (!found) continue;
    // K-1 은 개수가 아니라 밀도로 본다
    const cap = limit === -1 ? Math.ceil(sents.length / 20) : limit;
    const over = found.length > cap;
    if (over) s2over += 1;
    h2.push([name, found.length, cap, fix, [...new Set(found)].slice(0, 3), over]);
  }
  const tri = triplet(sents);
  if (tri.length) { const over = tri.length > 2; if (over) s2over += 1;
    h2.push(['H-22 3박자', tri.length, 2, '두 항목이나 네 항목으로 흩는다', [tri[0].slice(0, 30)], over]); }
  const dsh = dashes(all);
  if (dsh) { const over = dsh > 0; if (over) s2over += 1;
    h2.push(['J-3  대시', dsh, 0, '쉼표·괄호·마침표로 (제목 안은 제외했다)', [], over]); }
  const jc = jeokChain(all);
  if (jc.length) { const over = jc.length > 2; if (over) s2over += 1;
    h2.push(['H-39 ~적 N 추상 체인', jc.length, 2, '풀어쓴다 (구조적 한계 → 구조의 한계)', [...new Set(jc)].slice(0, 3), over]); }
  const col = colons(prose);
  if (col) { const over = col > 2; if (over) s2over += 1;
    h2.push(['H-7  콜론', col, 2, '한국어에서는 대개 뺀다 (제목 안은 제외했다)', [], over]); }
  if (!h2.length) console.log('  해당 없음');
  for (const [name, n, cap, fix, ex, over] of h2) {
    console.log(`  ${name.padEnd(24)} ${String(n).padStart(2)}회 (임계 ${cap})${over ? '  ←' : ''}  ${ex.join(' · ')}`);
    if (over) console.log(`  ${' '.repeat(24)}      → ${fix}`);
  }

  // ── 리듬·장식 (수치만 본다. 등급에는 넣지 않는다) ──
  const capSents = new Set(captions.flatMap(sentences));
  const proseSet = new Set(sents);
  const dup = [...capSents].filter((c) => proseSet.has(c));
  const q = sents.filter(isQuestion).length;

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
  console.log(`  C-11 두 마디만 잇는데 찍은 쉼표 ${cc.length}개${cc.length ? ' ← ' + cc[0].slice(0, 44) : ''}`);
  if (bolds.length) console.log(`  J-1 본문 볼드 ${bolds.length}개 (그중 문장 통째 ${bolds.filter((b) => b.replace(/<[^>]+>/g, '').length > 25).length}개)`);
  if (captions.length) console.log(`  K-2 캡션이 본문과 겹친 문장 ${dup.length}개${dup.length ? ' ← ' + dup[0].slice(0, 38) : ''}`);
  console.log(`  K-3 의문문 ${q}개${q === 0 && sents.length > 40 ? '  ← 평서문만 이어집니다' : ''}`);

  console.log(`\n  자연도 등급 ${grade(s1, s2over)}   (S1 ${s1}건 · 임계치 넘긴 S2 ${s2over}종)`);
  return { s1, s2: s2over };
}

// humanizer v1.6.0 의 A~D 를 우리 셈법에 맞춰 옮겼다.
// S2 는 발생 횟수가 아니라 "임계치를 넘긴 항목 수" 로 센다.
function grade(s1, s2) {
  if (s1 >= 5 && s2 >= 6) return 'D  다시 쓰는 편이 빠릅니다';
  if (s1 >= 3 || s2 >= 5) return 'C  AI 흔적이 뚜렷합니다';
  if (s1 >= 1 || s2 >= 3) return 'B  대체로 자연스럽고 흔적이 조금 남았습니다';
  return 'A  사람이 쓴 것처럼 읽힙니다';
}

// ── 실행 ─────────────────────────────────────────────────
let files = process.argv.slice(2);
if (files.includes('--all')) {
  files = fs.readdirSync(path.join(ROOT, 'stories'))
    .filter((f) => f.endsWith('.html')).map((f) => path.join(ROOT, 'stories', f));
}
if (!files.length) {
  console.log('사용법: node scripts/writing-check.mjs <파일 경로> [...]  |  --all');
  process.exit(0);
}

let t1 = 0, worst = 0;
for (const f of files) { const r = check(path.resolve(ROOT, f)); t1 += r.s1; worst = Math.max(worst, r.s2); }
console.log(`\n${'='.repeat(66)}`);
console.log(t1 ? `S1 합계 ${t1}건. 고칠지 판단하세요.` : 'S1 없음.');
process.exit(0);   // 문체는 사람이 판단한다. 종료 코드로 막지 않는다.
