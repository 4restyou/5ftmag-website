import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const builder = readFileSync(join(ROOT, 'scripts/build-contributor-pages.mjs'), 'utf8');
const utils = readFileSync(join(ROOT, 'js/films-utils.js'), 'utf8');

// 빌더가 만드는 주소와 카탈로그 딥링크의 키 규칙이 어긋나면, 공유 링크는
// 열리는데 사진이 하나도 안 뜨는 상태가 된다. 규칙을 양쪽에서 뽑아 맞춰 본다.
function keyRuleOf(src) {
  const m = src.match(/function normalizeContributorKey\(value\) \{\s*return ([^;]+);/);
  return m && m[1].trim();
}

describe('작가 페이지 빌더', () => {
  it('작가 키 규칙이 카탈로그(js/films-utils.js)와 같다', () => {
    const a = keyRuleOf(builder);
    const b = keyRuleOf(utils);
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it('주소에 쓸 수 없는 키는 페이지를 만들지 않는다', () => {
    const m = builder.match(/function isSafeKey\(key\) \{\s*return ([^;]+);/);
    const re = new RegExp(m[1].trim().replace(/^\/|\/\.test\(key\)$/g, '').replace(/\/$/, ''));
    const safe = (k) => re.test(k);
    expect(safe('tsuki_gaze')).toBe(true);
    expect(safe('a.b-c_1')).toBe(true);
    expect(safe('박순렬')).toBe(false);      // 한글은 카탈로그 SPA 경로로 남는다
    expect(safe('a')).toBe(false);           // 너무 짧다
    expect(safe('has space')).toBe(false);
    expect(safe('slash/x')).toBe(false);
  });

  it('대표 이미지는 최신 사진으로 고정한다', () => {
    // created_at 내림차순으로 받아 첫 장을 쓴다. 무작위로 뽑으면 빌드마다
    // 바뀌어 이미 공유된 링크의 미리보기와 어긋난다.
    expect(builder).toContain("url.searchParams.set('order', 'created_at.desc')");
    expect(builder).toContain('const latest = photos[0]');
  });

  it('사진이 적은 작가는 건너뛴다', () => {
    expect(builder).toMatch(/const MIN_PHOTOS = \d+/);
    expect(builder).toContain('if (all.length < MIN_PHOTOS) continue;');
  });

  it('조회에 실패하면 빌드를 세우지 않고 건너뛴다', () => {
    // 네트워크가 막힌 환경에서도 나머지 빌드는 끝까지 돌아야 한다.
    expect(builder).toContain('Supabase 조회 실패, skip');
  });
});

describe('작가 공유', () => {
  const share = readFileSync(join(ROOT, 'js/films-share.js'), 'utf8');
  const page = readFileSync(join(ROOT, 'js/films-page.js'), 'utf8');

  it('shareContributor 를 내보낸다', () => {
    expect(share).toContain('async function shareContributor(');
    expect(share).toMatch(/window\.FilmsShare = \{[\s\S]*shareContributor,/);
  });

  it('공유 버튼이 필름보다 작가를 먼저 본다', () => {
    // 작가 뷰는 필름 모달 안에서 열려 currentFilmKey 가 남아 있다.
    // 필름을 먼저 확인하면 작가를 보고 있어도 필름 링크가 나간다.
    const i = page.indexOf('shareContributor(currentContributorKey');
    const j = page.indexOf('shareFilmLink(currentFilmKey');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
  });

  it('작가 뷰를 닫으면 키를 비운다', () => {
    expect(page).toContain('currentContributorKey = null;');
  });
});

describe('작가 페이지 CTA', () => {
  const builder = readFileSync(join(ROOT, 'scripts/build-contributor-pages.mjs'), 'utf8');
  const page = readFileSync(join(ROOT, 'js/films-page.js'), 'utf8');

  it('CTA 링크에 필름 슬러그를 함께 싣는다', () => {
    // 필름이 없으면 카탈로그가 승인 사진 전체를 받아 그 사람의 첫 사진이 어느
    // 필름인지 알아낸 뒤에야 모달을 연다. 사진이 수천 장이면 그 사이 아무 일도
    // 일어나지 않아 버튼이 고장 난 것처럼 보인다.
    expect(builder).toContain('film=${firstFilmSlug}&contributor=${key}');
    expect(builder).toContain('const firstFilmSlug =');
  });

  it('카탈로그는 film 이 오면 승인 사진을 기다리지 않는다', () => {
    // 이 분기가 유지되어야 위 최적화가 의미를 갖는다.
    expect(page).toContain('if (!filmKey && contributor) {');
  });

  it('작가를 못 찾으면 조용히 끝내지 않는다', () => {
    expect(page).toMatch(/이 작가의 사진을 찾지 못했어요/);
  });
});
