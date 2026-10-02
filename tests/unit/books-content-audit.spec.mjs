import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let dom;
afterEach(() => dom?.window.close());

async function setup(lang = 'ko', owned = false) {
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
    webzine: { listPublished: async () => [{ id: 'free', title: 'Free issue', slug: 'free', category: '5ft.mag', pdf_path: 'free.pdf' }], publicUrl: p => '/' + p },
    ebooks: {
      listPublished: async () => [{ id: 'paid', title: 'SPC <Photo> book', slug: 'spc', kind: 'photobook', author: 'Photographer', binding: 'Hardcover', price: 4000 }],
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
  ])('labels access and selection separately from binding in %s', async (lang, access, paid, free) => {
    const window = await setup(lang);
    const doc = window.document;
    expect(doc.querySelector('.wz-buy').textContent).toContain(access);
    expect(doc.querySelector('.wz-kind').textContent).toBe(paid);
    expect(doc.querySelector('.wz-book-info').textContent).toContain('Hardcover');
    expect(doc.querySelector('.wz-kind').textContent).not.toContain('Hardcover');
    expect(doc.querySelector('.wz-by').textContent).toBe('Photographer');
    expect(doc.querySelector('.wz-buy').getAttribute('href')).toMatch(new RegExp(`^/${lang === 'ko' ? '' : lang + '/'}ebook-read.html`));
    const select = doc.getElementById('wzBookSelect');
    expect(select.options[0].textContent).toContain('SPC <Photo> book');
    expect(doc.getElementById('wzSelectedBook').textContent).toContain(paid);
    select.value = '1';
    select.dispatchEvent(new window.Event('change'));
    expect(doc.getElementById('wzSelectedBook').textContent).toContain('Free issue');
    expect(doc.getElementById('wzSelectedBook').textContent).toContain(free);
    expect(doc.querySelectorAll('.wz-row').length).toBe(2);
    expect(doc.querySelector('Photo')).toBeNull();
  });

  it('shows full reading and owned access without a purchase prompt for owners', async () => {
    const window = await setup('ko', true);
    await vi.waitFor(() => expect(window.document.querySelector('.wz-own')).not.toBeNull());
    expect(window.document.querySelector('.wz-buy')).toBeNull();
    expect(window.document.querySelector('.wz-own').textContent).toContain('전체 읽기');
    expect(window.document.querySelector('.wz-access-note').textContent).toContain('열람권 보유');
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
    const select = doc.getElementById('wzBookSelect');
    rows.forEach((row, i) => { row.getBoundingClientRect = () => ({ top: 374 + i * 80, height: 20 }); });
    select.value = '1';
    select.dispatchEvent(new window.Event('change'));
    expect(rows[1].scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    expect(doc.querySelectorAll('.wz-hit')[1].tabIndex).toBe(0);
    const observer = window.auditObservers.find(o => !o.options.root);
    observer.callback([{ target: rows[0], isIntersecting: true }]);
    expect(select.value).toBe('1');
    rows[1].getBoundingClientRect = () => ({ top: 375, height: 20 });
    rows[0].getBoundingClientRect = () => ({ top: 500, height: 20 });
    observer.callback([{ target: rows[1], isIntersecting: true }]);
    expect(select.value).toBe('1');
  });

  it('uses the nearest visible row, not intersection callback order', async () => {
    const window = await setup();
    const doc = window.document;
    const rows = Array.from(doc.querySelectorAll('.wz-row'));
    rows[0].getBoundingClientRect = () => ({ top: 375, height: 20 });
    rows[1].getBoundingClientRect = () => ({ top: 390, height: 20 });
    const observer = window.auditObservers.find(o => !o.options.root);
    observer.callback(rows.map(target => ({ target, isIntersecting: true })).reverse());
    expect(doc.getElementById('wzBookSelect').value).toBe('0');
    expect(doc.querySelectorAll('.wz-hit')[0].tabIndex).toBe(0);
    expect(doc.querySelectorAll('.wz-hit')[1].tabIndex).toBe(-1);
  });

  it('leaves a focused selector unchanged during shelf observation', async () => {
    const window = await setup();
    const doc = window.document;
    const select = doc.getElementById('wzBookSelect');
    select.focus(); select.value = '1';
    const first = doc.querySelector('.wz-row');
    first.getBoundingClientRect = () => ({ top: 375, height: 20 });
    window.auditObservers.find(o => !o.options.root).callback([{ target: first, isIntersecting: true }]);
    expect(select.value).toBe('1');
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
