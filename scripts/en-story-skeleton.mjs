#!/usr/bin/env node
// 한국어 기사(stories/<id>.html)에서 영문판 골격(en/stories/<id>.html)을 만든다.
//
// 기계적으로 바꿀 수 있는 것만 바꾼다. 본문·제목·캡션 번역은 사람이(또는 AI 가) 한다.
//   - lang, canonical·og:url·@id, og:locale, inLanguage
//   - 상대경로를 절대경로로. 모든 페이지에 <base href="/"> 가 있어 브라우저는 이미 루트 기준으로 푼다.
//     같은 주소를 그대로 적어 두면 en/ 아래에서도 자산 검사(validate-assets)가 같은 파일을 찾는다
//   - js/i18n.js 를 불러오고, 공통 UI 문구(목록으로·링크 복사 등)와 서명 역할 이름을 영문으로
//   - .author-name 에 원래 이름을 data-author 로 남긴다(작가 카드 매칭용, js/article-author-bio.js)
//   - 본문 위에 "AI 번역" 안내와 원문 링크
//
// 사용: node scripts/en-story-skeleton.mjs <id> [<id> ...]   (이미 있는 영문 파일은 건너뛴다. --force 로 덮어쓴다)
//       node scripts/en-story-skeleton.mjs --all
//       node scripts/en-story-skeleton.mjs stories.html        (기사가 아닌 페이지도 같은 방식으로. 안내 문단은 넣지 않는다)

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/site-shell.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const stories = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/stories.json'), 'utf8'));
const ids = args.includes('--all')
  ? stories.map((s) => (s.page || '').replace(/^stories\//, '').replace(/\.html$/, '')).filter(Boolean)
  : args.filter((a) => !a.startsWith('--'));

const I18N_VERSION = (() => {
  const about = fs.readFileSync(path.join(ROOT, 'en/about.html'), 'utf8');
  return (about.match(/js\/i18n\.js\?v=([0-9A-Za-z-]+)/) || [])[1] || '20261001-en';
})();

const ROLE_EN = {
  '글': 'Words', '이미지': 'Images', '사진': 'Photos', '자료 정리': 'Research', '자료': 'Sources',
  '편집': 'Editing', '참고': 'References', '출처': 'Sources', '기획 · 편집': 'Planning · Editing',
  '기획 · 발행': 'Planning · Publishing', '글·사진': 'Words · Photos', '글/편집': 'Words · Editing',
  '글 · 그림': 'Words · Illustration', '정리': 'Compiled by', '큐레이션': 'Curation',
};

const UI = [
  ['class="article-back">← Stories</a>', 'class="article-back">← Articles</a>'],
  ['<button type="button" data-action="copy-link">링크 복사</button>', '<button type="button" data-action="copy-link">Copy link</button>'],
  ['<span class="nav-label">← 목록으로</span>', '<span class="nav-label">← Back to list</span>'],
  ['<span class="nav-title">Stories 전체 보기</span>', '<span class="nav-title">All articles</span>'],
  ['<h3 class="related-title">함께 읽기 좋은 글</h3>', '<h3 class="related-title">Read next</h3>'],
  ['alt="김현아"', 'alt="Kim Hyun-a"'],
  ['aria-label="전체 검색" title="전체 검색"', 'aria-label="Search" title="Search"'],
  ['aria-label="다크 모드로 전환"', 'aria-label="Switch to dark mode"'],
  ['aria-label="메뉴 열기"', 'aria-label="Open menu"'],
  ['<a href="/index.html" class="site-logo">', '<a href="/en/" class="site-logo">'],
  ['<a href="/" class="site-logo">', '<a href="/en/" class="site-logo">'],
  ["const author = s.author ? s.author + ' — ' : '';", "const author = (s.authorEn || s.author) ? (s.authorEn || s.author) + ' — ' : '';"],
];

// 상대 주소 → 절대 주소. <base href="/"> 아래에서 브라우저가 푸는 결과와 같다.
function absolutize(value, dir) {
  return value.split(/(\s*,\s*)/).map((part) => {
    if (/^\s*,\s*$/.test(part)) return part;
    const m = part.match(/^(\s*)(\S+)(.*)$/);
    if (!m) return part;
    let url = m[2];
    if (/^(?:[a-z]+:|\/|#|\$\{|data:)/i.test(url)) return part;
    // ../x 는 루트의 x, 맨 이름(x)·./x 는 stories/ 안의 x 로 본다(validate-assets 와 같은 기준)
    url = url.startsWith('../') ? '/' + url.replace(/^(?:\.\.\/)+/, '') : '/' + dir + url.replace(/^\.\//, '');
    return m[1] + url + m[3];
  }).join('');
}

function transform(html, rel) {
  const isStory = rel.startsWith('stories/');
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
  let out = html.replace('<html lang="ko"', '<html lang="en"');
  const ko = `https://www.5ftmag.com/${rel === 'index.html' ? '' : rel}`;
  const en = `https://www.5ftmag.com/en/${rel === 'index.html' ? '' : rel}`;
  out = out.replace(`<link rel="canonical" href="${ko}">`, `<link rel="canonical" href="${en}">`);
  out = out.replace(`<meta property="og:url" content="${ko}">`, `<meta property="og:url" content="${en}">`);
  out = out.replace(new RegExp(`("@id":\\s*")${ko.replace(/[.]/g, '\\.')}"`), `$1${en}"`);
  out = out.replace('<meta property="og:locale" content="ko_KR">', '<meta property="og:locale" content="en_US">\n  <meta property="og:locale:alternate" content="ko_KR">');
  out = out.replace(/"inLanguage":\s*"ko-KR"/g, '"inLanguage": "en"');

  // 속성의 상대경로. 인라인 스크립트 안의 '../' + s.page 는 base 기준으로 이미 맞게 풀리므로 손대지 않는다
  out = out.replace(/\b(src|href|srcset)="([^"]*)"/g, (all, attr, value) => `${attr}="${absolutize(value, dir)}"`);

  out = out.replace(/(<script src="\/js\/theme-init\.js"><\/script>)/, `$1\n  <script src="/js/i18n.js?v=${I18N_VERSION}"></script>`);

  for (const [a, b] of UI) out = out.split(a).join(b);
  out = out.replace(/<span class="role">([^<]*)<\/span>/g, (all, role) => ROLE_EN[role.trim()] ? `<span class="role">${ROLE_EN[role.trim()]}</span>` : all);
  out = out.replace(/<span class="author-name">([^<]*)<\/span>/, (all, name) => `<span class="author-name" data-author="${name.trim()}">${name}</span>`);

  if (isStory) {
    const note = `<p class="article-translation-note">This article was translated from Korean with AI. <a href="/${rel}" hreflang="ko">Read the original in Korean →</a></p>\n\n  `;
    // 본문 칸이 없는 기사(만화처럼 이미지로만 흐르는 글)는 이미지 띠 앞에 둔다
    out = /<div class="article-body">/.test(out)
      ? out.replace(/(<div class="article-body">)/, `${note}$1`)
      : out.replace(/(<div class="toon-strip">)/, `${note}$1`);
  }
  return out;
}

let made = 0;
for (const id of ids) {
  const rel = id.endsWith('.html') ? id : `stories/${id}.html`;
  const src = path.join(ROOT, rel);
  const dst = path.join(ROOT, 'en', rel);
  if (!fs.existsSync(src)) { console.error(`  없음: ${rel}`); process.exitCode = 1; continue; }
  if (fs.existsSync(dst) && !force) continue;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, transform(fs.readFileSync(src, 'utf8'), rel));
  made++;
}
console.log(`✓ 영문 골격 ${made}개`);
