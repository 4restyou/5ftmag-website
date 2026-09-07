// Pure helpers shared by ebook Edge Functions. Keep this module free of
// network/runtime dependencies so its status rules can be unit-tested.

export const ACTIVE_NAVER_ORDER_STATUSES = new Set([
  'PAYED',
  'DELIVERING',
  'DELIVERED',
  'PURCHASE_DECIDED',
  'DISPATCHED',
]);

export function naverOrderStatus(row: any): string {
  const productOrder = row?.productOrder || row || {};
  return String(productOrder.productOrderStatus || 'UNKNOWN');
}

export function isActiveNaverOrder(row: any): boolean {
  return ACTIVE_NAVER_ORDER_STATUSES.has(naverOrderStatus(row));
}

export function productOrderId(row: any): string {
  const productOrder = row?.productOrder || row || {};
  return String(productOrder.productOrderId || '');
}

export function productOrderMatches(row: any, expectedProductNo: string): boolean {
  const productOrder = row?.productOrder || row || {};
  const candidates = [
    productOrder.productId,
    productOrder.originProductId,
    productOrder.channelProductId,
    productOrder.merchantChannelProductId,
  ].filter(Boolean).map(String);
  return candidates.includes(String(expectedProductNo));
}

export function parseProductOrderIds(payload: any): string[] {
  const raw = Array.isArray(payload?.data)
    ? payload.data
    : payload?.data?.productOrderIds || payload?.productOrderIds || [];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((value: any) => {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    return String(value?.productOrderId || '');
  }).filter(Boolean))];
}

export function smartstoreProductOrderId(orderRef: unknown): string {
  const value = String(orderRef || '');
  return value.startsWith('ss_') ? value.slice(3) : '';
}

export function shouldRevalidate(lastVerifiedAt: unknown, now = Date.now(), intervalMs = 15 * 60_000): boolean {
  const timestamp = Date.parse(String(lastVerifiedAt || ''));
  return !Number.isFinite(timestamp) || now - timestamp >= intervalMs;
}

export function portonePaymentStatus(payment: any): string {
  return String(payment?.status || 'UNKNOWN');
}

export function portonePaymentSlug(payment: any): string {
  try {
    const customData = typeof payment?.customData === 'string'
      ? JSON.parse(payment.customData)
      : payment?.customData;
    return String(customData?.slug || '').trim();
  } catch {
    return '';
  }
}

export function isActivePortonePayment(payment: any, expected: { slug: string; price: number; storeId: string }): boolean {
  return portonePaymentStatus(payment) === 'PAID'
    && Number(payment?.amount?.total) === Number(expected.price)
    && (!payment?.currency || payment.currency === 'KRW')
    && String(payment?.storeId || '') === expected.storeId
    && portonePaymentSlug(payment) === expected.slug;
}
