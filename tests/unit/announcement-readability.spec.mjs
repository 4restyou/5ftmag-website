import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let dom;
afterEach(() => dom?.window.close());

async function setup(lang = 'ko', long = true) {
  dom = new JSDOM(`<html lang="${lang}"><body><header></header></body></html>`, { url: `https://5ftmag.com/${lang === 'ko' ? '' : lang + '/'}films.html`, runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(readFileSync('js/i18n.js', 'utf8'));
  window.requestAnimationFrame = cb => cb();
  window.setTimeout = cb => cb();
  Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', { get: () => long ? 96 : 32 });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 32 });
  window.MagDB = { isReady: () => true, announcements: { current: async () => ({ data: { id: 'notice', body: '**긴 공지** <script>unsafe</script>', body_en: '**Long notice**', body_ja: '**長いお知らせ**' } }) } };
  // Use the actual shared renderer/dismissal code, without booting unrelated site features.
  const shared = readFileSync('js/site-common.js', 'utf8');
  const region = shared.slice(shared.indexOf("  const DISMISS_KEY ="), shared.indexOf("  const INAPP_DISMISS_KEY ="));
  window.eval(`const i18n = window.i18n; const tr = i18n.t; ${region}\nwindow.auditAnnouncement = setupAnnouncementBar;`);
  await window.auditAnnouncement();
  await Promise.resolve();
  return window;
}

describe('U02 readable announcements', () => {
  it.each(['ko', 'en', 'ja'])('expands and collapses static text in %s without replacing dismissal', async lang => {
    const window = await setup(lang);
    const bar = window.document.querySelector('.announcement-bar');
    const toggle = bar.querySelector('.announcement-bar-expand');
    expect(toggle.hidden).toBe(false);
    expect(toggle.getAttribute('aria-controls')).toBe(bar.querySelector('.announcement-bar-text').id);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(bar.classList.contains('is-expanded')).toBe(true);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    bar.querySelector('.announcement-bar-close').click();
    expect(window.document.querySelector('.announcement-bar')).toBeNull();
    await window.auditAnnouncement();
    expect(window.document.querySelector('.announcement-bar')).toBeNull();
  });

  it('leaves short notices fully visible without an expand control', async () => {
    const window = await setup('ko', false);
    expect(window.document.querySelector('.announcement-bar-expand').hidden).toBe(true);
    expect(window.document.querySelector('.announcement-bar-text strong').textContent).toBe('긴 공지');
    expect(window.document.querySelector('.announcement-bar script')).toBeNull();
  });

  it('wraps without animation regardless of motion preference', async () => {
    const window = await setup();
    const style = window.document.createElement('style');
    const css = readFileSync('css/common.css', 'utf8');
    style.textContent = css.slice(css.indexOf('.announcement-bar {'), css.indexOf('.inapp-notice-bar {'));
    window.document.head.appendChild(style);
    const text = window.document.querySelector('.announcement-bar-text');
    expect(window.getComputedStyle(text).animation).toBe('none');
    expect(window.getComputedStyle(text).whiteSpace).toBe('pre-line');
    expect(window.getComputedStyle(text).getPropertyValue('-webkit-line-clamp')).toBe('2');
    window.document.querySelector('.announcement-bar-expand').click();
    expect(window.getComputedStyle(text).display).toBe('block');
  });
});
