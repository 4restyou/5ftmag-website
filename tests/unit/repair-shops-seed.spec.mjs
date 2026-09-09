import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIR = join(ROOT, 'supabase/migrations');

// 이 사이트는 수리점을 "이름 + 지역" 으로 구분한다 (js/labs-page.js 의 슬러그가
// name-region 으로 만들어지고, 거기 주석에도 "같은 이름이 지역 달리 있을 수
// 있음" 이라고 적혀 있다).
//
// 중복 방지를 이름만으로 걸면 다른 지역에 같은 이름이 있을 때 새 항목이 조용히
// 건너뛰어진다. 실제로 부산 중앙카메라가 그렇게 빠졌고, 화면에 아무 흔적도
// 남지 않아 찾는 데 시간이 걸렸다.
//
// 적용 범위는 20260909000002 부터다. 그 앞의 마이그레이션은 이미 prod 에
// 적용됐고, 적용된 파일을 고쳐도 다시 실행되지 않아 기록만 어긋난다.
const APPLIES_FROM = '20260909000002';

describe('수리점 시드 마이그레이션', () => {
  const files = readdirSync(DIR)
    .filter(f => /repair_shops/.test(f) && f >= APPLIES_FROM);

  it('중복 방지 조건에 지역을 함께 본다', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const sql = readFileSync(join(DIR, f), 'utf8');
      for (const guard of sql.match(/where not exists \([\s\S]*?\n\);/g) || []) {
        if (!/r\.name/.test(guard)) continue;
        expect(guard, `${f} 의 중복 방지 조건에 region 이 없다`).toMatch(/r\.region/);
      }
    }
  });
});
