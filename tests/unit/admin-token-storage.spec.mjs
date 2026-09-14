import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// 기사 작성만 GitHub 토큰을 쓴다. 글 목록의 공개/비공개 토글은
// story_visibility 로 옮겨서 토큰이 필요 없어졌다.
const files = ['js/admin-article-editor-page.js'];

describe('admin GitHub token storage', () => {
  for (const file of files) {
    it(`${file} keeps PAT in the tab session and removes legacy persistence`, () => {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain('sessionStorage.getItem(PAT_KEY)');
      expect(source).toContain('sessionStorage.setItem(PAT_KEY');
      expect(source).toContain('localStorage.removeItem(PAT_KEY)');
      expect(source).not.toContain('localStorage.getItem(PAT_KEY)');
      expect(source).not.toContain('localStorage.setItem(PAT_KEY');
    });
  }

  it('글 목록 토글은 GitHub 토큰을 쓰지 않는다', () => {
    const source = readFileSync('js/admin-articles-page.js', 'utf8');
    expect(source).not.toContain('PAT_KEY');
    expect(source).not.toContain('api.github.com');
    expect(source).toContain('articles.setPublished');
  });
});
