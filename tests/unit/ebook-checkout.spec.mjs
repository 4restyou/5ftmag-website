import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const source = readFileSync('js/ebook-checkout.js', 'utf8');
let dom;

afterEach(() => {
  dom?.window.close();
  dom = null;
});

function setup(url, pending = null, response = { error: 'network' }) {
  dom = new JSDOM('<!doctype html><body></body>', { url, runScripts: 'outside-only' });
  const verify = vi.fn().mockResolvedValue(response);
  dom.window.MagDB = { ebooks: { purchaseVerify: verify }, auth: { signInWithGoogle: vi.fn() } };
  dom.window.alert = vi.fn();
  if (pending) dom.window.sessionStorage.setItem('5ft_ebook_pending_payment', JSON.stringify(pending));
  dom.window.eval(source);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return { window: dom.window, verify };
}

describe('ebook checkout recovery', () => {
  it('scrubs the returned payment id before verification and keeps it for retry', async () => {
    const { window, verify } = setup('https://5ftmag.com/ebook-read.html?slug=issue-03&paymentId=pay-03');
    await vi.waitFor(() => expect(verify).toHaveBeenCalledWith('issue-03', 'pay-03'));
    expect(window.location.search).toBe('?slug=issue-03');
    expect(JSON.parse(window.sessionStorage.getItem('5ft_ebook_pending_payment')).paymentId).toBe('pay-03');
  });

  it('retries a recent pending payment after a reload of the same ebook', async () => {
    const pending = { slug: 'issue-03', paymentId: 'pay-saved', createdAt: Date.now() };
    const { verify } = setup('https://5ftmag.com/ebook-read.html?slug=issue-03', pending);
    await vi.waitFor(() => expect(verify).toHaveBeenCalledWith('issue-03', 'pay-saved'));
  });

  it('does not submit a saved payment against a different ebook', async () => {
    const pending = { slug: 'issue-02', paymentId: 'pay-other', createdAt: Date.now() };
    const { verify } = setup('https://5ftmag.com/ebook-read.html?slug=issue-03', pending);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(verify).not.toHaveBeenCalled();
  });

  it('clears a definitive non-payment instead of retrying forever', async () => {
    const pending = { slug: 'issue-03', paymentId: 'missing', createdAt: Date.now() };
    const { window, verify } = setup(
      'https://5ftmag.com/ebook-read.html?slug=issue-03',
      pending,
      { error: 'payment not found' },
    );
    await vi.waitFor(() => expect(window.sessionStorage.getItem('5ft_ebook_pending_payment')).toBeNull());
    expect(verify).toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalled();
  });
});
