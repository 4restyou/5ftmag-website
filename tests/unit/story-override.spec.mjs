// 글 공개 여부 오버라이드 — js/util.js 의 applyVisibility 와 설정 동기화.
//
// util.js 는 IIFE 안에서 window.MagUtil 을 세팅하는 클라 모듈이라
// jsdom 환경의 globalThis.window 에 그대로 실행시켜 사용한다 (util.spec.mjs 와 같은 방식).

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

let utilCode = '';
let dbCode = '';

beforeAll(() => {
  utilCode = fs.readFileSync(path.resolve(process.cwd(), 'js/util.js'), 'utf8');
  dbCode = fs.readFileSync(path.resolve(process.cwd(), 'js/db-client.js'), 'utf8');
  // eslint-disable-next-line no-eval
  (0, eval)(utilCode);
});

describe('MagUtil.applyVisibility', () => {
  const list = [
    { id: 'a', title: '기본 공개', published: true },
    { id: 'b', title: '기본 비공개', published: false },
    { id: 'c', title: 'published 없음' },
  ];

  it('오버라이드가 없으면 원본 배열을 그대로 돌려준다', () => {
    expect(window.MagUtil.applyVisibility(list, [])).toBe(list);
    expect(window.MagUtil.applyVisibility(list, null)).toBe(list);
  });

  it('오버라이드가 stories.json 의 published 를 이긴다', () => {
    const out = window.MagUtil.applyVisibility(list, [
      { story_id: 'a', published: false },
      { story_id: 'b', published: true },
    ]);
    expect(out[0].published).toBe(false);
    expect(out[1].published).toBe(true);
  });

  it('행이 없는 글은 건드리지 않는다', () => {
    const out = window.MagUtil.applyVisibility(list, [{ story_id: 'a', published: false }]);
    expect(out[2]).toBe(list[2]);
  });

  it('원본 배열과 원본 항목을 바꾸지 않는다', () => {
    const out = window.MagUtil.applyVisibility(list, [{ story_id: 'a', published: false }]);
    expect(list[0].published).toBe(true);
    expect(out).not.toBe(list);
  });

  it('id 를 문자열로 맞춰 본다 (JSON 의 숫자 id 대비)', () => {
    const numeric = [{ id: 18, title: '숫자 id', published: true }];
    const out = window.MagUtil.applyVisibility(numeric, [{ story_id: '18', published: false }]);
    expect(out[0].published).toBe(false);
  });

  it('story_id 가 없는 행은 무시한다', () => {
    const out = window.MagUtil.applyVisibility(list, [{ published: false }, null]);
    expect(out[0].published).toBe(true);
  });

  it('배열이 아닌 입력에도 터지지 않는다', () => {
    expect(window.MagUtil.applyVisibility(null, [])).toEqual([]);
    expect(window.MagUtil.applyVisibility(undefined, [{ story_id: 'a', published: false }])).toEqual([]);
  });
});

// util.js 는 db-client.js 와 따로 Supabase URL·anon 키를 들고 있다.
// db-client 는 supabase UMD CDN 에 의존하고 페이지마다 로드 순서가 달라서,
// 목록 렌더가 그 둘에 묶이면 안 되기 때문이다. 대신 값이 갈라지면 오버라이드
// 조회가 조용히 실패하므로 여기서 묶어 둔다.
describe('util.js 와 db-client.js 의 Supabase 설정', () => {
  it('URL 이 같다', () => {
    const m = dbCode.match(/const URL_\s*=\s*'([^']+)'/);
    expect(m).not.toBeNull();
    expect(window.MagUtil.supabaseConfig.url).toBe(m[1]);
  });

  it('anon 키가 같다', () => {
    const m = dbCode.match(/const ANON_\s*=\s*'([^']+)'/);
    expect(m).not.toBeNull();
    expect(window.MagUtil.supabaseConfig.anonKey).toBe(m[1]);
  });
});

// 목록을 읽는 페이지가 제각각 fetch 하면 "홈에는 없는데 검색에는 나오는" 상태가
// 된다. 실제로 이 기능을 넣기 전에 일곱 곳이 따로 읽고 있었다.
describe('글 목록 로딩 경로', () => {
  const pages = [
    'js/home-page.js',
    'js/stories-page.js',
    'js/search-page.js',
    'js/me-page.js',
    'js/films-page.js',
    'js/article-author-bio.js',
    'js/mobile-home.js',
  ];

  it('공개 화면은 stories.json 을 직접 fetch 하지 않는다', () => {
    for (const p of pages) {
      const code = fs.readFileSync(path.resolve(process.cwd(), p), 'utf8')
        .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code, `${p} 가 stories.json 을 직접 읽고 있다`).not.toMatch(/fetch\w*\(\s*['"][^'"]*stories\.json/);
    }
  });

  it('모두 MagUtil.loadStories 를 쓴다', () => {
    for (const p of pages) {
      const code = fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');
      expect(code, `${p} 에 loadStories 호출이 없다`).toMatch(/MagUtil\.loadStories\(\)/);
    }
  });
});
