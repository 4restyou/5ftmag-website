// 수리점이 정적 HTML 에 실려 있는지 본다.
//
// 수리점은 오래 자바스크립트로만 그려졌다. 목록은 있는데 "부산 카메라 수리점"
// 으로 검색하면 한 줄도 걸리지 않았고, 운영자 표현대로 "검색이 안 나오면
// 의미가 없는" 상태였다. 현상소와 같은 구조로 맞추면서 세 곳이 함께 움직여야
// 하므로(정적 JSON · labs.html 목록 · 지역 페이지) 여기서 묶어 둔다.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const repairs = JSON.parse(read('data/repairs.json')).repairs;
const labsHtml = read('labs.html');

describe('data/repairs.json', () => {
  // build-repairs.mjs 가 Netlify 빌드 때 DB 로 덮어쓴다. 이 파일은 DB 를 읽지
  // 못했을 때 쓰는 마지막 값이라, 비면 수리실 탭이 통째로 빈다.
  it('비어 있지 않다', () => {
    expect(Array.isArray(repairs)).toBe(true);
    expect(repairs.length).toBeGreaterThan(0);
  });

  it('js/labs-page.js 가 읽는 필드 이름을 그대로 쓴다', () => {
    for (const key of ['name', 'region', 'address', 'specialty', 'description', 'contact', 'url']) {
      expect(Object.keys(repairs[0]), `${key} 가 없다`).toContain(key);
    }
  });
});

describe('labs.html 의 수리점 목록', () => {
  const block = labsHtml.match(/<!-- REPAIR-INDEX:START -->([\s\S]*?)<!-- REPAIR-INDEX:END -->/)?.[1];

  it('마커가 있고 안이 비어 있지 않다', () => {
    expect(block, 'REPAIR-INDEX 마커가 없다').toBeTruthy();
    expect(block.trim().length).toBeGreaterThan(0);
  });

  it('모든 수리점 이름이 실려 있다', () => {
    for (const shop of repairs) {
      expect(block, `${shop.name} 이 목록에 없다`).toContain(shop.name);
    }
  });
});

describe('지역 페이지의 수리점 구획', () => {
  // 지역이 비어 있는 수리점은 지역 페이지에 실을 자리가 없다. 그 네 곳은
  // labs.html 목록에서만 나오고, 위 검사가 그쪽을 지킨다.
  const SLUG = {
    서울: 'seoul', 경기: 'gyeonggi', 인천: 'incheon', 강원: 'gangwon',
    대전: 'daejeon', 충남: 'chungnam', 충북: 'chungbuk', 세종: 'sejong',
    대구: 'daegu', 경북: 'gyeongbuk', 부산: 'busan', 울산: 'ulsan',
    경남: 'gyeongnam', 전남광주: 'jeonnamgwangju', 전북: 'jeonbuk', 제주: 'jeju',
  };

  it('지역이 등록된 수리점은 그 지역 페이지에 이름이 있다', () => {
    for (const shop of repairs) {
      const slug = SLUG[shop.region];
      if (!slug) continue;
      const page = read(`labs/${slug}.html`);
      expect(page, `labs/${slug}.html 에 ${shop.name} 이 없다`).toContain(shop.name);
      expect(page, `labs/${slug}.html 에 수리점 구획이 없다`).toContain('lab-region-repairs');
    }
  });

  it('제목에 "카메라 수리점" 이 들어간다', () => {
    const withShops = new Set(repairs.map((s) => SLUG[s.region]).filter(Boolean));
    for (const slug of withShops) {
      const title = read(`labs/${slug}.html`).match(/<title>(.*?)<\/title>/)?.[1] || '';
      expect(title, `labs/${slug}.html 제목: ${title}`).toContain('카메라 수리점');
    }
  });
});
