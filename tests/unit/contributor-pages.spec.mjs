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

  it('사진이 적거나 주소로 쓸 수 없는 키는 페이지를 만들지 않는다', () => {
    // 페이지는 걸러 만들되, 전체 검색이 읽는 목록에는 모두 실어야 한다.
    // 그래야 한글 이름이나 사진이 적은 작가도 아이디로 찾을 수 있다.
    expect(builder).toMatch(/const MIN_PHOTOS = \d+/);
    expect(builder).toContain('const hasPage = isSafeKey(key) && all.length >= MIN_PHOTOS;');
    expect(builder).toContain('if (hasPage) {');
  });

  it('검색 색인에는 페이지가 없는 작가도 담고 갈 곳을 함께 적는다', () => {
    expect(builder).toContain('index.push({');
    expect(builder).toContain("hasPage ? `/contributor/${key}` : `/films.html?contributor=");
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

describe('작가 페이지 자동 이동', () => {
  const builder = readFileSync(join(ROOT, 'scripts/build-contributor-pages.mjs'), 'utf8');
  const server = readFileSync(join(ROOT, 'scripts/static-server.mjs'), 'utf8');

  it('replace 로 넘겨 방문 기록에 남기지 않는다', () => {
    // push 로 넘기면 뒤로 가기가 이 페이지로 돌아왔다가 다시 튕겨 나가
    // 빠져나갈 수 없다.
    expect(builder).toContain('location.replace(');
    expect(builder).not.toContain('location.href =');
  });

  it('색인에서 빼는 것을 명시한다', () => {
    // 자동 이동을 넣으면 구글이 어차피 색인하지 않는다. 명시해 두면 검색
    // 콘솔에 "리다이렉트가 있는 페이지" 경고가 쌓이지 않는다.
    expect(builder).toContain('noindex, follow');
  });

  it('CTA 와 자동 이동이 같은 주소를 쓴다', () => {
    // 둘이 갈라지면 자바스크립트가 꺼진 환경에서만 다른 곳으로 간다.
    expect(builder).toContain('const catalogHref =');
    expect(builder).toContain('location.replace(${JSON.stringify(catalogHref)})');
    expect(builder).toContain('href="${esc(catalogHref)}"');
  });

  it('로컬 서버가 확장자 있는 주소를 그대로 서빙한다', () => {
    // /contributor/x.html 에 .html 을 또 붙이면 파일을 못 찾아 카탈로그가
    // 대신 나온다. 실제로 이것 때문에 자동 이동이 동작하지 않는 것으로 오인했다.
    expect(server).toContain('/^\\/contributor\\/[^/.]+$/');
  });
});

describe('작가 페이지 사진 개수', () => {
  const builder = readFileSync(join(ROOT, 'scripts/build-contributor-pages.mjs'), 'utf8');

  it('개수는 화면에 실은 수가 아니라 실제 총장수를 쓴다', () => {
    // photos 는 PHOTO_LIMIT 으로 자른 일부다. 그걸로 세면 미리보기와 본문이
    // 둘 다 올린 것보다 적게 말한다.
    expect(builder).toContain('필름 사진 ${total}장');
    expect(builder).not.toContain('필름 사진 ${photos.length}장');
    expect(builder).toContain('render(key, label, photos, all.length,');
  });
});

describe('작가 모아보기 개수', () => {
  const roll = readFileSync(join(ROOT, 'js/films-reader-roll-data.js'), 'utf8');

  it('그 사람 사진을 자르지 않는다', () => {
    // 120장에서 자르면 그 이상 올린 작가는 화면이 늘 정확히 "120 photos" 로
    // 멈추고, 목록 순서대로 앞 120장만 남아 뒤쪽 필름의 개수까지 깎인다.
    // 실제로 @tsuki_gaze 가 120 에 걸려 시네스틸 800T 가 6컷으로 나왔다.
    const fn = roll.slice(roll.indexOf('async function submissionsForPerson'));
    const body = fn.slice(0, fn.indexOf('\n    }'));
    expect(body).toContain('personKeyOf(sub) === personKey');
    expect(body).not.toMatch(/\.slice\(0,\s*\d+\)/);
  });
});

describe('작가 뷰 라이트박스', () => {
  const page = readFileSync(join(ROOT, 'js/films-page.js'), 'utf8');

  it('사진 목록을 화면과 같은 함수로 가져온다', () => {
    // 예전에는 클릭 핸들러가 rollSource.fallbackSubmissions 를 직접 걸러 쓰면서
    // .slice(0, 120) 을 따로 두었다. 그래서 화면 쪽 상한만 없앤 #697 이 여기에
    // 반영되지 않았고, 120장이 넘는 작가는 카운트가 20컷인데 라이트박스는
    // 5장만 열렸다.
    const start = page.indexOf("const photo = e.target.closest('.reader-contributor-photo')");
    // 주석에는 옛 코드 이름이 설명으로 남아 있으므로 코드 줄만 본다.
    const body = page.slice(start, start + 1800)
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect(body).toContain('submissionsForPerson(key)');
    expect(body).not.toContain('rollSource.fallbackSubmissions');
  });

  it('사진 목록 어디에도 개수 상한이 남아 있지 않다', () => {
    const roll = readFileSync(join(ROOT, 'js/films-reader-roll-data.js'), 'utf8');
    for (const src of [page, roll]) {
      const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
      expect(code).not.toMatch(/\.slice\(0,\s*120\)/);
    }
  });
});
