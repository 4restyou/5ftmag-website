import { describe, expect, it } from 'vitest';
import {
  isActiveNaverOrder,
  isActivePortonePayment,
  parseProductOrderIds,
  productOrderMatches,
  shouldRevalidate,
  smartstoreProductOrderId,
} from '../../supabase/functions/_shared/entitlement.ts';
import { readFileSync } from 'node:fs';

describe('ebook entitlement lifecycle', () => {
  it('parses all documented parent-order response shapes without duplicates', () => {
    expect(parseProductOrderIds({ data: ['10', '20', '10'] })).toEqual(['10', '20']);
    expect(parseProductOrderIds({ data: { productOrderIds: [{ productOrderId: '30' }] } })).toEqual(['30']);
  });

  it('recognizes active and refunded Naver product orders', () => {
    expect(isActiveNaverOrder({ productOrder: { productOrderStatus: 'PAYED' } })).toBe(true);
    expect(isActiveNaverOrder({ productOrder: { productOrderStatus: 'PURCHASE_DECIDED' } })).toBe(true);
    expect(isActiveNaverOrder({ productOrder: { productOrderStatus: 'CANCELED' } })).toBe(false);
    expect(isActiveNaverOrder({ productOrder: { productOrderStatus: 'RETURNED' } })).toBe(false);
  });

  it('matches every Naver product id field used by the commerce response', () => {
    expect(productOrderMatches({ productOrder: { productId: '123' } }, '123')).toBe(true);
    expect(productOrderMatches({ productOrder: { originProductId: '456' } }, '456')).toBe(true);
    expect(productOrderMatches({ productOrder: { productId: '123' } }, '999')).toBe(false);
  });

  it('requires PortOne state, amount, currency, store, and slug to match', () => {
    const payment = {
      status: 'PAID', amount: { total: 7000 }, currency: 'KRW', storeId: 'store-id',
      customData: JSON.stringify({ slug: 'issue-03' }),
    };
    const expected = { slug: 'issue-03', price: 7000, storeId: 'store-id' };
    expect(isActivePortonePayment(payment, expected)).toBe(true);
    expect(isActivePortonePayment({ ...payment, status: 'CANCELLED' }, expected)).toBe(false);
    expect(isActivePortonePayment({ ...payment, amount: { total: 6000 } }, expected)).toBe(false);
    expect(isActivePortonePayment({ ...payment, storeId: 'other' }, expected)).toBe(false);
  });

  it('revalidates missing and stale checks while honoring the freshness window', () => {
    const now = Date.parse('2026-09-07T06:00:00Z');
    expect(shouldRevalidate(null, now)).toBe(true);
    expect(shouldRevalidate('2026-09-07T05:50:00Z', now)).toBe(false);
    expect(shouldRevalidate('2026-09-07T05:40:00Z', now)).toBe(true);
    expect(smartstoreProductOrderId('ss_20260907001')).toBe('20260907001');
  });

  it('uses direct historical-order lookup and soft revocation in deployed functions', () => {
    const naver = readFileSync('supabase/functions/_shared/naver-commerce.ts', 'utf8');
    const page = readFileSync('supabase/functions/ebook-page/index.ts', 'utf8');
    expect(naver).toContain('/orders/${encodeURIComponent(orderId)}/product-order-ids');
    expect(naver).not.toContain('last-changed-statuses');
    expect(page).toContain("status: 'revoked'");
    expect(page).toContain('verified === false');
    expect(page).not.toContain('price: Number(product.price)');
  });
});
