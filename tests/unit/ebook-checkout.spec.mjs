import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const source = readFileSync('js/ebook-checkout.js', 'utf8');
let dom;

afterEach(() => {
  dom?.window.close();
  dom = null;
});

function setup(url, pending = null, response = { error: 'network' }, enableKakao = false) {
  dom = new JSDOM('<!doctype html><body></body>', { url, runScripts: 'outside-only' });
  const verify = vi.fn().mockResolvedValue(response);
  dom.window.MagDB = {
    isReady: () => true,
    ebooks: { purchaseVerify: verify },
    auth: { signInWithGoogle: vi.fn(), getSession: vi.fn().mockResolvedValue({ user: { id: 'buyer-A' } }) },
  };
  dom.window.PortOne = { requestPayment: vi.fn().mockResolvedValue({}) };
  dom.window.alert = vi.fn();
  dom.window.console.error = vi.fn();
  if (pending) dom.window.sessionStorage.setItem('5ft_ebook_pending_payment', JSON.stringify(pending));
  // 페이지처럼 i18n.js · util.js 를 먼저 싣는다
  dom.window.eval(readFileSync('js/i18n.js', 'utf8'));
  dom.window.eval(readFileSync('js/util.js', 'utf8'));
  dom.window.eval(enableKakao ? source.replace("kakaoChannelKey: '',", "kakaoChannelKey: 'test-channel',") : source);
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

  it.each(['payment buyer mismatch', 'login required', 'payment lookup failed'])('retains the original order on %s', async error => {
    const pending = { slug: 'issue-03', paymentId: 'pay-A', createdAt: Date.now() };
    const { window, verify } = setup('https://5ftmag.com/ebook-read.html?slug=issue-03', pending, { error });
    window.MagAuthUI = { confirmLogin: vi.fn().mockReturnValue(false) };
    await vi.waitFor(() => expect(verify).toHaveBeenCalled());
    expect(JSON.parse(window.sessionStorage.getItem('5ft_ebook_pending_payment')).paymentId).toBe('pay-A');
  });

  it('retains pending provider states without claiming that payment succeeded', async () => {
    const pending = { slug: 'issue-03', paymentId: 'pending-A', createdAt: Date.now() };
    const { window } = setup('https://5ftmag.com/ebook-read.html?slug=issue-03', pending, { error: 'not paid', status: 'READY' });
    await vi.waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(window.sessionStorage.getItem('5ft_ebook_pending_payment')).not.toBeNull();
    expect(window.alert.mock.calls[0][0]).not.toContain('Your payment went through');
  });

  it.each(['CANCELLED', 'PARTIAL_CANCELLED', 'FAILED'])('clears definitive provider state %s', async status => {
    const pending = { slug: 'issue-03', paymentId: 'ended', createdAt: Date.now() };
    const { window } = setup('https://5ftmag.com/ebook-read.html?slug=issue-03', pending, { error: 'not paid', status });
    await vi.waitFor(() => expect(window.sessionStorage.getItem('5ft_ebook_pending_payment')).toBeNull());
  });

  it('clears rejected legacy recovery and shows the payment ID for editor review', async () => {
    const pending = { slug: 'issue-03', paymentId: 'legacy-unused', createdAt: Date.now() };
    const { window } = setup('https://5ftmag.com/ebook-read.html?slug=issue-03', pending, { error: 'legacy payment unbound' });
    await vi.waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(window.sessionStorage.getItem('5ft_ebook_pending_payment')).toBeNull();
    expect(window.alert.mock.calls[0][0]).toContain('legacy-unused');
  });

  it('handles a cancellation return without sending verification', async () => {
    const pending = { slug: 'issue-03', paymentId: 'cancelled', createdAt: Date.now() };
    const { window, verify } = setup('https://5ftmag.com/ebook-read.html?slug=issue-03&paymentId=cancelled&code=PAYMENT_CANCELLED', pending);
    expect(window.location.search).toBe('?slug=issue-03');
    expect(window.sessionStorage.getItem('5ft_ebook_pending_payment')).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('ebook checkout server order', () => {
  const product = { slug: 'issue-03', title: 'Stale title', price: 1 };
  const order = { slug: product.slug, title: 'Server title', price: 7000, paymentId: 'server-pay-A', storeId: 'server-store' };

  async function begin(window) {
    await window.EbookCheckout.start(product);
    window.document.querySelector('[data-method="kakao"]').click();
  }

  it('creates the server order before opening SDK and uses its price/ID/title, without client UID', async () => {
    const { window, verify } = setup('https://5ftmag.com/ebook-read.html?slug=issue-03', null, { error: 'network' }, true);
    verify.mockResolvedValueOnce({ ok: true, order });
    window.PortOne.requestPayment.mockResolvedValue({ paymentId: 'substituted-by-sdk' });
    await begin(window);
    await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(2));
    expect(verify.mock.calls[0]).toEqual(['issue-03']);
    expect(window.PortOne.requestPayment).toHaveBeenCalledWith(expect.objectContaining({
      paymentId: order.paymentId, totalAmount: 7000, orderName: 'Server title', storeId: 'server-store',
      customData: JSON.stringify({ slug: product.slug }),
    }));
    expect(verify.mock.calls[1]).toEqual(['issue-03', order.paymentId]);
    expect(verify.mock.invocationCallOrder[0]).toBeLessThan(window.PortOne.requestPayment.mock.invocationCallOrder[0]);
    expect(JSON.parse(window.sessionStorage.getItem('5ft_ebook_pending_payment')).paymentId).toBe(order.paymentId);
  });

  it('never starts payment when server order creation fails', async () => {
    const { window } = setup('https://5ftmag.com/ebook-read.html?slug=issue-03', null, { error: 'login required' }, true);
    await begin(window);
    await vi.waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(window.PortOne.requestPayment).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('5ft_ebook_pending_payment')).toBeNull();
  });

  it('retains the server ID after an ambiguous SDK exception', async () => {
    const { window } = setup('https://5ftmag.com/ebook-read.html?slug=issue-03', null, { ok: true, order }, true);
    window.PortOne.requestPayment.mockRejectedValue(new Error('SDK network failure'));
    await begin(window);
    await vi.waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(JSON.parse(window.sessionStorage.getItem('5ft_ebook_pending_payment')).paymentId).toBe(order.paymentId);
  });
});
