import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Browser publishing is retired; old tokens must be erased without reading them.
const files = ['js/admin-article-editor-page.js'];

describe('admin GitHub token storage', () => {
  for (const file of files) {
    it(`${file} clears both legacy token stores without reading credentials`, () => {
      const source = readFileSync(file, 'utf8');
      const removed = [];
      const storage = name => ({
        getItem() { throw new Error('must not read a token'); },
        setItem() { throw new Error('must not persist a token'); },
        removeItem(key) { removed.push([name, key]); },
      });
      vm.runInNewContext(source, { window: { localStorage: storage('local'), sessionStorage: storage('session') } });
      expect(removed).toEqual([['local', '5ft-gh-pat'], ['session', '5ft-gh-pat']]);
      expect(source).not.toContain('api.github.com');
    });
  }

  it('글 목록 토글은 GitHub 토큰을 쓰지 않는다', () => {
    const source = readFileSync('js/admin-articles-page.js', 'utf8');
    expect(source).not.toContain('PAT_KEY');
    expect(source).not.toContain('api.github.com');
    expect(source).toContain('articles.setPublished');
  });
});
