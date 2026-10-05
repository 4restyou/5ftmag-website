import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let dom;
afterEach(() => { dom?.window.document.querySelector('[data-close]')?.click(); dom?.window.close(); });

async function openReader({ total = 3, orientation = 'portrait', cta = true } = {}) {
  dom = new JSDOM('', { url: 'https://5ftmag.com', runScripts: 'outside-only' });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}));
  const page = { getViewport: () => ({ width: 400, height: 600 }), render: () => ({ promise: Promise.resolve() }) };
  window.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: vi.fn(() => ({ promise: Promise.resolve({ numPages: total, getPage: async () => page, destroy() {} }) })),
  };
  let flip;
  window.St = { PageFlip: class {
    constructor() { flip = this; this.index = 0; this.events = {}; }
    loadFromHTML() {}
    on(name, cb) { this.events[name] = cb; }
    getCurrentPageIndex() { return this.index; }
    getOrientation() { return orientation; }
    move(index) { this.index = index; this.events.flip(); }
    destroy() {}
  } };
  // 페이지처럼 i18n.js · util.js 를 먼저 싣는다
  window.eval(readFileSync('js/i18n.js', 'utf8'));
  window.eval(readFileSync('js/util.js', 'utf8'));
  window.eval(readFileSync('js/webzine-reader.js', 'utf8'));
  await window.WebzineReader.open('/preview.pdf', 'Preview', cta ? { cta: { note: 'Preview ended', label: 'Buy' } } : {});
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
    const old = window.WebzineReader.open('/old.pdf', 'Old', { deferReveal: true, signal: controller.signal, onReady });
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
  });
  it('returns a deferred rendering failure to the detail instead of revealing a blank reader', async () => {
    const { window } = await openReader({ total: 1 });
    window.document.querySelector('[data-close]').click();
    const page = { getViewport: () => ({ width: 400, height: 600 }), render: () => ({ promise: Promise.reject(new Error('render failed')) }) };
    window.pdfjsLib.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: async () => page, destroy() {} }) });
    const onError = vi.fn(), onClose = vi.fn(), onReady = vi.fn();
    await window.WebzineReader.open('/failed.pdf', 'Failed', { deferReveal: true, onError, onClose, onReady });
    expect(window.document.querySelector('.wz-reader')).toBeNull();
    expect(onError).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce();
    expect(onReady).not.toHaveBeenCalled();
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
  });
});
