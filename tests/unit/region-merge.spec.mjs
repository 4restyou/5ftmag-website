import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// 2026-07-01 전남광주통합특별시 출범으로 광주와 전남이 하나가 됐다.
// 지역 목록이 네 곳에 흩어져 있어서, 한 곳만 고치면 화면과 사이트맵이 어긋난다.
describe('전남광주 지역 통합', () => {
  const files = {
    '화면 필터': 'js/labs-page.js',
    '지역 페이지 생성': 'scripts/build-lab-pages.mjs',
    '사이트맵': 'scripts/build-sitemap.mjs',
    'llms.txt': 'scripts/build-llms.mjs',
  };

  it('네 곳 모두 전남광주 하나로 쓰고 옛 지역을 남기지 않는다', () => {
    for (const [label, path] of Object.entries(files)) {
      const code = read(path).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
      expect(code, `${label}(${path})에 전남광주가 없다`).toMatch(/전남광주/);
      expect(code, `${label}(${path})에 옛 지역 '광주'가 남아 있다`).not.toMatch(/'광주'/);
      expect(code, `${label}(${path})에 옛 지역 '전남'이 남아 있다`).not.toMatch(/'전남'/);
    }
  });

  it('옛 지역 주소를 새 주소로 넘긴다', () => {
    // 두 주소 다 색인돼 있었다. 그냥 없애면 링크가 끊긴다.
    const toml = read('netlify.toml');
    for (const old of ['/labs/gwangju', '/labs/jeonnam']) {
      expect(toml).toContain(`from = "${old}"`);
      expect(toml).toContain(`from = "${old}.html"`);
    }
    expect(toml).toMatch(/to = "\/labs\/jeonnamgwangju"/);
    // 로컬 서버도 같게 맞춰 둬야 테스트 환경에서 다르게 동작하지 않는다.
    expect(read('scripts/static-server.mjs')).toMatch(/gwangju\|jeonnam/);
  });

  it('옛 지역 페이지 파일은 지웠다', () => {
    for (const f of ['labs/gwangju.html', 'labs/jeonnam.html']) {
      expect(() => read(f), `${f} 가 아직 남아 있다`).toThrow();
    }
  });
});
