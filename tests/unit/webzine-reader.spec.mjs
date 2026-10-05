import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let dom;
afterEach(() => { dom?.window.document.querySelector('[data-close]')?.click(); dom?.window.close(); });

async function openReader({ total = 3, orientation = 'portrait', cta = true, records = [], opts = {}, fingerprint = 'edition-v1', storageBlocked = false, url = '/preview.pdf' } = {}) {
  dom = new JSDOM('', { url: 'https://5ftmag.com', runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.setItem('5ft-book-progress-v1', typeof records === 'string' ? records : JSON.stringify(records));
  if (storageBlocked) Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
  window.HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}));
  const page = { getViewport: () => ({ width: 400, height: 600 }), render: () => ({ promise: Promise.resolve() }) };
  window.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: vi.fn(() => ({ promise: Promise.resolve({ numPages: total, fingerprints: [fingerprint], getPage: async () => page, destroy() {} }) })),
  };
  let flip;
  window.St = { PageFlip: class {
    constructor(_book, options) { flip = this; this.index = options.startPage || 0; this.events = {}; }
    loadFromHTML() {}
    on(name, cb) { this.events[name] = cb; }
    getCurrentPageIndex() { return this.index; }
    getOrientation() { return orientation; }
    move(index) { this.index = index; this.events.flip(); }
    turnToPage(index) { this.move(index); }
    destroy() {}
  } };
  // 페이지처럼 i18n.js · util.js 를 먼저 싣는다
  window.eval(readFileSync('js/i18n.js', 'utf8'));
  window.eval(readFileSync('js/util.js', 'utf8'));
  window.eval(readFileSync('js/webzine-reader.js', 'utf8'));
  await window.WebzineReader.open(url, 'Preview', { ...(cta ? { cta: { note: 'Preview ended', label: 'Buy' } } : {}), ...opts });
  return { window, flip, note: window.document.querySelector('.wz-reader-cta-note') };
}

describe('PDF reader', () => {
  it('keeps preparation hidden until the first canvas and the opening handoff are ready', async () => {
    const { window } = await openReader({ total: 1 });
    window.document.querySelector('[data-close]').click();
    let finishRender, finishHandoff;
    const rendered = new Promise(resolve => { finishRender = resolve; });
    const onReady = vi.fn(() => new Promise(resolve => { finishHandoff = resolve; }));
    const page = { getViewport: () => ({ width: 400, height: 600 }), render: () => ({ promise: rendered }) };
    window.pdfjsLib.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: async () => page, destroy() {} }) });
    const opened = window.WebzineReader.open('/delayed.pdf', 'Delayed', { deferReveal: true, onReady });
    await vi.waitFor(() => expect(window.document.querySelector('.wz-reader-book .wz-page')).not.toBeNull());
    expect(window.document.querySelector('.wz-reader').classList.contains('is-preparing')).toBe(true);
    expect(window.document.querySelector('.wz-reader').hasAttribute('inert')).toBe(true);
    expect(window.document.querySelector('canvas')).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    finishRender();
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    expect(window.document.querySelector('.wz-reader-book canvas')).not.toBeNull();
    expect(window.document.querySelector('.wz-reader-loading')).not.toBeNull();
    finishHandoff(); await opened;
    expect(window.document.querySelector('.wz-reader').classList.contains('is-preparing')).toBe(false);
    expect(window.document.querySelector('.wz-reader').hasAttribute('inert')).toBe(false);
    expect(window.document.querySelector('.wz-reader-loading')).toBeNull();
  });
  it('cancels preparation and ignores its delayed document when another book is opened', async () => {
    const { window } = await openReader({ total: 1 });
    window.document.querySelector('[data-close]').click();
    let finishOld;
    const destroy = vi.fn();
    const controller = new window.AbortController();
    const onReady = vi.fn();
    const oldDoc = { numPages: 1, getPage: vi.fn(), destroy() {} };
    window.pdfjsLib.getDocument.mockReturnValueOnce({ promise: new Promise(resolve => { finishOld = resolve; }), destroy });
    const old = window.WebzineReader.open('/old.pdf', 'Old', { deferReveal: true, signal: controller.signal, onReady, bookKey: 'webzine:old:free' });
    await vi.waitFor(() => expect(finishOld).toBeTypeOf('function'));
    controller.abort();
    expect(destroy).toHaveBeenCalledOnce();
    expect(window.document.querySelector('.wz-reader')).toBeNull();
    await window.WebzineReader.open('/new.pdf', 'New');
    finishOld(oldDoc); await old;
    expect(oldDoc.getPage).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(window.document.querySelector('.wz-reader-title').textContent).toBe('New');
    expect(window.document.querySelector('canvas')).not.toBeNull();
    expect(window.WebzineReader.progressFor('webzine:old:free')).toBeNull();
  });
  it('returns a deferred rendering failure to the detail instead of revealing a blank reader', async () => {
    const { window } = await openReader({ total: 1 });
    window.document.querySelector('[data-close]').click();
    const page = { getViewport: () => ({ width: 400, height: 600 }), render: () => ({ promise: Promise.reject(new Error('render failed')) }) };
    window.pdfjsLib.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: async () => page, destroy() {} }) });
    const onError = vi.fn(), onClose = vi.fn(), onReady = vi.fn();
    await window.WebzineReader.open('/failed.pdf', 'Failed', { deferReveal: true, onError, onClose, onReady, bookKey: 'webzine:failed:free' });
    expect(window.document.querySelector('.wz-reader')).toBeNull();
    expect(onError).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce();
    expect(onReady).not.toHaveBeenCalled();
    expect(window.WebzineReader.progressFor('webzine:failed:free')).toBeNull();
  });
  it('prepares dependencies without opening the reader or requesting a PDF', async () => {
    const { window } = await openReader();
    window.document.querySelector('[data-close]').click();
    window.pdfjsLib.getDocument.mockClear();
    await window.WebzineReader.prepare();
    expect(window.pdfjsLib.getDocument).not.toHaveBeenCalled();
    expect(window.document.querySelector('.wz-reader')).toBeNull();
  });
  it('keeps the ending note hidden until the final page, including navigating back', async () => {
    const { note, flip, window } = await openReader();
    expect(note.hidden).toBe(true);
    flip.move(1);
    expect(note.hidden).toBe(true);
    flip.move(2);
    expect(note.hidden).toBe(false);
    flip.move(0);
    expect(note.hidden).toBe(true);
    expect(window.document.querySelector('.wz-reader-loading')).toBeNull();
  });
  it('recognizes the final two-page spread', async () => {
    const { note, flip } = await openReader({ orientation: 'landscape' });
    expect(note.hidden).toBe(true);
    flip.move(1);
    expect(note.hidden).toBe(false);
  });
  it('handles a single-page preview', async () => {
    expect((await openReader({ total: 1 })).note.hidden).toBe(false);
  });
  it('does not add a purchase prompt for entitled readers', async () => {
    const { window } = await openReader({ cta: false });
    expect(window.document.querySelector('[data-cta]')).toBeNull();
  });
  it('pins the worker and disables evaluation without weakening CSP', async () => {
    const { window } = await openReader();
    expect(window.pdfjsLib.GlobalWorkerOptions.workerSrc).toContain('pdfjs-dist@6.3.289/legacy/build/pdf.worker.min.mjs');
    expect(window.pdfjsLib.getDocument).toHaveBeenCalledWith(expect.objectContaining({ isEvalSupported: false, useWasm: false }));
    expect(window.pdfjsLib.getDocument.mock.calls[0][0].disableStream).toBeUndefined();
  });
  it('restores a matching edition and prepares both visible pages before handoff', async () => {
    const key = 'webzine:vol-22:free';
    const ready = vi.fn(() => {
      expect(dom.window.document.querySelectorAll('.wz-page canvas')).toHaveLength(2);
      expect(dom.window.document.querySelectorAll('.wz-page')[7].querySelector('canvas')).not.toBeNull();
    });
    const { window, flip } = await openReader({ total: 12, orientation: 'landscape', records: [{ key, page: 8, total: 12, at: Date.now(), fingerprint: 'edition-v1' }], opts: { bookKey: key, onReady: ready } });
    expect(flip.index).toBe(7); expect(ready).toHaveBeenCalledOnce();
    expect(window.WebzineReader.progressFor(key).page).toBe(8);
    window.document.querySelector('[data-first]').click();
    await vi.waitFor(() => expect(flip.index).toBe(0));
    expect(window.WebzineReader.progressFor(key).page).toBe(1);
  });
  it.each([{ fingerprint: 'old-edition', total: 12 }, { fingerprint: 'edition-v1', total: 11 }])('resets changed editions instead of resuming a stale page (%j)', async saved => {
    const key = 'webzine:vol-22:free';
    const { flip } = await openReader({ total: 12, records: [{ key, page: 8, at: Date.now(), ...saved }], opts: { bookKey: key } });
    expect(flip.index).toBe(0);
  });
  it('does not transfer full-edition progress into a preview', async () => {
    const { flip } = await openReader({ total: 12, records: [{ key: 'ebook:spc-01:full', page: 8, total: 12, at: Date.now() }], opts: { bookKey: 'ebook:spc-01:preview' } });
    expect(flip.index).toBe(0);
  });
  it('honors an explicit start-over request without deleting other book progress', async () => {
    const key = 'webzine:vol-22:free', other = 'webzine:vol-01:free';
    const { window, flip } = await openReader({ total: 12, records: [{ key, page: 8, total: 12, at: Date.now() }, { key: other, page: 4, total: 30, at: Date.now() }], opts: { bookKey: key, startPage: 0 } });
    expect(flip.index).toBe(0); expect(window.WebzineReader.progressFor(other).page).toBe(4);
  });
  it('filters invalid, expired and future history, bounds records and discards extra data', async () => {
    const records = Array.from({ length: 70 }, (_, i) => ({ key: `webzine:vol-${i}:free`, page: 2, total: 3, at: Date.now() - i, url: 'secret', fingerprint: 'x'.repeat(200) }));
    records.unshift({ key: 'webzine:expired:free', page: 2, total: 3, at: 1 }, { key: 'webzine:future:free', page: 2, total: 3, at: Date.now() + 86400000 }, { key: '<script>', page: 2, total: 3, at: Date.now() });
    const { window } = await openReader({ records });
    const recent = window.WebzineReader.recentProgress();
    expect(recent).toHaveLength(50); expect(recent[0].key).toBe('webzine:vol-0:free');
    expect(Object.keys(recent[0])).toEqual(['key', 'page', 'total', 'at', 'fingerprint']);
    expect(recent[0].fingerprint).toHaveLength(128);
  });
  it.each(['{broken', '{"key":"not-an-array"}'])('handles malformed history (%s)', async records => {
    const { window } = await openReader({ records });
    expect(window.WebzineReader.recentProgress()).toEqual([]);
  });
  it('still opens when device storage is disabled', async () => {
    const { window } = await openReader({ storageBlocked: true, opts: { bookKey: 'webzine:vol-22:free' } });
    expect(window.document.querySelector('canvas')).not.toBeNull();
    expect(window.WebzineReader.recentProgress()).toEqual([]);
  });
  it('records phases without the document URL or access credentials', async () => {
    const onMetrics = vi.fn();
    const { window } = await openReader({ opts: { bookKey: 'webzine:vol-22:free', accessMs: 123.4, onMetrics } });
    expect(onMetrics).toHaveBeenCalledOnce();
    expect(onMetrics.mock.calls[0][0]).toEqual(expect.objectContaining({ access_ms: 123, libraries_ms: expect.any(Number), document_ms: expect.any(Number), setup_ms: expect.any(Number), visible_pages_ms: expect.any(Number), handoff_ms: expect.any(Number), total_ms: expect.any(Number), pages: 3, start_page: 1 }));
    expect(JSON.stringify(window.WebzineReader.recentProgress())).not.toContain('preview.pdf');
  });
  it.each([
    'https://pucpqsfwqouqohwsvmnd.supabase.co/storage/v1/object/public/webzine/vol-21/source.pdf?v=1',
    'https://pucpqsfwqouqohwsvmnd.supabase.co/storage/v1/object/sign/ebook-pages/paid/full.pdf?token=private',
    'https://other.supabase.co/storage/v1/object/public/webzine/source.pdf',
    '/fixture.pdf',
  ])('preserves the original streaming source (%s)', async url => {
    const { window } = await openReader({ url });
    expect(window.pdfjsLib.getDocument).toHaveBeenCalledWith(expect.objectContaining({ url }));
  });
});
