import { describe, expect, it } from 'vitest';
import { isPublishedContent, seoulTodayIso } from '../../scripts/story-visibility.mjs';

describe('story visibility', () => {
  it('hides explicitly unpublished and future-dated content', () => {
    expect(isPublishedContent({ published: false, date: '2026-06-01' }, '2026-06-20')).toBe(false);
    expect(isPublishedContent({ published: true, date: '2026-06-24' }, '2026-06-20')).toBe(false);
  });

  it('shows content on its Seoul publication date', () => {
    expect(isPublishedContent({ published: true, date: '2026-06-20' }, '2026-06-20')).toBe(true);
    expect(isPublishedContent({ published: true, date: '2026-06-19' }, '2026-06-20')).toBe(true);
  });

  it('calculates the calendar date in Asia/Seoul', () => {
    expect(seoulTodayIso(new Date('2026-06-19T15:30:00Z'))).toBe('2026-06-20');
  });
});
