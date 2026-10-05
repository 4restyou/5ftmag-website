import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let dom;
afterEach(() => dom?.window.close());

async function setup(lang = 'ko', owned = false, price = 4000) {
  dom = new JSDOM(readFileSync(`${lang === 'ko' ? '' : lang + '/'}books.html`, 'utf8'), { url: `https://5ftmag.com/${lang === 'ko' ? '' : lang + '/'}books.html`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.eval(readFileSync('js/i18n.js', 'utf8'));
  window.eval(readFileSync('js/util.js', 'utf8'));
  window.matchMedia = () => ({ matches: true });
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.auditObservers = [];
  window.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; window.auditObservers.push(this); }
    observe() {}
    disconnect() {}
  };
  window.MagDB = {
    isReady: () => true,
    auth: { onChange: callback => { window.auditBookAuthChange = callback; } },
    webzine: { listPublished: async () => [{ id: 'free', title: 'Free issue', slug: 'free', category: '5ft.mag', pdf_path: 'free.pdf' }], publicUrl: p => '/' + p },
    ebooks: {
      listPublished: async () => [{ id: 'paid', title: 'SPC <Photo> book', slug: 'spc', kind: 'photobook', author: 'Photographer', binding: 'Hardcover', price }],
      myEntitlementIds: async () => new Set(owned ? ['paid'] : []),
    },
    favorites: { idsForType: async () => new Set() },
  };
  window.eval(readFileSync('js/webzine-stack-page.js', 'utf8'));
  await vi.waitFor(() => expect(window.document.querySelectorAll('.wz-row').length).toBe(2));
  return window;
}

describe('U03 bookshelf content', () => {
  it.each([
    ['ko', '전자책 열람권', '유료 전자책', '무료 열람'],
    ['en', 'Ebook reading access', 'Paid ebook', 'Free to read'],
    ['ja', '電子書籍の閲覧権', '有料電子書籍', '無料閲覧'],
  ])('keeps the visual shelf and labels access separately from binding in %s', async (lang, access, paid, free) => {
    const window = await setup(lang);
    const doc = window.document;
    expect(doc.querySelector('.wz-buy').textContent).toContain({ ko: '구매하기', en: 'Purchase', ja: '購入する' }[lang]);
    expect(doc.querySelector('.wz-preview').hidden).toBe(false);
    expect(doc.querySelector('.wz-owned').hidden).toBe(true);
    expect(doc.querySelector('.wz-kind').textContent).toBe(paid);
    expect(doc.querySelector('.wz-book-info:not(.wz-price)').textContent).toContain('Hardcover');
    expect(doc.querySelector('.wz-price').textContent).toContain(access);
    expect(doc.querySelector('.wz-price').textContent).toContain('4,000');
    expect(doc.querySelectorAll('.wz-price')).toHaveLength(1);
    expect(doc.querySelector('.wz-kind').textContent).not.toContain('Hardcover');
    expect(doc.querySelector('.wz-by').textContent).toBe('Photographer');
    expect(doc.querySelector('.wz-buy').getAttribute('href')).toMatch(new RegExp(`^/${lang === 'ko' ? '' : lang + '/'}ebook-read.html`));
    expect(doc.querySelector('#wzBookSelect, #wzSelectedBook, .wz-selection')).toBeNull();
    expect(doc.querySelector('.wz-intro a')).toBeNull();
    const library = doc.querySelector('.wz-library-link');
    expect(library.parentElement.id).toBe('wzMarks');
    expect(library.previousElementSibling.className).toBe('wz-mark-label');
    expect(library.getAttribute('href')).toBe(`/${lang === 'ko' ? '' : lang + '/'}me.html#fav-webzine`);
    expect(library.getAttribute('aria-label')).toBeTruthy();
    expect(doc.getElementById(library.getAttribute('aria-describedby')).getAttribute('role')).toBe('tooltip');
    const hits = doc.querySelectorAll('.wz-hit');
    expect(hits[0].getAttribute('aria-label')).toContain('SPC <Photo> book');
    expect(hits[0].getAttribute('aria-label')).toContain(paid);
    expect(hits[1].getAttribute('aria-label')).toContain('Free issue');
    expect(hits[1].getAttribute('aria-label')).toContain(free);
    expect(doc.querySelectorAll('.wz-row').length).toBe(2);
    expect(doc.querySelector('Photo')).toBeNull();
  });

  it.each([
    ['ko', '전체 읽기', '열람권 보유', '전자책 열람권', '구매함'],
    ['en', 'Read the whole book', 'access owned', 'Ebook reading access', 'Purchased'],
    ['ja', '全編を読む', '閲覧権あり', '電子書籍の閲覧権', '購入済み'],
  ])('retains the price with full reading and owned access in %s', async (lang, read, owned, access, badge) => {
    const window = await setup(lang, true);
    await vi.waitFor(() => expect(window.document.querySelector('.wz-own')).not.toBeNull());
    expect(window.document.querySelector('.wz-buy')).toBeNull();
    expect(window.document.querySelector('.wz-own').textContent).toContain(read);
    expect(window.document.querySelector('.wz-access-note').textContent).toContain(owned);
    expect(window.document.querySelector('.wz-price').textContent).toContain(access);
    expect(window.document.querySelector('.wz-price').textContent).toContain('4,000');
    expect(window.document.querySelectorAll('.wz-price')).toHaveLength(1);
    expect(window.document.querySelector('.wz-preview').hidden).toBe(true);
    expect(window.document.querySelector('.wz-owned').hidden).toBe(false);
    expect(window.document.querySelector('.wz-owned').textContent).toBe(badge);
    expect(window.document.querySelector('.wz-stage3d').getAttribute('aria-label')).toContain(read);
    expect(window.document.querySelector('.wz-own').getAttribute('href')).not.toContain('buy=1');
  });

  it('restores preview and purchase on sign-out, then full reading on sign-in', async () => {
    const window = await setup('ko', true);
    const doc = window.document;
    await vi.waitFor(() => expect(doc.querySelector('.wz-own')).not.toBeNull());
    window.auditBookAuthChange('SIGNED_OUT');
    expect(doc.querySelector('.wz-own')).toBeNull();
    expect(doc.querySelector('.wz-buy').textContent).toContain('구매하기');
    expect(doc.querySelector('.wz-buy').getAttribute('href')).toContain('buy=1');
    expect(doc.querySelector('.wz-preview').hidden).toBe(false);
    expect(doc.querySelector('.wz-owned').hidden).toBe(true);
    window.auditBookAuthChange('SIGNED_IN');
    await vi.waitFor(() => expect(doc.querySelector('.wz-own')).not.toBeNull());
    expect(doc.querySelector('.wz-preview').hidden).toBe(true);
  });

  it('does not restore owned UI from an entitlement query that finishes after sign-out', async () => {
    const window = await setup();
    let finish;
    window.MagDB.ebooks.myEntitlementIds = () => new Promise(resolve => { finish = resolve; });
    window.auditBookAuthChange('SIGNED_IN');
    window.auditBookAuthChange('SIGNED_OUT');
    finish(new Set(['paid']));
    await Promise.resolve();
    expect(window.document.querySelector('.wz-own')).toBeNull();
    expect(window.document.querySelector('.wz-preview').hidden).toBe(false);
    expect(window.document.querySelector('.wz-owned').hidden).toBe(true);
  });

  it('routes cover clicks and Enter to the currently visible full-read action', async () => {
    const window = await setup('ko', true);
    const doc = window.document;
    await vi.waitFor(() => expect(doc.querySelector('.wz-own')).not.toBeNull());
    const read = vi.fn(e => { e.preventDefault(); e.stopImmediatePropagation(); });
    doc.querySelector('.wz-own').addEventListener('click', read, true);
    const stage = doc.querySelector('.wz-stage3d');
    stage.click();
    stage.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('does not show a paid-access price for a free ebook or webzine', async () => {
    const window = await setup('ko', false, 0);
    expect(window.document.querySelectorAll('.wz-price, .wz-buy')).toHaveLength(0);
    expect(Array.from(window.document.querySelectorAll('.wz-kind'), el => el.textContent)).toEqual(['무료 열람', '무료 열람']);
  });
});

describe('U01 and C04 bounded HTML links', () => {
  it.each([
    ['', ['필름', '사진']], ['en/', ['Films', 'Photos']], ['ja/', ['フィルム', '写真']],
  ])('uses concise tabs and existing saved routes in %s', (prefix, labels) => {
    const page = new JSDOM(readFileSync(prefix + 'films.html', 'utf8'));
    const doc = page.window.document;
    expect(Array.from(doc.querySelectorAll('.library-view-btn'), el => el.textContent)).toEqual(labels);
    expect(doc.querySelector('a[href$="me.html#fav-films"]')).not.toBeNull();
    page.window.close();
    const books = new JSDOM(readFileSync(prefix + 'books.html', 'utf8'));
    expect(books.window.document.querySelector('a[href$="me.html#fav-webzine"]')).not.toBeNull();
    books.window.close();
  });
});

describe('U04 selection and observer ownership', () => {
  it('scrolls the selected row and ignores intermediate observer entries', async () => {
    const window = await setup();
    const doc = window.document;
    const rows = Array.from(doc.querySelectorAll('.wz-row'));
    rows.forEach((row, i) => { row.getBoundingClientRect = () => ({ top: 374 + i * 80, height: 20 }); });
    doc.querySelectorAll('.wz-mark')[1].click();
    expect(rows[1].scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    expect(doc.querySelectorAll('.wz-hit')[1].tabIndex).toBe(0);
    const observer = window.auditObservers.find(o => !o.options.root);
    observer.callback([{ target: rows[0], isIntersecting: true }]);
    expect(doc.querySelectorAll('.wz-hit')[1].tabIndex).toBe(0);
    rows[1].getBoundingClientRect = () => ({ top: 375, height: 20 });
    rows[0].getBoundingClientRect = () => ({ top: 500, height: 20 });
    observer.callback([{ target: rows[1], isIntersecting: true }]);
    expect(doc.querySelectorAll('.wz-hit')[1].tabIndex).toBe(0);
    expect(doc.querySelectorAll('.wz-mark')[1].classList.contains('on')).toBe(true);
  });

  it('uses the nearest visible row, not intersection callback order', async () => {
    const window = await setup();
    const doc = window.document;
    const rows = Array.from(doc.querySelectorAll('.wz-row'));
    rows[0].getBoundingClientRect = () => ({ top: 375, height: 20 });
    rows[1].getBoundingClientRect = () => ({ top: 390, height: 20 });
    const observer = window.auditObservers.find(o => !o.options.root);
    observer.callback(rows.map(target => ({ target, isIntersecting: true })).reverse());
    expect(doc.querySelectorAll('.wz-hit')[0].tabIndex).toBe(0);
    expect(doc.querySelectorAll('.wz-hit')[1].tabIndex).toBe(-1);
  });

  it('keeps keyboard focus on a book during shelf observation', async () => {
    const window = await setup();
    const doc = window.document;
    const hit = doc.querySelectorAll('.wz-hit')[1];
    hit.focus();
    expect(hit.tabIndex).toBe(0);
    const first = doc.querySelector('.wz-row');
    first.getBoundingClientRect = () => ({ top: 375, height: 20 });
    window.auditObservers.find(o => !o.options.root).callback([{ target: first, isIntersecting: true }]);
    expect(doc.activeElement).toBe(hit);
  });

  it('includes fixed controls and excludes inactive inert pages in the shared focus trap', async () => {
    const window = await setup();
    const doc = window.document;
    const shared = readFileSync('js/site-common.js', 'utf8');
    window.eval(shared.slice(shared.indexOf('  const FOCUSABLE_SEL ='), shared.indexOf('  let _srHost =')));
    const modal = doc.createElement('div');
    modal.innerHTML = '<button id="fixed-back">Back</button><section inert><button>Inactive</button></section><section><button id="active-action">Read</button></section>';
    doc.body.appendChild(modal);
    modal.querySelectorAll('button').forEach(el => { el.getClientRects = () => [{}]; });
    const back = modal.querySelector('#fixed-back');
    Object.defineProperty(back, 'offsetParent', { get: () => null });
    const release = window.createFocusTrap(modal);
    await vi.waitFor(() => expect(doc.activeElement).toBe(back));
    back.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(doc.activeElement.id).toBe('active-action');
    doc.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(doc.activeElement).toBe(back);
    release();
  });
});
