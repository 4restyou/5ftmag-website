import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let dom;
afterEach(() => dom?.window.close());

// 공지 배너: 길이와 상관없이 한 줄로 흐른다(마퀴). 운영자 결정, 2026-10-05.
async function setup(lang = 'ko', long = true) {
  dom = new JSDOM(`<html lang="${lang}"><body><header></header></body></html>`, { url: `https://5ftmag.com/${lang === 'ko' ? '' : lang + '/'}films.html`, runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(readFileSync('js/i18n.js', 'utf8'));
  window.requestAnimationFrame = cb => cb();
  window.setTimeout = cb => cb();
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get: () => (long ? 2400 : 100) });
  window.MagDB = { isReady: () => true, announcements: { current: async () => ({ data: { id: 'notice', body: '**긴 공지** <script>unsafe</script>', body_en: '**Long notice**', body_ja: '**長いお知らせ**' } }) } };
  // Use the actual shared renderer/dismissal code, without booting unrelated site features.
  const shared = readFileSync('js/site-common.js', 'utf8');
  const region = shared.slice(shared.indexOf("  const DISMISS_KEY ="), shared.indexOf("  const INAPP_DISMISS_KEY ="));
  window.eval(`const i18n = window.i18n; const tr = i18n.t; ${region}\nwindow.auditAnnouncement = setupAnnouncementBar;`);
  await window.auditAnnouncement();
  await Promise.resolve();
  return window;
}

describe('U02 announcement marquee', () => {
  it.each(['ko', 'en', 'ja'])('long notices scroll in %s and stay dismissed after closing', async lang => {
    const window = await setup(lang);
    const bar = window.document.querySelector('.announcement-bar');
    expect(bar.querySelector('.announcement-bar-text').style.animationDuration).toBe('60s');
    expect(bar.querySelector('.announcement-bar-expand')).toBeNull();
    bar.querySelector('.announcement-bar-close').click();
    expect(window.document.querySelector('.announcement-bar')).toBeNull();
    await window.auditAnnouncement();
    expect(window.document.querySelector('.announcement-bar')).toBeNull();
  });

  it('short notices still scroll, at least 12s per pass, and the body is escaped', async () => {
    const window = await setup('ko', false);
    expect(window.document.querySelector('.announcement-bar-text').style.animationDuration).toBe('12s');
    expect(window.document.querySelector('.announcement-bar-text strong').textContent).toBe('긴 공지');
    expect(window.document.querySelector('.announcement-bar script')).toBeNull();
  });

  it('runs a single-line marquee and pauses it for hover, focus and reduced motion', () => {
    const css = readFileSync('css/common.css', 'utf8');
    const block = css.slice(css.indexOf('.announcement-bar {'), css.indexOf('.inapp-notice-bar {'));
    expect(block).toMatch(/\.announcement-bar-text \{[^}]*white-space: nowrap;[^}]*animation: announcement-marquee/);
    expect(block).toMatch(/\.announcement-bar:focus-within \.announcement-bar-text \{ animation-play-state: paused; \}/);
    expect(block).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*?\.announcement-bar-text \{ animation: none;/);
  });
});
