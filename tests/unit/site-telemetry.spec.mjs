import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const source = readFileSync('js/site-telemetry.js', 'utf8');
let dom;
afterEach(() => dom?.window.close());

function setup(path) {
  dom = new JSDOM('', { url: 'https://5ftmag.com' + path, runScripts: 'outside-only' });
  const { window } = dom;
  window.fetch = vi.fn().mockResolvedValue({ ok: true });
  window.eval(source);
  return window;
}
function payloads(window) {
  return window.fetch.mock.calls.map(([, opts]) => JSON.parse(opts.body));
}

describe('telemetry privacy', () => {
  it.each([
    '/unsubscribe.html?token=private-value#access_token=hidden',
    '/auth.html?code=private-value&redirect=/me.html',
    '/search.html?q=someone%40example.com&utm_source=test',
    '/ebook-read.html?paymentId=private-value&code=private-value',
  ])('drops non-content query values from %s', path => {
    const window = setup(path);
    window.SiteTelemetry.recordPageView();
    window.trackEvent('test_event', {});
    window.reportClientError({ message: 'test' });
    for (const payload of payloads(window)) expect(payload.path).toBe(path.split('?')[0]);
  });

  it('keeps a valid content slug without collecting other values', () => {
    const window = setup('/ebook-read.html?slug=spc-03&token=private&paymentId=secret');
    window.SiteTelemetry.recordPageView();
    expect(payloads(window)[0].path).toBe('/ebook-read.html?slug=spc-03');
  });

  it('masks signed URLs in source, message, stack and nested event properties', () => {
    const window = setup('/');
    const signed = 'https://example.com/file.pdf?token=private-secret#code=other-secret';
    window.reportClientError({ message: 'Failed ' + signed, source: signed, stack: 'at ' + signed });
    window.trackEvent('test_event', { paymentId: 'private-secret', detail: { url: signed, code: 'other-secret' } });
    const sent = JSON.stringify(payloads(window));
    expect(sent).not.toContain('private-secret');
    expect(sent).not.toContain('other-secret');
    expect(sent).toContain('https://example.com/file.pdf');
  });

  it('does not collect search strings disguised as content identifiers', () => {
    const window = setup('/films.html?film=person%40example.com');
    window.SiteTelemetry.recordPageView();
    expect(payloads(window)[0].path).toBe('/films.html');
  });
});
