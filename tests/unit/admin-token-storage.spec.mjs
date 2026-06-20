import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const files = ['js/admin-articles-page.js', 'js/admin-article-editor-page.js'];

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
});
