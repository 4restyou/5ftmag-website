// llms.txt 생성.
//
// AI 검색·답변 엔진이 사이트 구조를 파악하도록 돕는 안내문이다. 이들 수집기는
// 대부분 자바스크립트를 실행하지 않아서, 어떤 주소에 무엇이 있는지 평문으로
// 한 번 정리해 두면 사이트 전체를 훑지 않고도 필요한 페이지를 찾을 수 있다.
//
// 손으로 관리하면 기사·필름이 늘 때마다 어긋나므로 data/*.json 에서 생성한다.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/site-shell.mjs';

const SITE = 'https://www.5ftmag.com';
const RECENT_STORIES = 30;

const REGION_SLUGS = {
  '서울': 'seoul', '경기': 'gyeonggi', '인천': 'incheon', '강원': 'gangwon',
  '대전': 'daejeon', '충남': 'chungnam', '충북': 'chungbuk', '세종': 'sejong',
  '대구': 'daegu', '경북': 'gyeongbuk', '부산': 'busan', '울산': 'ulsan',
  '경남': 'gyeongnam', '광주': 'gwangju', '전북': 'jeonbuk', '전남': 'jeonnam',
  '제주': 'jeju',
};
const REGION_ORDER = Object.keys(REGION_SLUGS);

function readJson(relPath, fallback) {
  const full = join(ROOT, relPath);
  if (!existsSync(full)) return fallback;
  try { return JSON.parse(readFileSync(full, 'utf8')); } catch { return fallback; }
}

function oneLine(text, limit = 160) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

const stories = readJson('data/stories.json', []);
const filmsRaw = readJson('data/films.json', {});
const labsRaw = readJson('data/labs.json', { labs: [] });
const authors = readJson('data/authors.json', []);

const films = (Array.isArray(filmsRaw)
  ? filmsRaw
  : Object.entries(filmsRaw).map(([slug, film]) => ({ ...film, slug: film.slug || slug })))
  .filter((film) => film.slug && /^[a-z0-9-]+$/i.test(film.slug))
  .sort((a, b) => (a.brand || '').localeCompare(b.brand || '', 'ko')
    || (a.displayName || a.name || '').localeCompare(b.displayName || b.name || '', 'ko'));

const labs = (Array.isArray(labsRaw) ? labsRaw : labsRaw.labs || [])
  .filter((lab) => lab?.name && REGION_SLUGS[lab.region]);

const published = stories
  .filter((story) => story.published !== false && story.page)
  .slice(0, RECENT_STORIES);

const labCountByRegion = new Map();
for (const lab of labs) {
  labCountByRegion.set(lab.region, (labCountByRegion.get(lab.region) || 0) + 1);
}

const lines = [];
lines.push('# 5ft magazine (오피트)');
lines.push('');
lines.push('> 필름 사진 전문 매거진입니다. 발행처는 4rest, 광주에 있습니다. 필름 사진에 관한 기사,'
  + ` 필름 ${films.length}종의 카탈로그, 전국 필름 현상소 ${labs.length}곳의 주소와 현상 가격,`
  + ' 이북과 종이 매거진, 중고 장터, 독자 사진 투고를 다룹니다. 모든 내용은 한국어입니다.');
lines.push('');
lines.push('사이트 주소: ' + SITE + '/');
lines.push('전체 주소 목록: ' + SITE + '/sitemap.xml');
lines.push('RSS: ' + SITE + '/rss.xml');
lines.push('');

lines.push('## 주요 페이지');
lines.push('');
[
  ['기사 목록', '/stories.html', '필름 사진, 사진가, 필름 제품, 전시를 다룬 기사 모음'],
  ['필름 카탈로그', '/films.html', `필름 ${films.length}종의 감도·종류·포맷과 독자들이 찍은 사진`],
  ['현상소 목록', '/labs.html', `전국 필름 현상소 ${labs.length}곳의 주소·스캔 화질·현상 가격`],
  ['필자 목록', '/authors.html', `이 매거진에 글을 쓴 ${authors.length}명(팀)의 아카이브`],
  ['매거진', '/books.html', '종이 매거진과 이북'],
  ['중고 장터', '/market.html', '독자들이 올리는 필름 카메라·장비 중고 거래'],
  ['소개', '/about.html', '매거진 소개와 발행처 정보'],
].forEach(([label, path, note]) => lines.push(`- [${label}](${SITE}${path}): ${note}`));
lines.push('');

lines.push('## 최근 기사');
lines.push('');
for (const story of published) {
  const note = oneLine(story.excerpt || story.title);
  lines.push(`- [${story.title}](${SITE}/${story.page}): ${note} (${story.author || '5ft.mag 편집부'}, ${story.date || ''})`);
}
lines.push('');

lines.push('## 지역별 현상소');
lines.push('');
lines.push(`각 페이지에 그 지역 현상소의 주소, 기본 스캔 화질, 컬러·흑백·슬라이드·시네마 현상 가격이 135·120 포맷별로 정리돼 있습니다.`);
lines.push('');
for (const region of REGION_ORDER) {
  const count = labCountByRegion.get(region);
  if (!count) continue;
  lines.push(`- [${region} 필름 현상소](${SITE}/labs/${REGION_SLUGS[region]}.html): ${count}곳`);
}
lines.push('');

lines.push('## 필름 카탈로그');
lines.push('');
lines.push('각 페이지에 브랜드, 감도, 종류, 포맷, 설명, 다르게 부르는 이름이 정리돼 있습니다.');
lines.push('');
for (const film of films) {
  const spec = [film.iso && `ISO ${film.iso}`, film.type, film.format].filter(Boolean).join(', ');
  const name = film.displayName || film.name || film.slug;
  lines.push(`- [${name}](${SITE}/film/${film.slug}.html): ${spec}`);
}
lines.push('');

lines.push('## 이용 안내');
lines.push('');
lines.push('- 기사와 사진의 저작권은 5ft magazine 및 각 사진가·권리자에게 있습니다.');
lines.push('- 인용할 때는 출처와 원문 주소를 함께 밝혀 주세요.');
lines.push('- 현상 가격과 현상소 정보는 바뀔 수 있습니다. 최종 반영 시점은 현상소 페이지에서 확인해 주세요.');
lines.push('');

writeFileSync(join(ROOT, 'llms.txt'), `${lines.join('\n')}`);
console.log(`llms.txt 생성: 기사 ${published.length}편 · 필름 ${films.length}종 · 현상소 ${labs.length}곳`);
