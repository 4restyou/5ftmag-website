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
  window.eval(readFileSync('js/webzine-reader.js', 'utf8'));
  await window.WebzineReader.open('/preview.pdf', 'Preview', cta ? { cta: { note: 'Preview ended', label: 'Buy' } } : {});
  return { window, flip, note: window.document.querySelector('.wz-reader-cta-note') };
}

describe('PDF reader', () => {
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
