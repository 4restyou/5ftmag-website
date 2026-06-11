import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('story ordering', () => {
  it('keeps same-day SPC photobook issues newest first', () => {
    const rss = read('rss.xml');
    const issue02 = rss.indexOf('stories/spc-issue02.html');
    const issue03 = rss.indexOf('stories/spc-issue03.html');
    expect(issue02).toBeGreaterThan(-1);
    expect(issue03).toBeGreaterThan(-1);
    expect(issue03).toBeLessThan(issue02);

    for (const file of ['js/stories-page.js', 'js/home-page.js', 'scripts/build-rss.mjs']) {
      const source = read(file);
      expect(source).toContain('function spcIssueNumber');
      expect(source).toContain('return bSpc - aSpc;');
    }
  });

  it('uses SPC issue badges consistently for the photobook series', () => {
    const stories = JSON.parse(read('data/stories.json'));
    for (const issue of ['01', '02', '03']) {
      const story = stories.find((item) => item.id === `spc-issue${issue}`);
      expect(story?.issue).toBe(`SPC 사진첩 #${issue}`);
    }
  });
});
